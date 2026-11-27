"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatGateway = void 0;
const websockets_1 = require("@nestjs/websockets");
const socket_io_1 = require("socket.io");
const common_1 = require("@nestjs/common");
const chat_service_1 = require("../chat/chat.service");
const groupchat_service_1 = require("./groupchat.service");
const jwt_1 = require("@nestjs/jwt");
const ingestion_processor_1 = require("../rag/ingestion.processor");
const rag_orchestrator_service_1 = require("../rag/rag-orchestrator.service");
let ChatGateway = class ChatGateway {
    constructor(chatService, groupChatService, jwtService, ingestionProcessor, ragOrchestrator) {
        this.chatService = chatService;
        this.groupChatService = groupChatService;
        this.jwtService = jwtService;
        this.ingestionProcessor = ingestionProcessor;
        this.ragOrchestrator = ragOrchestrator;
        this.activeRooms = new Map();
        this.userSockets = new Map();
    }
    afterInit(server) {
        console.log('WebSocket Gateway initialized');
        // Broadcast live document ingestion progress to course rooms (`course:<courseId>`)
        this.ingestionProcessor.registerStatusEmitter((courseId, payload) => {
            server.to(`course:${courseId}`).emit('source-status', payload);
        });
    }
    async handleConnection(client) {
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
        }
        catch (error) {
            console.log('Authentication failed:', error?.message || error);
            client.disconnect();
        }
    }
    handleDisconnect(client) {
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
    handleJoinRoom(client, data) {
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
    handleJoinCourse(client, data) {
        if (!client.userId || !data?.courseId)
            return;
        client.join(`course:${data.courseId}`);
    }
    async handleSendMessage(client, data) {
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
            }
            catch (error) {
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
                    const aiContent = response?.content ||
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
                }
                catch (aiError) {
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
        }
        else if (chatId) {
            try {
                await this.chatService.addMessageToChat(chatId, {
                    role: 'user',
                    content: message,
                    sender: client.userId,
                    senderName: client.username,
                    date: new Date(),
                });
            }
            catch (error) {
                console.error('Error saving message:', error);
            }
        }
    }
    async handleAIMessage(client, data) {
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
            }
            else if (chatId) {
                await this.chatService.addMessageToChat(chatId, {
                    role: 'assistant',
                    content: aiMessage.message,
                    date: new Date(),
                });
            }
        }
        catch (error) {
            this.server.to(roomId).emit('error', {
                message: 'Failed to get AI response',
                error: error.message,
            });
        }
    }
    handleTyping(client, data) {
        const { roomId, isTyping } = data;
        this.server.to(roomId).emit('user-typing', {
            userId: client.userId,
            userName: client.username,
            isTyping,
        });
    }
    handleLeaveRoom(client, data) {
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
    async handleAIStream(client, data) {
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
            const verifiedCitations = this.ragOrchestrator.markCitedReferences(fullContent, ragStream.citations);
            this.server.to(roomId).emit('ai-stream-done', {
                citations: verifiedCitations,
                timestamp: new Date(),
            });
        }
        catch (error) {
            this.server.to(roomId).emit('error', {
                message: 'Failed to stream AI response',
                error: error.message,
            });
        }
    }
    handleGetActiveUsers(client, data) {
        const { roomId } = data;
        const activeUsers = this.activeRooms.get(roomId);
        client.emit('active-users', {
            roomId,
            activeUsers: Array.from(activeUsers || []),
            count: activeUsers?.size || 0,
        });
    }
};
exports.ChatGateway = ChatGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], ChatGateway.prototype, "server", void 0);
__decorate([
    (0, websockets_1.SubscribeMessage)('join-room'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ChatGateway.prototype, "handleJoinRoom", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('join-course'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ChatGateway.prototype, "handleJoinCourse", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('send-message'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "handleSendMessage", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('send-ai-message'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "handleAIMessage", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('typing'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ChatGateway.prototype, "handleTyping", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('leave-room'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ChatGateway.prototype, "handleLeaveRoom", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('send-ai-stream'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "handleAIStream", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('get-active-users'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ChatGateway.prototype, "handleGetActiveUsers", null);
exports.ChatGateway = ChatGateway = __decorate([
    (0, websockets_1.WebSocketGateway)({
        cors: { origin: '*', methods: ['GET', 'POST'] },
        namespace: '/chat',
    }),
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [chat_service_1.ChatService,
        groupchat_service_1.GroupChatService,
        jwt_1.JwtService,
        ingestion_processor_1.IngestionProcessor,
        rag_orchestrator_service_1.RagOrchestratorService])
], ChatGateway);
//# sourceMappingURL=chat.gateway.js.map