// src/chat/chat.service.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ChatDocument } from '../schemas/chat.schema';
import { CourseDocument } from '../schemas/course.schema';
import { GroqService } from '../common/groq.service';
import { PdfService } from '../pdf/pdf.service';
import { QdrantService } from '../qdrant/qdrant.service';
import { default as mongoose } from 'mongoose';

@Injectable()
export class ChatService {
  constructor(
    @InjectModel('chats') private chatModel: Model<ChatDocument>,
    @InjectModel('courses') private courseModel: Model<CourseDocument>, // typed course model
    private groq: GroqService,
    private pdfService: PdfService,
    private qdrantService: QdrantService, // inject Qdrant for vector search
  ) {}

  async list(courseID: string, userID: string) {
    const chats = await this.chatModel
      .find({ course: courseID, creator: userID })
      .sort({ createdAt: -1 });
    return { message: 'success', chats };
  }

  async create(body: any) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const newChat = new this.chatModel({
        title: body.title || (body.courseTitle ? body.courseTitle + Date.now() : 'chat' + Date.now()),
        creator: body.creator,
        course: body.course,
        messages: body.messages || [],
      });
      const savedChat = await newChat.save({ session });
      await session.commitTransaction();
      session.endSession();
      return { message: 'success', chat: savedChat };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      if (error.code === 11000) {
        return { status: 400, error: 'Duplicate key' };
      }
      return { status: 500, error: error.message };
    }
  }

  /**
   * Send messages with optional PDF context
   */
  async send(messages: any[], courseId?: string) {
    try {
      // If courseId provided, check for PDF content
      if (courseId) {
        const pdfContent = await this.pdfService.getPdfContent(courseId);
        
        if (pdfContent && pdfContent.trim().length > 0) {
          // Use PDF-aware chat
          const data = await this.groq.chatWithPDF(pdfContent, messages);
          return data;
        } else {
          // No PDF content found, inform user
          console.log(`No PDF content found for course ${courseId}, using regular chat`);
        }
      }

      // Fallback to regular chat without PDF context
      const data = await this.groq.getGroqChatCompletion(messages);
      return data;
    } catch (error) {
      console.error('Chat error:', error);
      return { status: 400, error: error.message };
    }
  }

  /**
   * Send messages with streaming response
   */
  async sendStream(messages: any[], courseId?: string) {
    try {
      if (courseId) {
        const pdfContent = await this.pdfService.getPdfContent(courseId);
        
        if (pdfContent && pdfContent.trim().length > 0) {
          return await this.groq.chatWithPDFStream(pdfContent, messages);
        }
      }

      return await this.groq.getGroqChatCompletionStream(messages);
    } catch (error) {
      console.error('Chat stream error:', error);
      throw error;
    }
  }

  async remove(id: string, userId: string) {
    try {
      const result = await this.chatModel.findOneAndDelete({ _id: id, creator: userId });
      if (result) {
        return { message: 'success', id };
      } else {
        return { status: 404, error: 'Item not found' };
      }
    } catch (error) {
      return { status: 500, error: 'Error deleting item' };
    }
  }

  /**
   * Get chat history with course info
   */
  async getChatWithCourse(chatId: string, userId: string) {
    try {
      const chat = await this.chatModel
        .findOne({ _id: chatId, creator: userId })
        .populate('course', 'title pdfProcessed');
      
      if (!chat) {
        return { status: 404, error: 'Chat not found' };
      }

      return { message: 'success', chat };
    } catch (error) {
      return { status: 500, error: error.message };
    }
  }

    /**
     * Add message to chat (used by WebSocket gateway)
     */
    async addMessageToChat(chatId: string, message: any) {
      try {
        const chat = await this.chatModel.findByIdAndUpdate(
          chatId,
          { $push: { messages: message } },
          { new: true },
        );

        if (!chat) {
          return { status: 404, error: 'Chat not found' };
        }

        return { message: 'Message added successfully', chat };
      } catch (error) {
        return { status: 500, error: error.message };
      }
    }

    /**
     * Check if a message contains @studyGAI mention
     */
    private hasStudyGAIMention(content: string): boolean {
      return /@studyGAI/i.test(content);
    }

    /**
     * Extract context from vector search when @studyGAI is mentioned
     */
    async getStudyGAIContext(
      message: string,
      courseId: string,
      limit: number = 3,
    ): Promise<string> {
      try {
        // Extract the actual query after @studyGAI
        const queryMatch = message.match(/@studyGAI\s+(.+?)(?:\s*$|\s+@|\n)/i);
        const query = queryMatch ? queryMatch[1].trim() : message.replace(/@studyGAI/i, '').trim();

        if (!query) {
          return ''; // No specific query
        }

        // Search for similar content in vector database
        const results = await this.qdrantService.searchSimilarChunks(
          query,
          courseId,
          limit,
        );

        if (results.length === 0) {
          return '';
        }

        // Format results as context
        const contextLines = results.map((r, idx) => {
          return `[Relevant Context ${idx + 1}]\n${r.text}`;
        });

        return `\n\n--- Context from course materials ---\n${contextLines.join('\n\n')}`;
      } catch (error) {
        console.warn(`Failed to get @studyGAI context: ${error.message}`);
        return '';
      }
    }

    /**
     * Send messages with @studyGAI context injection
     */
    async sendWithContext(messages: any[], courseId?: string) {
      try {
        if (!courseId || messages.length === 0) {
          return this.send(messages, courseId);
        }

        // Get last user message
        const lastMessage = messages[messages.length - 1];
        const userContent = lastMessage?.content || '';

        // Check for @studyGAI mention
        if (this.hasStudyGAIMention(userContent)) {
          const context = await this.getStudyGAIContext(userContent, courseId);

          if (context) {
            // Inject context into the message
            messages[messages.length - 1] = {
              ...lastMessage,
              content: userContent + context,
            };
          }
        }

        return this.send(messages, courseId);
      } catch (error) {
        console.error('sendWithContext error:', error);
        return this.send(messages, courseId);
      }
    }

    /**
     * Send messages with streaming and @studyGAI context
     */
    async sendStreamWithContext(messages: any[], courseId?: string) {
      try {
        if (!courseId || messages.length === 0) {
          return this.sendStream(messages, courseId);
        }

        // Get last user message
        const lastMessage = messages[messages.length - 1];
        const userContent = lastMessage?.content || '';

        // Check for @studyGAI mention
        if (this.hasStudyGAIMention(userContent)) {
          const context = await this.getStudyGAIContext(userContent, courseId);

          if (context) {
            // Inject context into the message
            messages[messages.length - 1] = {
              ...lastMessage,
              content: userContent + context,
            };
          }
        }

        return this.sendStream(messages, courseId);
      } catch (error) {
        console.error('sendStreamWithContext error:', error);
        return this.sendStream(messages, courseId);
      }
    }
}