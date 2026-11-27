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
exports.ChatController = void 0;
// src/chat/chat.controller.ts
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const chat_service_1 = require("./chat.service");
const swagger_1 = require("@nestjs/swagger");
const create_chat_dto_1 = require("./dto/create-chat.dto");
const send_messages_with_course_dto_1 = require("./dto/send-messages-with-course.dto");
const rag_orchestrator_service_1 = require("../rag/rag-orchestrator.service");
let ChatController = class ChatController {
    constructor(chatService, ragOrchestrator) {
        this.chatService = chatService;
        this.ragOrchestrator = ragOrchestrator;
    }
    test() {
        return { msg: 'Chat Works!' };
    }
    async list(courseID, req) {
        return await this.chatService.list(courseID, req.user?.id);
    }
    async create(body, req) {
        const userId = req.user?.id || req.user?._id;
        return await this.chatService.create({ ...body, creator: body.creator || userId });
    }
    async remove(id, req) {
        return await this.chatService.remove(id, req.user?.id);
    }
    async send(body, req) {
        const userId = req.user?.id || req.user?._id;
        return await this.chatService.send(body.messages, body.courseId, {
            userId,
            sourceIds: body.sourceIds,
            mode: body.mode,
        });
    }
    async sendStream(body, req, res) {
        try {
            const userId = req.user?.id || req.user?._id;
            const ragStream = await this.chatService.sendStream(body.messages, body.courseId, {
                userId,
                sourceIds: body.sourceIds,
                mode: body.mode,
            });
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            // Send retrieval strategy, adaptive/graph signals & candidate citations upfront
            res.write(`data: ${JSON.stringify({
                type: 'meta',
                strategy: ragStream.strategy,
                rewrittenQuery: ragStream.rewrittenQuery,
                sourcesSearched: ragStream.sourcesSearched,
                graphExpandedConcepts: ragStream.graphExpandedConcepts,
                adaptiveMastery: ragStream.adaptiveMastery,
                citations: ragStream.citations,
            })}\n\n`);
            let fullContent = '';
            for await (const delta of ragStream.stream) {
                if (delta) {
                    fullContent += delta;
                    res.write(`data: ${JSON.stringify({ type: 'token', content: delta })}\n\n`);
                }
            }
            // Send final verified citations marking which [n] indices appeared in the generated answer
            const verifiedCitations = this.ragOrchestrator.markCitedReferences(fullContent, ragStream.citations);
            res.write(`data: ${JSON.stringify({ type: 'citations', citations: verifiedCitations })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
        }
        catch (error) {
            if (!res.headersSent) {
                res.status(error?.status || 500).json({ error: error.message });
            }
            else {
                res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
                res.end();
            }
        }
    }
    async getChatWithCourse(chatId, req) {
        return await this.chatService.getChatWithCourse(chatId, req.user?.id);
    }
};
exports.ChatController = ChatController;
__decorate([
    (0, common_1.Get)('test'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "test", null);
__decorate([
    (0, common_1.Get)('list/:courseID'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('courseID')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "list", null);
__decorate([
    (0, common_1.Post)('new'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Create new chat' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Chat created' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_chat_dto_1.CreateChatDto, Object]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "create", null);
__decorate([
    (0, common_1.Delete)('delete/:id'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Delete a chat' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Chat deleted' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)('send'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({
        summary: 'Send messages with Hybrid RAG grounding, selective sources, and inline citations',
    }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Grounded AI response with verified citations returned' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [send_messages_with_course_dto_1.SendMessagesWithCourseDto, Object]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "send", null);
__decorate([
    (0, common_1.Post)('send-stream'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({
        summary: 'Stream grounded RAG response over SSE with citation metadata',
    }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Streaming response started' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [send_messages_with_course_dto_1.SendMessagesWithCourseDto, Object, Object]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "sendStream", null);
__decorate([
    (0, common_1.Get)('with-course/:chatId'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Get chat with course info' }),
    __param(0, (0, common_1.Param)('chatId')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "getChatWithCourse", null);
exports.ChatController = ChatController = __decorate([
    (0, swagger_1.ApiTags)('Chat'),
    (0, swagger_1.ApiBearerAuth)('jwt'),
    (0, common_1.Controller)('api/v1/chat'),
    __metadata("design:paramtypes", [chat_service_1.ChatService,
        rag_orchestrator_service_1.RagOrchestratorService])
], ChatController);
//# sourceMappingURL=chat.controller.js.map