import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserMasteryDocument = UserMastery & Document;

/**
 * Per-user, per-course Concept Mastery record for Mastery-Aware Adaptive RAG.
 * Updated automatically from Quiz attempts and Anki Flashcard reviews.
 * Indexed by `{ user, course, conceptKey }` (unique) for O(1) lookups at 100M+ scale.
 */
@Schema({ timestamps: true, collection: 'user_masteries' })
export class UserMastery {
  @Prop({ type: Types.ObjectId, ref: 'users', required: true, index: true })
  user: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'courses', required: true, index: true })
  course: Types.ObjectId;

  /** Normalized lowercase slug (e.g. "chain-rule") */
  @Prop({ type: String, required: true })
  conceptKey: string;

  /** Human-readable concept label (e.g. "Chain Rule") */
  @Prop({ type: String, required: true })
  label: string;

  /** Exponentially weighted mastery score in [0, 100] */
  @Prop({ type: Number, default: 50, min: 0, max: 100 })
  masteryScore: number;

  @Prop({ type: Number, default: 0 })
  attempts: number;

  @Prop({ type: Number, default: 0 })
  correctCount: number;

  @Prop({ type: Number, default: 0 })
  streak: number;

  /** Recent missed prompts / card fronts to help the tutor target exact misconceptions */
  @Prop({ type: [String], default: [] })
  recentMisses: string[];

  @Prop({ type: Date, default: Date.now })
  lastReviewedAt: Date;
}

export const UserMasterySchema = SchemaFactory.createForClass(UserMastery);
UserMasterySchema.index({ user: 1, course: 1, conceptKey: 1 }, { unique: true });
UserMasterySchema.index({ user: 1, course: 1, masteryScore: 1 });
