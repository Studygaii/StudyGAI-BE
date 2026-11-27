import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GroupChatDocument } from '../schemas/groupchat.schema';
import { UserDocument } from '../schemas/user.schema';
import { CreateGroupChatDto, AddMemberDto, RemoveMemberDto } from './dto/create-groupchat.dto';

const MAX_GROUP_MEMBERS = 5;

function extractId(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (val instanceof Types.ObjectId) return val.toString();
  if (val._id) return val._id.toString();
  if (val.id) return val.id.toString();
  return typeof val.toString === 'function' ? val.toString() : '';
}

@Injectable()
export class GroupChatService {
  constructor(
    @InjectModel('groupchats') private groupChatModel: Model<GroupChatDocument>,
    @InjectModel('users') private userModel: Model<UserDocument>,
  ) {}

  private async hydrateMembers(groupChatObj: any): Promise<any> {
    if (!groupChatObj || !Array.isArray(groupChatObj.members)) return groupChatObj;

    const rawIds = groupChatObj.members
      .filter((m: any) => typeof m === 'string' || m instanceof Types.ObjectId || !m?.username)
      .map((m: any) => extractId(m))
      .filter((id: string) => Types.ObjectId.isValid(id));

    if (rawIds.length === 0) return groupChatObj;

    const users = await this.userModel
      .find({ _id: { $in: rawIds } })
      .select('username avatar email')
      .lean();
    const userMap = new Map(users.map((u: any) => [u._id.toString(), u]));

    groupChatObj.members = groupChatObj.members.map((m: any) => {
      if (m && typeof m === 'object' && m.username) return m;
      const id = extractId(m);
      return userMap.get(id) || { _id: id, username: 'Member' };
    });

    return groupChatObj;
  }

  async create(body: CreateGroupChatDto) {
    try {
      // Ensure members array is unique ObjectIds and includes creator
      const membersSet = new Set((body.members || []).map((m: any) => extractId(m)).filter(Boolean));
      const creatorId = extractId(body.creator);
      if (creatorId) membersSet.add(creatorId);
      const members = Array.from(membersSet)
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));

      if (members.length > MAX_GROUP_MEMBERS) {
        throw new BadRequestException(`Group cannot have more than ${MAX_GROUP_MEMBERS} members`);
      }

      const newGroupChat = new this.groupChatModel({
        name: body.name,
        description: body.description,
        creator: new Types.ObjectId(creatorId),
        members,
        course: new Types.ObjectId(extractId(body.course)),
        avatar: body.avatar,
        isActive: true,
        messages: [],
      });
      const savedGroupChat = await newGroupChat.save();
      return { message: 'success', groupChat: savedGroupChat };
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      if (error.code === 11000) {
        throw new BadRequestException('Duplicate group chat');
      }
      throw new BadRequestException(error.message || 'Failed to create group chat');
    }
  }

  async list(courseID: string, userID: string) {
    const courseFilter = Types.ObjectId.isValid(courseID)
      ? { $in: [courseID, new Types.ObjectId(courseID)] }
      : courseID;
    const memberFilter = Types.ObjectId.isValid(userID)
      ? { $in: [userID, new Types.ObjectId(userID)] }
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

  async getById(id: string, userId: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Group chat not found');
    }

    const groupChat = await this.groupChatModel
      .findById(id)
      .populate('members', 'username avatar email')
      .populate('creator', 'username')
      .populate('messages.sender', 'username avatar')
      .lean();

    if (!groupChat) {
      throw new NotFoundException('Group chat not found');
    }

    const normalizedUserId = extractId(userId);
    const isMember = (groupChat.members || []).some((m: any) => extractId(m) === normalizedUserId);
    const isCreator = extractId(groupChat.creator) === normalizedUserId;
    if (!isMember && !isCreator) {
      throw new ForbiddenException('Access denied');
    }

    const hydrated = await this.hydrateMembers(groupChat);
    return { message: 'success', groupChat: hydrated };
  }

  async addMember(data: AddMemberDto) {
    const groupChat = await this.groupChatModel.findById(data.groupChatId);
    if (!groupChat) {
      throw new NotFoundException('Group chat not found');
    }

    const memberObjId = new Types.ObjectId(data.userId.toString());
    const currentMembers = groupChat.members.map((m: any) => extractId(m));
    if (currentMembers.includes(data.userId.toString())) {
      const populated = await this.groupChatModel
        .findById(data.groupChatId)
        .populate('members', 'username avatar')
        .lean();
      return { message: 'Member added successfully', groupChat: await this.hydrateMembers(populated) };
    }

    if (currentMembers.length >= MAX_GROUP_MEMBERS) {
      throw new BadRequestException(`Group cannot have more than ${MAX_GROUP_MEMBERS} members`);
    }

    const updated = await this.groupChatModel
      .findByIdAndUpdate(
        data.groupChatId,
        { $addToSet: { members: memberObjId } },
        { new: true },
      )
      .populate('members', 'username avatar')
      .lean();

    if (!updated) {
      throw new NotFoundException('Group chat not found');
    }

    return { message: 'Member added successfully', groupChat: await this.hydrateMembers(updated) };
  }

  async removeMember(data: RemoveMemberDto) {
    const pullValues: any[] = [data.userId.toString()];
    if (Types.ObjectId.isValid(data.userId.toString())) {
      pullValues.push(new Types.ObjectId(data.userId.toString()));
    }

    const groupChat = await this.groupChatModel
      .findByIdAndUpdate(
        data.groupChatId,
        { $pull: { members: { $in: pullValues } } },
        { new: true },
      )
      .populate('members', 'username avatar')
      .lean();

    if (!groupChat) {
      throw new NotFoundException('Group chat not found');
    }

    return { message: 'Member removed successfully', groupChat: await this.hydrateMembers(groupChat) };
  }

  async addMessage(groupChatId: string, message: any) {
    const groupChat = await this.groupChatModel
      .findByIdAndUpdate(
        groupChatId,
        {
          $push: { messages: message },
          $set: { lastMessageAt: new Date() },
        },
        { new: true },
      )
      .populate('messages.sender', 'username avatar');

    return { message: 'Message added successfully', groupChat };
  }

  async deleteGroupChat(id: string, userId: string) {
    const groupChat = await this.groupChatModel.findById(id);

    if (!groupChat) {
      throw new NotFoundException('Group chat not found');
    }

    if (extractId(groupChat.creator) !== extractId(userId)) {
      throw new ForbiddenException('Only creator can delete this group chat');
    }

    await this.groupChatModel.findByIdAndDelete(id);
    return { message: 'Group chat deleted successfully' };
  }

  async updateGroupChat(id: string, userId: string, updates: any) {
    const groupChat = await this.groupChatModel.findById(id);

    if (!groupChat) {
      throw new NotFoundException('Group chat not found');
    }

    if (extractId(groupChat.creator) !== extractId(userId)) {
      throw new ForbiddenException('Only creator can update this group chat');
    }

    const updated = await this.groupChatModel.findByIdAndUpdate(id, updates, {
      new: true,
    });

    return { message: 'Group chat updated successfully', groupChat: updated };
  }
}
