import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CourseDocument = Course & Document;

@Schema({ timestamps: true })
export class Course {
  /** Scoped per-creator via compound unique index below (no longer globally unique across 100M users!) */
  @Prop({ required: true })
  title: string;

  @Prop()
  description: string;

  @Prop({ type: Types.ObjectId, ref: 'users', required: true, index: true })
  creator: Types.ObjectId;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'chats' }] })
  chats: Types.ObjectId[];

  @Prop({ type: [{ path: String, name: String }] })
  files: any[];

  @Prop({ default: Date.now })
  date: Date;

  /** Multi-source notebook summary metadata */
  @Prop({ type: Number, default: 0 })
  sourceCount: number;

  @Prop({ type: Number, default: 0 })
  totalTokens: number;

  @Prop({ type: Number, default: 2 })
  ragVersion: number;

  /** Legacy single-document fields retained for backward compatibility with older records/UI */
  @Prop({ type: String, default: '' })
  pdfContent: string;

  @Prop({ type: String, default: '' })
  pdfMarkdown: string;

  @Prop({ type: Object, default: null })
  pdfJson?: Record<string, any> | null;

  @Prop({ type: Number, default: null })
  pdfPageCount?: number | null;

  @Prop({ type: Number, default: null })
  pdfCharCount?: number | null;

  @Prop({ type: Boolean, default: false })
  pdfProcessed: boolean;

  @Prop({ type: Date, default: null })
  pdfProcessedAt?: Date | null;

  @Prop({ type: String, default: null })
  pdfFileName?: string | null;

  // Embedded flashcards array stored on the course document
  @Prop({
    type: [
      {
        front: { type: String, required: true },
        back: { type: String, required: true },
        tags: { type: [String], default: [] },
        creator: { type: Types.ObjectId, ref: 'users', required: true },
        easeFactor: { type: Number, default: 2.5 },
        interval: { type: Number, default: 0 },
        dueDate: { type: Date, default: null },
        reviewCount: { type: Number, default: 0 },
        lastReviewedAt: { type: Date },
        stats: { type: Map, of: Object, default: {} },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  flashcards: any[];
}

export const CourseSchema = SchemaFactory.createForClass(Course);

// Per-user unique course titles instead of global uniqueness
CourseSchema.index({ creator: 1, title: 1 }, { unique: true });

// Pre-delete cleanup
CourseSchema.pre('deleteOne', { document: true, query: false }, async function (next) {
  const mongoose = require('mongoose');
  await mongoose.model('chats').deleteMany({ _id: { $in: this.chats } });
  next();
});
