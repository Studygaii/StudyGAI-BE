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
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupChatSchema = exports.GroupChat = void 0;
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
let GroupChat = class GroupChat {
};
exports.GroupChat = GroupChat;
__decorate([
    (0, mongoose_1.Prop)({ type: String, required: true }),
    __metadata("design:type", String)
], GroupChat.prototype, "name", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String }),
    __metadata("design:type", String)
], GroupChat.prototype, "description", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: mongoose_2.Schema.Types.ObjectId, ref: 'users', required: true }),
    __metadata("design:type", mongoose_2.Types.ObjectId)
], GroupChat.prototype, "creator", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: [{ type: mongoose_2.Schema.Types.ObjectId, ref: 'users' }], required: true }),
    __metadata("design:type", Array)
], GroupChat.prototype, "members", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: mongoose_2.Schema.Types.ObjectId, ref: 'courses', required: true }),
    __metadata("design:type", mongoose_2.Types.ObjectId)
], GroupChat.prototype, "course", void 0);
__decorate([
    (0, mongoose_1.Prop)({
        type: [
            {
                role: { type: String, required: true },
                content: { type: String, required: true },
                sender: { type: mongoose_2.Schema.Types.ObjectId, ref: 'users', required: false }, // optional for AI/StudyGAI
                senderName: { type: String },
                date: { type: Date, default: Date.now },
                isAI: { type: Boolean, default: false },
            },
        ],
        default: [],
    }),
    __metadata("design:type", Array)
], GroupChat.prototype, "messages", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Boolean, default: false }),
    __metadata("design:type", Boolean)
], GroupChat.prototype, "isActive", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Date }),
    __metadata("design:type", Date)
], GroupChat.prototype, "lastMessageAt", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String }),
    __metadata("design:type", String)
], GroupChat.prototype, "avatar", void 0);
exports.GroupChat = GroupChat = __decorate([
    (0, mongoose_1.Schema)({ timestamps: true })
], GroupChat);
exports.GroupChatSchema = mongoose_1.SchemaFactory.createForClass(GroupChat);
exports.GroupChatSchema.pre('deleteOne', { document: true, query: false }, async function (next) {
    // Cleanup can be added here if needed
    next();
});
//# sourceMappingURL=groupchat.schema.js.map