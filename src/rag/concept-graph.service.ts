import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import {
  ConceptGraphDocument,
  IConceptEdge,
  IConceptNode,
} from '../schemas/concept-graph.schema';
import { LlmService } from '../common/llm.service';
import { SourcesService } from './sources.service';
import { MasteryService } from './mastery.service';

export interface EnrichedConceptNode extends IConceptNode {
  masteryScore: number | null;
  masteryStatus: 'weak' | 'learning' | 'mastered' | 'untracked';
}

export interface GraphExpansionResult {
  matchedConcepts: string[];
  relatedConcepts: string[];
  expandedQuery: string;
}

/**
 * Lightweight GraphRAG Knowledge Graph Service.
 *
 * 1. Extracts structured concept nodes & prerequisite/relational edges across active sources.
 * 2. Overlays each user's live Mastery Score onto graph nodes for interactive Mind Maps.
 * 3. Performs 1-hop GraphRAG query expansion inside RagOrchestratorService so multi-hop
 *    questions automatically pull prerequisite definitions and related applications.
 */
@Injectable()
export class ConceptGraphService {
  private readonly logger = new Logger(ConceptGraphService.name);

  constructor(
    @InjectModel('concept_graphs')
    private readonly graphModel: Model<ConceptGraphDocument>,
    private readonly llm: LlmService,
    private readonly sourcesService: SourcesService,
    private readonly masteryService: MasteryService,
  ) {}

  async getGraph(courseId: string, userId: string) {
    const graph = await this.graphModel
      .findOne({ course: new Types.ObjectId(courseId) })
      .lean();

    if (!graph) {
      return {
        courseId,
        exists: false,
        nodes: [] as EnrichedConceptNode[],
        edges: [] as IConceptEdge[],
      };
    }

    const enrichedNodes = await this.overlayMastery(graph.nodes || [], userId, courseId);
    return {
      courseId,
      exists: true,
      sourceSignature: graph.sourceSignature,
      nodes: enrichedNodes,
      edges: graph.edges || [],
      updatedAt: (graph as any).updatedAt,
    };
  }

  async generateGraph(
    courseId: string,
    userId: string,
    options: { force?: boolean; sourceIds?: string[] } = {},
  ) {
    const loaded = await this.sourcesService.getEnabledSourcesContent(
      courseId,
      options.sourceIds,
      60_000,
    );

    if (loaded.sources.length === 0 || !loaded.combinedMarkdown.trim()) {
      return {
        courseId,
        exists: false,
        nodes: [],
        edges: [],
        message: 'No active sources available to build concept map',
      };
    }

    const signature = crypto
      .createHash('sha256')
      .update(loaded.sources.map((s) => s.blobId).sort().join('|'))
      .digest('hex');

    if (!options.force) {
      const cached = await this.graphModel
        .findOne({ course: new Types.ObjectId(courseId), sourceSignature: signature })
        .lean();
      if (cached && cached.nodes?.length > 0) {
        const enrichedNodes = await this.overlayMastery(cached.nodes, userId, courseId);
        return {
          courseId,
          exists: true,
          cached: true,
          sourceSignature: signature,
          nodes: enrichedNodes,
          edges: cached.edges || [],
        };
      }
    }

    let extracted = await this.extractGraphWithLlm(loaded.combinedMarkdown, loaded.sources);
    if (!extracted || extracted.nodes.length === 0) {
      extracted = this.buildFallbackGraphFromToc(loaded.sources);
    }

    const saved = await this.graphModel
      .findOneAndUpdate(
        { course: new Types.ObjectId(courseId) },
        {
          $set: {
            course: new Types.ObjectId(courseId),
            sourceSignature: signature,
            nodes: extracted.nodes,
            edges: extracted.edges,
          },
        },
        { upsert: true, new: true },
      )
      .lean();

    const enrichedNodes = await this.overlayMastery(saved?.nodes || [], userId, courseId);
    return {
      courseId,
      exists: true,
      cached: false,
      sourceSignature: signature,
      nodes: enrichedNodes,
      edges: saved?.edges || [],
    };
  }

