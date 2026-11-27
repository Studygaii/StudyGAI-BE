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
exports.GroupChatController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const groupchat_service_1 = require("./groupchat.service");
const chat_service_1 = require("./chat.service");
const swagger_1 = require("@nestjs/swagger");
const create_groupchat_dto_1 = require("./dto/create-groupchat.dto");
let GroupChatController = class GroupChatController {
    constructor(groupChatService, chatService) {
        this.groupChatService = groupChatService;
        this.chatService = chatService;
    }
    async create(body, req) {
        const userId = req.user?.id || req.user?._id;
        const creator = body.creator || userId;
        const members = body.members && body.members.length > 0 ? body.members : [creator];
        return await this.groupChatService.create({ ...body, creator, members });
    }
    async list(courseID, req) {
        return await this.groupChatService.list(courseID, req.user?.id);
    }
    async getById(id, req) {
        return await this.groupChatService.getById(id, req.user?.id);
    }
    async addMember(body) {
        return await this.groupChatService.addMember(body);
    }
    async removeMember(body) {
        return await this.groupChatService.removeMember(body);
    }
    async update(id, body, req) {
        return await this.groupChatService.updateGroupChat(id, req.user?.id, body);
    }
    async delete(id, req) {
        return await this.groupChatService.deleteGroupChat(id, req.user?.id);
    }
    async sendMessage(groupChatId, body, req) {
        const userId = req.user?.id || req.user?._id;
        const { message } = body;
        const result = await this.groupChatService.getById(groupChatId, userId);
        if (result.status === 404 || result.status === 403) {
            return result;
        }
        const gc = result.groupChat;
        const courseId = gc?.course?._id?.toString() || gc?.course?.toString();
        await this.groupChatService.addMessage(groupChatId, {
            role: 'user',
            content: message,
            sender: userId,
            senderName: req.user?.username || 'User',
            date: new Date(),
        });
        const hasMention = /@studygai/i.test(message);
        if (hasMention && courseId) {
            const query = message.replace(/@studygai\s*/gi, '').trim() || message;
            const response = await this.chatService.send([{ role: 'user', content: query }], courseId, { userId });
            const aiContent = response?.content || response?.choices?.[0]?.message?.content || 'No response';
            await this.groupChatService.addMessage(groupChatId, {
                role: 'assistant',
                content: aiContent,
                senderName: 'StudyGAI',
                date: new Date(),
                isAI: true,
            });
            return {
                message: 'Message sent and StudyGAI responded',
                userMessage: message,
                aiResponse: aiContent,
                citations: response?.citations || [],
                retrievalMeta: response?.retrievalMeta,
            };
        }
        return { message: 'Message sent successfully' };
    }
};
exports.GroupChatController = GroupChatController;
__decorate([
    (0, common_1.Post)('create'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Create a new group chat' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_groupchat_dto_1.CreateGroupChatDto, Object]),
    __metadata("design:returntype", Promise)
], GroupChatController.prototype, "create", null);
__decorate([
    (0, common_1.Get)('list/:courseID'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'List all group chats in a course' }),
    __param(0, (0, common_1.Param)('courseID')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], GroupChatController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Get group chat details' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], GroupChatController.prototype, "getById", null);
__decorate([
    (0, common_1.Post)('add-member'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Add member to group chat' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_groupchat_dto_1.AddMemberDto]),
    __metadata("design:returntype", Promise)
], GroupChatController.prototype, "addMember", null);
__decorate([
    (0, common_1.Post)('remove-member'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Remove member from group chat' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_groupchat_dto_1.RemoveMemberDto]),
    __metadata("design:returntype", Promise)
], GroupChatController.prototype, "removeMember", null);
__decorate([
    (0, common_1.Put)(':id'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Update group chat' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], GroupChatController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Delete group chat' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], GroupChatController.prototype, "delete", null);
__decorate([
    (0, common_1.Post)(':id/send-message'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({
        summary: 'Send message to group chat. Use @studygai in message to trigger grounded RAG AI response.',
    }),
    (0, swagger_1.ApiBody)({
        schema: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
        },
    }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], GroupChatController.prototype, "sendMessage", null);
exports.GroupChatController = GroupChatController = __decorate([
    (0, swagger_1.ApiTags)('Group Chat'),
    (0, swagger_1.ApiBearerAuth)('jwt'),
    (0, common_1.Controller)('api/v1/groupchat'),
    __metadata("design:paramtypes", [groupchat_service_1.GroupChatService,
        chat_service_1.ChatService])
], GroupChatController);
//# sourceMappingURL=groupchat.controller.js.map