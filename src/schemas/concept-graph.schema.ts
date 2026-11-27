import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ConceptGraphDocument = ConceptGraph & Document;

export type ConceptCategory = 'core' | 'formula' | 'definition' | 'application' | 'person';
export type ConceptRelation =
  | 'prerequisite_of'
  | 'part_of'
  | 'extends'
  | 'contrasts_with'
  | 'applies_to';

export interface IConceptNode {
  id: string;
  label: string;
  category: ConceptCategory;
  summary: string;
  importance: number; // 1..5
  sourceTitle?: string;
  pageHint?: number;
}

export interface IConceptEdge {
  from: string;
  to: string;
  relation: ConceptRelation;
  label: string;
}

/**
 * Lightweight GraphRAG Knowledge Graph per Course Notebook.
 * Powers both interactive Mind Maps in Study Studio AND multi-hop prerequisite
 * query expansion inside RagOrchestratorService.
 */
@Schema({ timestamps: true, collection: 'concept_graphs' })
export class ConceptGraph {
  @Prop({ type: Types.ObjectId, ref: 'courses', required: true, unique: true, index: true })
  course: Types.ObjectId;

  /** Hash of sorted active source blobIds so unchanged notebooks return instant cached graphs */
  @Prop({ type: String, default: '' })
  sourceSignature: string;

  @Prop({
    type: [
      {
        id: { type: String, required: true },
        label: { type: String, required: true },
        category: {
          type: String,
          enum: ['core', 'formula', 'definition', 'application', 'person'],
          default: 'core',
        },
        summary: { type: String, default: '' },
        importance: { type: Number, default: 3 },
        sourceTitle: { type: String, default: '' },
        pageHint: { type: Number, default: 1 },
      },
    ],
    default: [],
  })
  nodes: IConceptNode[];

  @Prop({
    type: [
      {
        from: { type: String, required: true },
        to: { type: String, required: true },
        relation: {
          type: String,
          enum: ['prerequisite_of', 'part_of', 'extends', 'contrasts_with', 'applies_to'],
          default: 'extends',
        },
        label: { type: String, default: '' },
      },
    ],
    default: [],
  })
  edges: IConceptEdge[];
}

export const ConceptGraphSchema = SchemaFactory.createForClass(ConceptGraph);
