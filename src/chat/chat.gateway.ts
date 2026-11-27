import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable } from '@nestjs/common';
import { ChatService } from '../chat/chat.service';
import { GroupChatService } from './groupchat.service';
import { JwtService } from '@nestjs/jwt';
import { IngestionProcessor } from '../rag/ingestion.processor';
import { RagMode, RagOrchestratorService } from '../rag/rag-orchestrator.service';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  username?: string;
}

@WebSocketGateway({
  cors: { origin: '*', methods: ['GET', 'POST'] },
  namespace: '/chat',
})
@Injectable()
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private activeRooms = new Map<string, Set<string>>();
  private userSockets = new Map<string, Set<string>>();

  constructor(
    private chatService: ChatService,
    private groupChatService: GroupChatService,
    private jwtService: JwtService,
    private ingestionProcessor: IngestionProcessor,
    private ragOrchestrator: RagOrchestratorService,
  ) {}

  afterInit(server: Server) {
    console.log('WebSocket Gateway initialized');
    // Broadcast live document ingestion progress to course rooms (`course:<courseId>`)
    this.ingestionProcessor.registerStatusEmitter((courseId, payload) => {
      server.to(`course:${courseId}`).emit('source-status', payload);
    });
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token = client.handshake.auth?.token;
      if (!token) {
        client.disconnect();
        return;
      }

      const decoded = this.jwtService.verify(token);
      if (!decoded?.id) {
        client.disconnect();
        return;
      }

      client.userId = decoded.id;
      client.username = decoded.username;

      if (!this.userSockets.has(decoded.id)) {
        this.userSockets.set(decoded.id, new Set());
      }
      this.userSockets.get(decoded.id).add(client.id);

      client.emit('connected', { message: 'Connected to chat server', userId: decoded.id });
    } catch (error: any) {
      console.log('Authentication failed:', error?.message || error);
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    if (client.userId) {
      const userSockets = this.userSockets.get(client.userId);
      if (userSockets) {
        userSockets.delete(client.id);
        if (userSockets.size === 0) {
          this.userSockets.delete(client.userId);
        }
      }

      for (const [roomId, users] of this.activeRooms.entries()) {
        if (users.has(client.userId)) {
          users.delete(client.userId);
          this.server.to(roomId).emit('user-left', {
            userId: client.userId,
            userName: client.username,
            timestamp: new Date(),
          });
          if (users.size === 0) {
            this.activeRooms.delete(roomId);
          }
        }
      }
    }
  }

  @SubscribeMessage('join-room')
  handleJoinRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string; userName: string },
  ) {
    const { roomId, userName } = data;
    if (!client.userId) {
      client.disconnect();
      return;
    }

    client.join(roomId);

    if (!this.activeRooms.has(roomId)) {
      this.activeRooms.set(roomId, new Set());
    }
    this.activeRooms.get(roomId).add(client.userId);

    this.server.to(roomId).emit('user-joined', {
      userId: client.userId,
      userName,
      timestamp: new Date(),
      activeUsers: Array.from(this.activeRooms.get(roomId) || []),
    });
  }

  /** Subscribe to live ingestion progress updates for a course notebook */
  @SubscribeMessage('join-course')
  handleJoinCourse(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { courseId: string },
  ) {
    if (!client.userId || !data?.courseId) return;
    client.join(`course:${data.courseId}`);
  }

  @SubscribeMessage('send-message')
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: {
      roomId: string;
      message: string;
      chatId?: string;
      groupChatId?: string;
      isGroupChat?: boolean;
      courseId?: string;
      sourceIds?: string[];
      mode?: RagMode;
    },
  ) {
    const { roomId, message, chatId, groupChatId, isGroupChat, courseId, sourceIds, mode } = data;

    const messagePayload = {
      userId: client.userId,
      userName: client.username,
      message,
      roomId,
      timestamp: new Date(),
      messageId: Date.now().toString(),
      isAI: false,
    };

    this.server.to(roomId).emit('message', messagePayload);

    if (isGroupChat && groupChatId) {
      try {
        await this.groupChatService.addMessage(groupChatId, {
          role: 'user',
          content: message,
          sender: client.userId,
          senderName: client.username,
          date: new Date(),
        });
      } catch (error) {
        console.error('Error saving group chat message:', error);
      }

      // Check for @studygai mention -> route directly through Hybrid RAG Orchestrator (fixes prior stripped-mention bug!)
      const hasMention = /@studygai/i.test(message);
      if (hasMention && courseId) {
        try {
          const query = message.replace(/@studygai\s*/gi, '').trim() || message;
          const response = await this.chatService.send([{ role: 'user', content: query }], courseId, {
            userId: client.userId,
            sourceIds,
            mode,
          });
          const aiContent =
            response?.content ||
            response?.choices?.[0]?.message?.content ||
            'I could not generate a response.';

          const aiPayload = {
            userId: 'studygai',
            userName: 'StudyGAI',
            message: aiContent,
            citations: response?.citations || [],
            retrievalMeta: response?.retrievalMeta,
            roomId,
            timestamp: new Date(),
            isAI: true,
          };
          this.server.to(roomId).emit('ai-message', aiPayload);

          await this.groupChatService.addMessage(groupChatId, {
            role: 'assistant',
            content: aiContent,
            senderName: 'StudyGAI',
            date: new Date(),
            isAI: true,
          });
        } catch (aiError: any) {
          this.server.to(roomId).emit('ai-message', {
            userId: 'studygai',
            userName: 'StudyGAI',
            message: `Sorry, I encountered an error: ${aiError?.message || 'Unknown error'}`,
            roomId,
            timestamp: new Date(),
            isAI: true,
          });
        }
      }
    } else if (chatId) {
      try {
        await this.chatService.addMessageToChat(chatId, {
          role: 'user',
          content: message,
          sender: client.userId,
          senderName: client.username,
          date: new Date(),
        });
      } catch (error) {
        console.error('Error saving message:', error);
      }
    }
  }

  @SubscribeMessage('send-ai-message')
  async handleAIMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: {
      roomId: string;
      messages: Array<{ role: string; content: string }>;
      courseId?: string;
      chatId?: string;
      groupChatId?: string;
      sourceIds?: string[];
      mode?: RagMode;
    },
  ) {
    const { roomId, messages, courseId, chatId, groupChatId, sourceIds, mode } = data;

    try {
      const response = await this.chatService.send(messages, courseId, {
        userId: client.userId,
        sourceIds,
        mode,
      });

      const aiMessage = {
        userId: 'studygai',
        userName: 'StudyGAI',
        message: response?.content || response?.choices?.[0]?.message?.content || 'No response',
        citations: response?.citations || [],
        retrievalMeta: response?.retrievalMeta,
        roomId,
        timestamp: new Date(),
        isAI: true,
      };

      this.server.to(roomId).emit('ai-message', aiMessage);

      if (groupChatId) {
        await this.groupChatService.addMessage(groupChatId, {
          role: 'assistant',
          content: aiMessage.message,
          senderName: 'StudyGAI',
          date: new Date(),
          isAI: true,
        });
      } else if (chatId) {
        await this.chatService.addMessageToChat(chatId, {
          role: 'assistant',
          content: aiMessage.message,
          date: new Date(),
        });
      }
    } catch (error: any) {
      this.server.to(roomId).emit('error', {
        message: 'Failed to get AI response',
        error: error.message,
      });
    }
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string; isTyping: boolean },
  ) {
    const { roomId, isTyping } = data;
    this.server.to(roomId).emit('user-typing', {
      userId: client.userId,
      userName: client.username,
      isTyping,
    });
  }

  @SubscribeMessage('leave-room')
  handleLeaveRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    const { roomId } = data;
    client.leave(roomId);

    const room = this.activeRooms.get(roomId);
    if (room) {
      room.delete(client.userId);
      if (room.size === 0) {
        this.activeRooms.delete(roomId);
      }
    }

    this.server.to(roomId).emit('user-left', {
      userId: client.userId,
      userName: client.username,
      timestamp: new Date(),
    });
  }

  @SubscribeMessage('send-ai-stream')
  async handleAIStream(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: {
      roomId: string;
      messages: Array<{ role: string; content: string }>;
      courseId?: string;
      chatId?: string;
      sourceIds?: string[];
      mode?: RagMode;
    },
  ) {
    const { roomId, messages, courseId, chatId, sourceIds, mode } = data;

    try {
      const ragStream = await this.chatService.sendStream(messages, courseId, {
        userId: client.userId,
        sourceIds,
        mode,
      });

      this.server.to(roomId).emit('ai-stream-meta', {
        strategy: ragStream.strategy,
        citations: ragStream.citations,
        timestamp: new Date(),
      });

      let fullContent = '';
      for await (const content of ragStream.stream) {
        if (content) {
          fullContent += content;
          this.server.to(roomId).emit('ai-stream-chunk', {
            chunk: content,
            timestamp: new Date(),
          });
        }
      }

      if (chatId) {
        await this.chatService.addMessageToChat(chatId, {
          role: 'assistant',
          content: fullContent,
          date: new Date(),
        });
      }

      const verifiedCitations = this.ragOrchestrator.markCitedReferences(
        fullContent,
        ragStream.citations,
      );

      this.server.to(roomId).emit('ai-stream-done', {
        citations: verifiedCitations,
        timestamp: new Date(),
      });
    } catch (error: any) {
      this.server.to(roomId).emit('error', {
        message: 'Failed to stream AI response',
        error: error.message,
      });
    }
  }

  @SubscribeMessage('get-active-users')
  handleGetActiveUsers(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    const { roomId } = data;
    const activeUsers = this.activeRooms.get(roomId);
    client.emit('active-users', {
      roomId,
      activeUsers: Array.from(activeUsers || []),
      count: activeUsers?.size || 0,
    });
  }
}
