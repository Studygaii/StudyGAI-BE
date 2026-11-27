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
exports.GroupChatService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const MAX_GROUP_MEMBERS = 5;
function extractId(val) {
    if (!val)
        return '';
    if (typeof val === 'string')
        return val;
    if (val instanceof mongoose_2.Types.ObjectId)
        return val.toString();
    if (val._id)
        return val._id.toString();
    if (val.id)
        return val.id.toString();
    return typeof val.toString === 'function' ? val.toString() : '';
}
let GroupChatService = class GroupChatService {
    constructor(groupChatModel, userModel) {
        this.groupChatModel = groupChatModel;
        this.userModel = userModel;
    }
    async hydrateMembers(groupChatObj) {
        if (!groupChatObj || !Array.isArray(groupChatObj.members))
            return groupChatObj;
        const rawIds = groupChatObj.members
            .filter((m) => typeof m === 'string' || m instanceof mongoose_2.Types.ObjectId || !m?.username)
            .map((m) => extractId(m))
            .filter((id) => mongoose_2.Types.ObjectId.isValid(id));
        if (rawIds.length === 0)
            return groupChatObj;
        const users = await this.userModel
            .find({ _id: { $in: rawIds } })
            .select('username avatar email')
            .lean();
        const userMap = new Map(users.map((u) => [u._id.toString(), u]));
        groupChatObj.members = groupChatObj.members.map((m) => {
            if (m && typeof m === 'object' && m.username)
                return m;
            const id = extractId(m);
            return userMap.get(id) || { _id: id, username: 'Member' };
        });
        return groupChatObj;
    }
    async create(body) {
        try {
            // Ensure members array is unique ObjectIds and includes creator
            const membersSet = new Set((body.members || []).map((m) => extractId(m)).filter(Boolean));
            const creatorId = extractId(body.creator);
            if (creatorId)
                membersSet.add(creatorId);
            const members = Array.from(membersSet)
                .filter((id) => mongoose_2.Types.ObjectId.isValid(id))
                .map((id) => new mongoose_2.Types.ObjectId(id));
            if (members.length > MAX_GROUP_MEMBERS) {
                throw new common_1.BadRequestException(`Group cannot have more than ${MAX_GROUP_MEMBERS} members`);
            }
            const newGroupChat = new this.groupChatModel({
                name: body.name,
                description: body.description,
                creator: new mongoose_2.Types.ObjectId(creatorId),
                members,
                course: new mongoose_2.Types.ObjectId(extractId(body.course)),
                avatar: body.avatar,
                isActive: true,
                messages: [],
            });
            const savedGroupChat = await newGroupChat.save();
            return { message: 'success', groupChat: savedGroupChat };
        }
        catch (error) {
            if (error instanceof common_1.BadRequestException)
                throw error;
            if (error.code === 11000) {
                throw new common_1.BadRequestException('Duplicate group chat');
            }
            throw new common_1.BadRequestException(error.message || 'Failed to create group chat');
        }
    }
    async list(courseID, userID) {
        const courseFilter = mongoose_2.Types.ObjectId.isValid(courseID)
            ? { $in: [courseID, new mongoose_2.Types.ObjectId(courseID)] }
            : courseID;
        const memberFilter = mongoose_2.Types.ObjectId.isValid(userID)
            ? { $in: [userID, new mongoose_2.Types.ObjectId(userID)] }
            : userID;
        const groupChats = await this.groupChatModel
            .find({
            course: courseFilter,
            $or: [{ members: memberFilter }, { creator: memberFilter }],
        })
            .populate('members', 'username avatar')
            .populate('creator', 'username')
            .sort({ lastMessageAt: -1, createdAt: -1 })
            .lean();
        const hydrated = await Promise.all(groupChats.map((gc) => this.hydrateMembers(gc)));
        return { message: 'success', groupChats: hydrated };
    }
    async getById(id, userId) {
        if (!mongoose_2.Types.ObjectId.isValid(id)) {
            throw new common_1.NotFoundException('Group chat not found');
        }
        const groupChat = await this.groupChatModel
            .findById(id)
            .populate('members', 'username avatar email')
            .populate('creator', 'username')
            .populate('messages.sender', 'username avatar')
            .lean();
        if (!groupChat) {
            throw new common_1.NotFoundException('Group chat not found');
        }
        const normalizedUserId = extractId(userId);
        const isMember = (groupChat.members || []).some((m) => extractId(m) === normalizedUserId);
        const isCreator = extractId(groupChat.creator) === normalizedUserId;
        if (!isMember && !isCreator) {
            throw new common_1.ForbiddenException('Access denied');
        }
        const hydrated = await this.hydrateMembers(groupChat);
        return { message: 'success', groupChat: hydrated };
    }
    async addMember(data) {
        const groupChat = await this.groupChatModel.findById(data.groupChatId);
        if (!groupChat) {
            throw new common_1.NotFoundException('Group chat not found');
        }
        const memberObjId = new mongoose_2.Types.ObjectId(data.userId.toString());
        const currentMembers = groupChat.members.map((m) => extractId(m));
        if (currentMembers.includes(data.userId.toString())) {
            const populated = await this.groupChatModel
                .findById(data.groupChatId)
                .populate('members', 'username avatar')
                .lean();
            return { message: 'Member added successfully', groupChat: await this.hydrateMembers(populated) };
        }
        if (currentMembers.length >= MAX_GROUP_MEMBERS) {
            throw new common_1.BadRequestException(`Group cannot have more than ${MAX_GROUP_MEMBERS} members`);
        }
        const updated = await this.groupChatModel
            .findByIdAndUpdate(data.groupChatId, { $addToSet: { members: memberObjId } }, { new: true })
            .populate('members', 'username avatar')
            .lean();
        if (!updated) {
            throw new common_1.NotFoundException('Group chat not found');
        }
        return { message: 'Member added successfully', groupChat: await this.hydrateMembers(updated) };
    }
    async removeMember(data) {
        const pullValues = [data.userId.toString()];
        if (mongoose_2.Types.ObjectId.isValid(data.userId.toString())) {
            pullValues.push(new mongoose_2.Types.ObjectId(data.userId.toString()));
        }
        const groupChat = await this.groupChatModel
            .findByIdAndUpdate(data.groupChatId, { $pull: { members: { $in: pullValues } } }, { new: true })
            .populate('members', 'username avatar')
            .lean();
        if (!groupChat) {
            throw new common_1.NotFoundException('Group chat not found');
        }
        return { message: 'Member removed successfully', groupChat: await this.hydrateMembers(groupChat) };
    }
    async addMessage(groupChatId, message) {
        const groupChat = await this.groupChatModel
            .findByIdAndUpdate(groupChatId, {
            $push: { messages: message },
            $set: { lastMessageAt: new Date() },
        }, { new: true })
            .populate('messages.sender', 'username avatar');
        return { message: 'Message added successfully', groupChat };
    }
    async deleteGroupChat(id, userId) {
        const groupChat = await this.groupChatModel.findById(id);
        if (!groupChat) {
            throw new common_1.NotFoundException('Group chat not found');
        }
        if (extractId(groupChat.creator) !== extractId(userId)) {
            throw new common_1.ForbiddenException('Only creator can delete this group chat');
        }
        await this.groupChatModel.findByIdAndDelete(id);
        return { message: 'Group chat deleted successfully' };
    }
    async updateGroupChat(id, userId, updates) {
        const groupChat = await this.groupChatModel.findById(id);
        if (!groupChat) {
            throw new common_1.NotFoundException('Group chat not found');
        }
        if (extractId(groupChat.creator) !== extractId(userId)) {
            throw new common_1.ForbiddenException('Only creator can update this group chat');
        }
        const updated = await this.groupChatModel.findByIdAndUpdate(id, updates, {
            new: true,
        });
        return { message: 'Group chat updated successfully', groupChat: updated };
    }
};
exports.GroupChatService = GroupChatService;
exports.GroupChatService = GroupChatService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)('groupchats')),
    __param(1, (0, mongoose_1.InjectModel)('users')),
    __metadata("design:paramtypes", [mongoose_2.Model,
        mongoose_2.Model])
], GroupChatService);
//# sourceMappingURL=groupchat.service.js.map