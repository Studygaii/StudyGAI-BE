// src/chat/chat.service.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ChatDocument } from '../schemas/chat.schema';
import { CourseDocument } from '../schemas/course.schema';
import { RagMode, RagOrchestratorService } from '../rag/rag-orchestrator.service';
import { default as mongoose } from 'mongoose';

@Injectable()
export class ChatService {
  constructor(
    @InjectModel('chats') private chatModel: Model<ChatDocument>,
    @InjectModel('courses') private courseModel: Model<CourseDocument>,
    private readonly ragOrchestrator: RagOrchestratorService,
  ) {}

  async list(courseID: string, userID: string) {
    const chats = await this.chatModel
      .find({ course: courseID, creator: userID })
      .sort({ createdAt: -1 });
    return { message: 'success', chats };
  }

  async create(body: any) {
    try {
      const newChat = new this.chatModel({
        title:
          body.title ||
          (body.courseTitle ? body.courseTitle + Date.now() : 'chat' + Date.now()),
        creator: body.creator,
        course: body.course,
        messages: body.messages || [],
      });
      const savedChat = await newChat.save();
      return { message: 'success', chat: savedChat };
    } catch (error: any) {
      if (error.code === 11000) {
        return { status: 400, error: 'Duplicate key' };
      }
      return { status: 500, error: error.message };
    }
  }

  /**
   * Unified grounded chat powered by RagOrchestratorService (Hybrid Dense+Sparse RRF +
   * Cross-Encoder Reranking + Parent Expansion + Inline Citations + Long-Context Routing).
   */
  async send(
    messages: any[],
    courseId?: string,
    options: { userId?: string; sourceIds?: string[]; mode?: RagMode } = {},
  ) {
    return this.ragOrchestrator.answer({
      messages,
      courseId,
      userId: options.userId,
      sourceIds: options.sourceIds,
      mode: options.mode,
    });
  }

  /**
   * Unified grounded streaming chat returning an AsyncGenerator of text tokens
   * alongside pre-retrieved citation metadata.
   */
  async sendStream(
    messages: any[],
    courseId?: string,
    options: { userId?: string; sourceIds?: string[]; mode?: RagMode } = {},
  ) {
    return this.ragOrchestrator.answerStream({
      messages,
      courseId,
      userId: options.userId,
      sourceIds: options.sourceIds,
      mode: options.mode,
    });
  }

  /** Backward-compatible alias used by GroupChatController & ChatGateway */
  async sendWithContext(
    messages: any[],
    courseId?: string,
    options: { userId?: string; sourceIds?: string[]; mode?: RagMode } = {},
  ) {
    return this.send(messages, courseId, options);
  }

  /** Backward-compatible streaming alias */
  async sendStreamWithContext(
    messages: any[],
    courseId?: string,
    options: { userId?: string; sourceIds?: string[]; mode?: RagMode } = {},
  ) {
    return this.sendStream(messages, courseId, options);
  }

  async remove(id: string, userId: string) {
    try {
      const result = await this.chatModel.findOneAndDelete({ _id: id, creator: userId });
      if (result) {
        return { message: 'success', id };
      }
      return { status: 404, error: 'Item not found' };
    } catch {
      return { status: 500, error: 'Error deleting item' };
    }
  }

  async getChatWithCourse(chatId: string, userId: string) {
    try {
      const chat = await this.chatModel
        .findOne({ _id: chatId, creator: userId })
        .populate('course', 'title pdfProcessed sourceCount totalTokens');

      if (!chat) {
        return { status: 404, error: 'Chat not found' };
      }

      return { message: 'success', chat };
    } catch (error: any) {
      return { status: 500, error: error.message };
    }
  }

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
    } catch (error: any) {
      return { status: 500, error: error.message };
    }
  }
}