  /**
   * 1-Hop GraphRAG Query Expansion:
   * Finds concepts mentioned in `query` inside the course's ConceptGraph and gathers
   * directly connected prerequisite / extension nodes to boost cross-document recall.
   */
  async expandQueryWithGraph(courseId: string, query: string): Promise<GraphExpansionResult> {
    const empty: GraphExpansionResult = {
      matchedConcepts: [],
      relatedConcepts: [],
      expandedQuery: query,
    };
    if (!Types.ObjectId.isValid(courseId) || !query?.trim()) return empty;

    const graph = await this.graphModel
      .findOne({ course: new Types.ObjectId(courseId) })
      .select('nodes edges')
      .lean();

    if (!graph || !graph.nodes?.length) return empty;

    const qLower = query.toLowerCase();
    const matchedIds = new Set<string>();
    const matchedLabels: string[] = [];
    const nodeById = new Map<string, IConceptNode>();

    for (const node of graph.nodes) {
      nodeById.set(node.id, node);
      const labelLower = (node.label || '').toLowerCase();
      if (labelLower.length >= 3 && qLower.includes(labelLower)) {
        matchedIds.add(node.id);
        matchedLabels.push(node.label);
      }
    }

    if (matchedIds.size === 0) return empty;

    const relatedLabels: string[] = [];
    const seenRelated = new Set<string>();

    for (const edge of graph.edges || []) {
      let neighborId: string | null = null;
      if (matchedIds.has(edge.from) && !matchedIds.has(edge.to)) {
        neighborId = edge.to;
      } else if (matchedIds.has(edge.to) && !matchedIds.has(edge.from)) {
        neighborId = edge.from;
      }
      if (neighborId) {
        const neighbor = nodeById.get(neighborId);
        if (neighbor && !seenRelated.has(neighbor.label)) {
          seenRelated.add(neighbor.label);
          relatedLabels.push(neighbor.label);
        }
      }
      if (relatedLabels.length >= 4) break;
    }

    if (relatedLabels.length === 0) {
      return { matchedConcepts: matchedLabels, relatedConcepts: [], expandedQuery: query };
    }

    return {
      matchedConcepts: matchedLabels,
      relatedConcepts: relatedLabels,
      expandedQuery: `${query} (related concepts: ${relatedLabels.join(', ')})`,
    };
  }

