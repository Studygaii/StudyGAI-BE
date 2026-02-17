import { Types } from 'mongoose';

export interface IGroupMessage {
  role: string;
  content: string;
  sender?: Types.ObjectId;
  senderName?: string;
  date?: Date;
  isAI?: boolean;
}

export class GroupChatEntity {
  _id?: Types.ObjectId;
  name: string;
  description?: string;
  creator: Types.ObjectId;
  members: Types.ObjectId[];
  course: Types.ObjectId;
  messages: IGroupMessage[];
  isActive?: boolean;
  lastMessageAt?: Date;
  avatar?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export default GroupChatEntity;
