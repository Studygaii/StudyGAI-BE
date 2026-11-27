import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { IngestionStatus, SourceType } from './source-blob.schema';

export type CourseSourceDocument = CourseSource & Document;

/**
 * Links a Course (Notebook) to a deduplicated SourceBlob with NotebookLM-style
 * per-source selection (`enabled`), custom display title, and status tracking.
 */
@Schema({ timestamps: true, collection: 'course_sources' })
export class CourseSource {
  @Prop({ type: Types.ObjectId, ref: 'courses', required: true, index: true })
  course: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'source_blobs', required: true, index: true })
  blob: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'users', required: true, index: true })
  addedBy: Types.ObjectId;

  @Prop({ type: String, required: true })
  title: string;

  @Prop({
    type: String,
    required: true,
    enum: ['pdf', 'docx', 'pptx', 'txt', 'markdown', 'image', 'url', 'youtube', 'audio', 'note'],
  })
  sourceType: SourceType;

  @Prop({ type: String, default: '' })
  originUrl: string;

  /** NotebookLM-style checkbox: include/exclude this source from chat & studio tools */
  @Prop({ type: Boolean, default: true, index: true })
  enabled: boolean;

  @Prop({
    type: String,
    enum: ['pending_upload', 'queued', 'parsing', 'chunking', 'embedding', 'ready', 'failed'],
    default: 'queued',
    index: true,
  })
  status: IngestionStatus;

  @Prop({ type: String, default: '' })
  errorMessage: string;
}

export const CourseSourceSchema = SchemaFactory.createForClass(CourseSource);
CourseSourceSchema.index({ course: 1, blob: 1 }, { unique: true });
CourseSourceSchema.index({ course: 1, enabled: 1, status: 1 });