  /** Pure-function JSON extractor exposed for unit tests */
  parseGraphJson(raw: string): { nodes: IConceptNode[]; edges: IConceptEdge[] } | null {
    if (!raw) return null;
    const cleaned = raw.replace(/```(?:json)?\n?/gi, '').replace(/```/g, '').trim();
    const startIdx = cleaned.indexOf('{');
    if (startIdx === -1) return null;

    let depth = 0;
    let jsonStr = '';
    for (let i = startIdx; i < cleaned.length; i++) {
      if (cleaned[i] === '{') depth++;
      else if (cleaned[i] === '}') depth--;
      if (depth === 0) {
        jsonStr = cleaned.slice(startIdx, i + 1);
        break;
      }
    }
    if (!jsonStr) return null;

    try {
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) return null;

      const validCategories = new Set(['core', 'formula', 'definition', 'application', 'person']);
      const validRelations = new Set([
        'prerequisite_of',
        'part_of',
        'extends',
        'contrasts_with',
        'applies_to',
      ]);

      const nodes: IConceptNode[] = [];
      const validIds = new Set<string>();

      for (const n of parsed.nodes.slice(0, 20)) {
        const label = String(n.label || '').trim();
        if (!label) continue;
        const id =
          String(n.id || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '_') || this.masteryService.slugifyConcept(label);
        if (!id || validIds.has(id)) continue;
        validIds.add(id);
        nodes.push({
          id,
          label,
          category: validCategories.has(n.category) ? n.category : 'core',
          summary: String(n.summary || '').trim().slice(0, 260),
          importance: Math.min(5, Math.max(1, Number(n.importance) || 3)),
          sourceTitle: String(n.sourceTitle || '').trim(),
          pageHint: Math.max(1, Number(n.pageHint) || 1),
        });
      }

      const edges: IConceptEdge[] = [];
      for (const e of Array.isArray(parsed.edges) ? parsed.edges.slice(0, 35) : []) {
        const from = String(e.from || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        const to = String(e.to || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        if (!from || !to || from === to || !validIds.has(from) || !validIds.has(to)) continue;
        edges.push({
          from,
          to,
          relation: validRelations.has(e.relation) ? e.relation : 'extends',
          label: String(e.label || e.relation || 'relates to').trim().slice(0, 40),
        });
      }

      return { nodes, edges };
    } catch {
      return null;
    }
  }

  private async extractGraphWithLlm(
    combinedMarkdown: string,
    sources: Array<{ title: string; toc: any[] }>,
  ): Promise<{ nodes: IConceptNode[]; edges: IConceptEdge[] } | null> {
    try {
      const capped = combinedMarkdown.slice(0, 32_000);
      const sourceNames = sources.map((s) => s.title).join(', ');
      const prompt = `Extract a Concept Knowledge Graph (for an interactive Mind Map & prerequisite navigator) from the study materials below.

Sources: ${sourceNames}

Rules:
- Extract 10 to 16 key concepts (nodes) covering core topics, key formulas, definitions, and applications.
- Extract 10 to 24 directional relationships (edges) showing prerequisite_of, part_of, extends, contrasts_with, or applies_to.
- Return ONLY valid JSON with no markdown code fences:
{
  "nodes": [
    {
      "id": "chain_rule",
      "label": "Chain Rule",
      "category": "formula",
      "summary": "Computes derivative of composite functions f(g(x)).",
      "importance": 5,
      "sourceTitle": "calc101.pdf",
      "pageHint": 1
    }
  ],
  "edges": [
    { "from": "derivatives", "to": "chain_rule", "relation": "prerequisite_of", "label": "prerequisite for" }
  ]
}

Study Material:
${capped}`;

      const completion = await this.llm.complete(
        [
          {
            role: 'system',
            content:
              'You are a knowledge-graph architect for an academic learning platform. Output ONLY valid JSON.',
          },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.25, maxTokens: 2500 },
      );

      return this.parseGraphJson(completion.content);
    } catch (err: any) {
      this.logger.warn(`LLM concept graph extraction fallback (${err.message})`);
      return null;
    }
  }

  /** Deterministic TOC-based fallback graph when LLM is unavailable */
  private buildFallbackGraphFromToc(
    sources: Array<{ title: string; toc: any[] }>,
  ): { nodes: IConceptNode[]; edges: IConceptEdge[] } {
    const nodes: IConceptNode[] = [];
    const edges: IConceptEdge[] = [];
    const rootId = 'course_root';
    nodes.push({
      id: rootId,
      label: sources[0]?.title || 'Course Overview',
      category: 'core',
      summary: `Covers ${sources.length} source(s) in this notebook.`,
      importance: 5,
      sourceTitle: sources[0]?.title || '',
      pageHint: 1,
    });

    let prevId = rootId;
    for (const src of sources) {
      for (const entry of (src.toc || []).slice(0, 8)) {
        const id = `n_${nodes.length}_${this.masteryService.slugifyConcept(entry.title).slice(0, 20)}`;
        nodes.push({
          id,
          label: entry.title,
          category: entry.level <= 1 ? 'core' : 'definition',
          summary: `Section from ${src.title} (p.${entry.page || 1}).`,
          importance: entry.level <= 1 ? 4 : 3,
          sourceTitle: src.title,
          pageHint: entry.page || 1,
        });
        edges.push({
          from: entry.level <= 1 ? rootId : prevId,
          to: id,
          relation: 'part_of',
          label: 'includes',
        });
        if (entry.level <= 1) prevId = id;
        if (nodes.length >= 16) break;
      }
    }

    return { nodes, edges };
  }

  private async overlayMastery(
    nodes: IConceptNode[],
    userId: string,
    courseId: string,
  ): Promise<EnrichedConceptNode[]> {
    const profile = await this.masteryService.getLearnerProfile(userId, courseId);
    const byKey = new Map(profile.allConcepts.map((c) => [c.conceptKey, c]));

    return nodes.map((n) => {
      const slug = this.masteryService.slugifyConcept(n.label);
      let match = byKey.get(slug);
      if (!match) {
        // Fuzzy substring match against tracked learner concepts
        for (const c of profile.allConcepts) {
          if (slug.includes(c.conceptKey) || c.conceptKey.includes(slug)) {
            match = c;
            break;
          }
        }
      }
      return {
        ...n,
        masteryScore: match ? match.masteryScore : null,
        masteryStatus: match ? match.status : 'untracked',
      };
    });
  }
}
