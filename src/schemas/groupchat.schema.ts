import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type GroupChatDocument = GroupChat & Document;

export interface IGroupMessage {
  role: string;
  content: string;
  sender?: Types.ObjectId;
  senderName?: string;
  date?: Date;
  isAI?: boolean;
}

@Schema({ timestamps: true })
export class GroupChat {
  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: String })
  description: string;

  @Prop({ type: Types.ObjectId, ref: 'users', required: true })
  creator: Types.ObjectId;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'users' }], required: true })
  members: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'courses', required: true })
  course: Types.ObjectId;

  @Prop({
    type: [
      {
        role: { type: String, required: true },
        content: { type: String, required: true },
        sender: { type: Types.ObjectId, ref: 'users', required: false }, // optional for AI/StudyGAI
        senderName: { type: String },
        date: { type: Date, default: Date.now },
        isAI: { type: Boolean, default: false },
      },
    ],
    default: [],
  })
  messages: IGroupMessage[];

  @Prop({ type: Boolean, default: false })
  isActive: boolean;

  @Prop({ type: Date })
  lastMessageAt?: Date;

  @Prop({ type: String })
  avatar?: string;
}

export const GroupChatSchema = SchemaFactory.createForClass(GroupChat);

GroupChatSchema.pre('deleteOne', { document: true, query: false }, async function(next) {
  // Cleanup can be added here if needed
  next();
});
