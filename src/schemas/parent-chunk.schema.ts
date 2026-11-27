import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ParentChunkDocument = ParentChunk & Document;

/**
 * Stores larger parent sections (~1,000–1,400 tokens) decoupled from Course documents
 * and Qdrant child points, enabling Small-to-Big context expansion at query time.
 */
@Schema({ timestamps: true, collection: 'parent_chunks' })
export class ParentChunk {
  @Prop({ type: Types.ObjectId, ref: 'source_blobs', required: true, index: true })
  blob: Types.ObjectId;

  @Prop({ type: Number, required: true })
  parentIndex: number;

  @Prop({ type: String, required: true })
  text: string;

  @Prop({ type: String, default: 'Document' })
  sectionPath: string;

  @Prop({ type: Number, default: 1 })
  pageStart: number;

  @Prop({ type: Number, default: 1 })
  pageEnd: number;

  @Prop({ type: Number, default: 0 })
  tokenCount: number;

  @Prop({ type: Boolean, default: false })
  hasFormula: boolean;

  @Prop({ type: Boolean, default: false })
  hasTable: boolean;
}

export const ParentChunkSchema = SchemaFactory.createForClass(ParentChunk);
ParentChunkSchema.index({ blob: 1, parentIndex: 1 }, { unique: true });
