import { Types } from 'mongoose';

export interface IMessage {
  role: string;
  content: string;
  date?: Date;
}

export class ChatEntity {
  _id?: Types.ObjectId;
  title: string;
  creator: Types.ObjectId;
  course: Types.ObjectId;
  messages: IMessage[];
  createdAt?: Date;
  updatedAt?: Date;
}

export default ChatEntity;
