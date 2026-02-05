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

  // Map to track active rooms and their users
  private activeRooms = new Map<string, Set<string>>();
  private userSockets = new Map<string, Set<string>>();

  constructor(
    private chatService: ChatService,
    private groupChatService: GroupChatService,
    private jwtService: JwtService,
  ) {}

  afterInit(server: Server) {
    console.log('WebSocket Gateway initialized');
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      // Extract and verify JWT token
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

      // Track user sockets
      if (!this.userSockets.has(decoded.id)) {
        this.userSockets.set(decoded.id, new Set());
      }
      this.userSockets.get(decoded.id).add(client.id);

      console.log(`User ${decoded.username} (${decoded.id}) connected`);
      client.emit('connected', { message: 'Connected to chat server', userId: decoded.id });
    } catch (error) {
      console.log('Authentication failed:', error?.message || error);
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    if (client.userId) {
      // Remove from userSockets map
      const userSockets = this.userSockets.get(client.userId);
      if (userSockets) {
        userSockets.delete(client.id);
        if (userSockets.size === 0) {
          this.userSockets.delete(client.userId);
        }
      }

      // Remove from all activeRooms and notify rooms
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

      console.log(`User ${client.username} (${client.userId}) disconnected`);
    } else {
      console.log(`An unauthenticated socket disconnected: ${client.id}`);
    }
  }

  // Join a chat room (1:1 or group)
  @SubscribeMessage('join-room')
  handleJoinRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string; userName: string },
  ) {
    const { roomId, userName } = data;

    // Ensure authenticated
    if (!client.userId) {
      client.disconnect();
      return;
    }

    client.join(roomId);

    if (!this.activeRooms.has(roomId)) {
      this.activeRooms.set(roomId, new Set());
    }
    this.activeRooms.get(roomId).add(client.userId);

    // Notify others in the room
    this.server.to(roomId).emit('user-joined', {
      userId: client.userId,
      userName,
      timestamp: new Date(),
      activeUsers: Array.from(this.activeRooms.get(roomId) || []),
    });

    console.log(`User ${client.username} joined room ${roomId}`);
  }

  // Send message in a room (1:1 chat or group chat)
  @SubscribeMessage('send-message')
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: {
      roomId: string;
      message: string;
      chatId?: string;
      groupChatId?: string;
      isGroupChat?: boolean;
      courseId?: string;
    },
  ) {
    const { roomId, message, chatId, groupChatId, isGroupChat, courseId } = data;

    const messagePayload = {
      userId: client.userId,
      userName: client.username,
      message,
      roomId,
      timestamp: new Date(),
      messageId: Date.now().toString(),
      isAI: false,
    };

    // Broadcast message to room
    this.server.to(roomId).emit('message', messagePayload);

    // Save to group chat database
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

      // Check for @studygai mention - trigger AI response
      const hasMention = /@studygai/i.test(message);
      if (hasMention && courseId) {
        try {
          const messages = [{ role: 'user' as const, content: message.replace(/@studygai\s*/gi, '').trim() || message }];
          const response = await this.chatService.sendWithContext(messages, courseId);
          const aiContent = response?.choices?.[0]?.message?.content || response?.message || 'I could not generate a response.';

          const aiPayload = {
            userId: 'studygai',
            userName: 'StudyGAI',
            message: aiContent,
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

  // Send AI response (uses @studygai context when courseId provided)
  @SubscribeMessage('send-ai-message')
  async handleAIMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: {
      roomId: string;
      messages: Array<{ role: string; content: string }>;
      courseId?: string;
      chatId?: string;
      groupChatId?: string;
    },
  ) {
    const { roomId, messages, courseId, chatId, groupChatId } = data;

    try {
      // Use sendWithContext for @studygai vector search when courseId provided
      const response = await this.chatService.sendWithContext(messages, courseId);

      const aiMessage = {
        userId: 'studygai',
        userName: 'StudyGAI',
        message: response?.choices?.[0]?.message?.content || response?.message || 'No response',
        roomId,
        timestamp: new Date(),
        isAI: true,
      };

      // Broadcast AI response
      this.server.to(roomId).emit('ai-message', aiMessage);

      // Save to database
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
    } catch (error) {
      this.server.to(roomId).emit('error', {
        message: 'Failed to get AI response',
        error: error.message,
      });
    }
  }

  // Typing indicator
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

  // Leave room
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

  // Stream AI response
  @SubscribeMessage('send-ai-stream')
  async handleAIStream(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: {
      roomId: string;
      messages: Array<{ role: string; content: string }>;
      courseId?: string;
      chatId?: string;
    },
  ) {
    const { roomId, messages, courseId, chatId } = data;

    try {
      const stream = await this.chatService.sendStream(messages, courseId);

      let fullContent = '';
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullContent += content;
          this.server.to(roomId).emit('ai-stream-chunk', {
            chunk: content,
            timestamp: new Date(),
          });
        }
      }

      // Save full message to database
      if (chatId) {
        await this.chatService.addMessageToChat(chatId, {
          role: 'assistant',
          content: fullContent,
          date: new Date(),
        });
      }

      this.server.to(roomId).emit('ai-stream-done', {
        timestamp: new Date(),
      });
    } catch (error) {
      this.server.to(roomId).emit('error', {
        message: 'Failed to stream AI response',
        error: error.message,
      });
    }
  }

  // Get active users in room
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
