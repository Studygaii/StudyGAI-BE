import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type StudyArtifactDocument = StudyArtifact & Document;

export type StudyArtifactType = 'audio_overview' | 'exam_predictor' | 'study_guide';

/**
 * Persisted NotebookLM+ Study Studio artifacts (2-Host Audio Overviews,
 * High-Yield Exam Predictors, Study Guides) linked to a course notebook.
 */
@Schema({ timestamps: true, collection: 'study_artifacts' })
export class StudyArtifact {
  @Prop({ type: Types.ObjectId, ref: 'courses', required: true, index: true })
  course: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'users', required: true, index: true })
  createdBy: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: ['audio_overview', 'exam_predictor', 'study_guide'],
    index: true,
  })
  artifactType: StudyArtifactType;

  @Prop({ type: String, required: true })
  title: string;

  @Prop({ type: String, default: '' })
  subtitle: string;

  @Prop({ type: [String], default: [] })
  sourceIds: string[];

  /** Flexible structured payload (dialogue turns + chapters for audio, high-yield topics for exam predictor) */
  @Prop({ type: Object, required: true })
  payload: Record<string, any>;

  @Prop({ type: Number, default: 0 })
  estimatedDurationSec: number;
}

export const StudyArtifactSchema = SchemaFactory.createForClass(StudyArtifact);
StudyArtifactSchema.index({ course: 1, artifactType: 1, createdAt: -1 });
