import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SourceBlobDocument = SourceBlob & Document;

export type SourceType =
  | 'pdf'
  | 'docx'
  | 'pptx'
  | 'txt'
  | 'markdown'
  | 'image'
  | 'url'
  | 'youtube'
  | 'audio'
  | 'note';

export type IngestionStatus =
  | 'pending_upload'
  | 'queued'
  | 'parsing'
  | 'chunking'
  | 'embedding'
  | 'ready'
  | 'failed';

export interface ITocEntry {
  level: number;
  title: string;
  page: number;
  parentIndex: number;
}

@Schema({ timestamps: true, collection: 'source_blobs' })
export class SourceBlob {
  /** Global SHA-256 content hash for cross-user deduplication at 100M+ scale */
  @Prop({ required: true, unique: true, index: true })
  sha256: string;

  /** Canonical URL for web / YouTube sources (sparse unique index) */
  @Prop({ type: String, sparse: true, index: true })
  canonicalUrl?: string;

  @Prop({
    type: String,
    required: true,
    enum: ['pdf', 'docx', 'pptx', 'txt', 'markdown', 'image', 'url', 'youtube', 'audio', 'note'],
  })
  sourceType: SourceType;

  @Prop({ type: String, default: '' })
  originalName: string;

  @Prop({ type: String, default: 'application/octet-stream' })
  mimeType: string;

  @Prop({ type: Number, default: 0 })
  byteSize: number;

  /** Object storage key (S3 / MinIO / R2 or local content-sharded path) for raw file */
  @Prop({ type: String, default: '' })
  storageKey: string;

  /** Object storage key for extracted structured Markdown */
  @Prop({ type: String, default: '' })
  markdownKey: string;

  /** Structured Table of Contents tree for document-level navigation & synthesis */
  @Prop({
    type: [
      {
        level: { type: Number, required: true },
        title: { type: String, required: true },
        page: { type: Number, default: 1 },
        parentIndex: { type: Number, default: 0 },
      },
    ],
    default: [],
  })
  toc: ITocEntry[];

  /** Short cached preview/summary for fast notebook overview */
  @Prop({ type: String, default: '' })
  summary: string;

  @Prop({ type: Number, default: 1 })
  pageCount: number;

  @Prop({ type: Number, default: 0 })
  charCount: number;

  @Prop({ type: Number, default: 0 })
  tokenEstimate: number;

  @Prop({ type: Number, default: 0 })
  parentCount: number;

  @Prop({ type: Number, default: 0 })
  chunkCount: number;

  @Prop({ type: String, default: '' })
  extractionMethod: string;

  @Prop({ type: String, default: '' })
  embeddingModel: string;

  @Prop({ type: String, default: 'source_chunks' })
  vectorCollection: string;

  @Prop({
    type: String,
    enum: ['pending_upload', 'queued', 'parsing', 'chunking', 'embedding', 'ready', 'failed'],
    default: 'queued',
    index: true,
  })
  status: IngestionStatus;

  @Prop({ type: String, default: '' })
  errorMessage: string;

  /** Active reference count across CourseSource records for safe GC & cold-tiering */
  @Prop({ type: Number, default: 1, index: true })
  refCount: number;

  /** Vector tier state for hot/cold Qdrant lifecycle management */
  @Prop({ type: String, enum: ['hot', 'cold'], default: 'hot', index: true })
  vectorTier: 'hot' | 'cold';

  /** Object storage key for archived gzipped JSONL vector snapshot when vectorTier === 'cold' */
  @Prop({ type: String, default: '' })
  vectorArchiveKey: string;

  @Prop({ type: Date, default: Date.now, index: true })
  lastAccessedAt: Date;
}

export const SourceBlobSchema = SchemaFactory.createForClass(SourceBlob);
SourceBlobSchema.index({ vectorTier: 1, lastAccessedAt: 1 });
