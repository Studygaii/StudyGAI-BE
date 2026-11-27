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
exports.ChatService = void 0;
// src/chat/chat.service.ts
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const rag_orchestrator_service_1 = require("../rag/rag-orchestrator.service");
let ChatService = class ChatService {
    constructor(chatModel, courseModel, ragOrchestrator) {
        this.chatModel = chatModel;
        this.courseModel = courseModel;
        this.ragOrchestrator = ragOrchestrator;
    }
    async list(courseID, userID) {
        const chats = await this.chatModel
            .find({ course: courseID, creator: userID })
            .sort({ createdAt: -1 });
        return { message: 'success', chats };
    }
    async create(body) {
        try {
            const newChat = new this.chatModel({
                title: body.title ||
                    (body.courseTitle ? body.courseTitle + Date.now() : 'chat' + Date.now()),
                creator: body.creator,
                course: body.course,
                messages: body.messages || [],
            });
            const savedChat = await newChat.save();
            return { message: 'success', chat: savedChat };
        }
        catch (error) {
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
    async send(messages, courseId, options = {}) {
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
    async sendStream(messages, courseId, options = {}) {
        return this.ragOrchestrator.answerStream({
            messages,
            courseId,
            userId: options.userId,
            sourceIds: options.sourceIds,
            mode: options.mode,
        });
    }
    /** Backward-compatible alias used by GroupChatController & ChatGateway */
    async sendWithContext(messages, courseId, options = {}) {
        return this.send(messages, courseId, options);
    }
    /** Backward-compatible streaming alias */
    async sendStreamWithContext(messages, courseId, options = {}) {
        return this.sendStream(messages, courseId, options);
    }
    async remove(id, userId) {
        try {
            const result = await this.chatModel.findOneAndDelete({ _id: id, creator: userId });
            if (result) {
                return { message: 'success', id };
            }
            return { status: 404, error: 'Item not found' };
        }
        catch {
            return { status: 500, error: 'Error deleting item' };
        }
    }
    async getChatWithCourse(chatId, userId) {
        try {
            const chat = await this.chatModel
                .findOne({ _id: chatId, creator: userId })
                .populate('course', 'title pdfProcessed sourceCount totalTokens');
            if (!chat) {
                return { status: 404, error: 'Chat not found' };
            }
            return { message: 'success', chat };
        }
        catch (error) {
            return { status: 500, error: error.message };
        }
    }
    async addMessageToChat(chatId, message) {
        try {
            const chat = await this.chatModel.findByIdAndUpdate(chatId, { $push: { messages: message } }, { new: true });
            if (!chat) {
                return { status: 404, error: 'Chat not found' };
            }
            return { message: 'Message added successfully', chat };
        }
        catch (error) {
            return { status: 500, error: error.message };
        }
    }
};
exports.ChatService = ChatService;
exports.ChatService = ChatService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)('chats')),
    __param(1, (0, mongoose_1.InjectModel)('courses')),
    __metadata("design:paramtypes", [mongoose_2.Model,
        mongoose_2.Model,
        rag_orchestrator_service_1.RagOrchestratorService])
], ChatService);
//# sourceMappingURL=chat.service.js.map