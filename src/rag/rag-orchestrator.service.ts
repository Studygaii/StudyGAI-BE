import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CourseSourceDocument } from '../schemas/course-source.schema';
import { ParentChunkDocument } from '../schemas/parent-chunk.schema';
import { CourseDocument } from '../schemas/course.schema';
import { QdrantService } from '../qdrant/qdrant.service';
import { LlmMessage, LlmService } from '../common/llm.service';
import { SourceAccessService } from './source-access.service';
import { SourcesService } from './sources.service';
import { MasteryService } from './mastery.service';
import { ConceptGraphService } from './concept-graph.service';
import { VectorTieringService } from './vector-tiering.service';
import { SparseEncoderService } from './sparse-encoder.service';
import { MetricsService } from '../ops/metrics.service';

export type RagMode = 'default' | 'tutor' | 'summary' | 'strict';

export interface CitationItem {
  index: number;
  sourceId: string;
  blobId: string;
  sourceTitle: string;
  sectionPath: string;
  pageNumber: number;
  parentIndex: number;
  quote: string;
  score: number;
  citedInAnswer: boolean;
}

export interface RetrievalMetadata {
  strategy: 'hybrid_rag' | 'long_context' | 'legacy_fallback' | 'no_sources';
  rewrittenQuery: string;
  sourcesSearched: number;
  chunksRetrieved: number;
  citedCount: number;
  graphExpandedConcepts?: string[];
  adaptiveMastery?: { overallMastery: number; weakConceptsCount: number } | null;
  provider: string;
  model: string;
  latencyMs: number;
}

export interface RagAnswerResult {
  content: string;
  citations: CitationItem[];
  retrievalMeta: RetrievalMetadata;
  /** OpenAI/Groq-compatible shape preserved for backward compatibility with studygai-app */
  choices: Array<{ message: { role: 'assistant'; content: string } }>;
  message: string;
}

const GLOBAL_SYNTHESIS_RE =
  /\b(summarize|summary|overview|outline|study\s*guide|compare|contrast|key\s*takeaways|all\s*sources|entire\s*(course|document|book|chapter)|table\s*of\s*contents|main\s*themes|briefing)\b/i;

const PRONOUN_FOLLOWUP_RE =
  /\b(it|this|that|they|them|those|these|above|previous|earlier|second|third|latter|former|same|more\s*about|elaborate|explain\s*again)\b/i;

/**
 * Unified NotebookLM+ RAG Query Orchestrator.
 *
 * Powers 1-on-1 Chat, Streaming SSE Chat, WebSocket Chat, and `@studygai` Group Chats:
 * 1. Multi-tenant ACL verification (`SourceAccessService`)
 * 2. Conversational Query Rewriting (resolves follow-up pronouns)
 * 3. Smart Context Router:
 *    - Long-Context Mode (when active sources fit context budget & user asks for synthesis/comparison)
 *    - Hybrid RAG Mode (Qdrant Dense + Sparse RRF -> Cross-Encoder Rerank -> Parent Chunk Expansion)
 * 4. Strict Grounded Prompting with `[1]`, `[2]` Inline Citations + Socratic Tutor Mode
 * 5. Post-generation Citation Extraction & Verification
 */
@Injectable()
export class RagOrchestratorService {
  private readonly logger = new Logger(RagOrchestratorService.name);

  constructor(
    private readonly qdrant: QdrantService,
    private readonly llm: LlmService,
    private readonly sourceAccess: SourceAccessService,
    private readonly sourcesService: SourcesService,
    private readonly masteryService: MasteryService,
    private readonly conceptGraphService: ConceptGraphService,
    private readonly vectorTiering: VectorTieringService,
    private readonly sparseEncoder: SparseEncoderService,
    private readonly metrics: MetricsService,
    @InjectModel('course_sources') private readonly courseSourceModel: Model<CourseSourceDocument>,
    @InjectModel('parent_chunks') private readonly parentChunkModel: Model<ParentChunkDocument>,
    @InjectModel('courses') private readonly courseModel: Model<CourseDocument>,
  ) {}

  async answer(params: {
    messages: Array<{ role: string; content: string }>;
    courseId?: string;
    userId?: string;
    sourceIds?: string[];
    mode?: RagMode;
  }): Promise<RagAnswerResult> {
    const startMs = Date.now();
    const prepared = await this.prepareGroundedPrompt(params);

    const completion = await this.llm.complete(prepared.llmMessages, {
      temperature: params.mode === 'strict' ? 0.15 : 0.35,
      maxTokens: 2048,
      preferLongContext: prepared.strategy === 'long_context',
    });

    const verifiedCitations = this.markCitedReferences(completion.content, prepared.citations);
    const citedCount = verifiedCitations.filter((c) => c.citedInAnswer).length;

    const latencyMs = Date.now() - startMs;
    const retrievalMeta: RetrievalMetadata = {
      strategy: prepared.strategy,
      rewrittenQuery: prepared.rewrittenQuery,
      sourcesSearched: prepared.sourcesSearched,
      chunksRetrieved: prepared.citations.length,
      citedCount,
      graphExpandedConcepts: prepared.graphExpandedConcepts,
      adaptiveMastery: prepared.adaptiveMastery,
      provider: completion.provider,
      model: completion.model,
      latencyMs,
    };

    this.metrics.incCounter('studygai_rag_queries_total', {
      strategy: prepared.strategy,
      mode: params.mode || 'default',
      provider: completion.provider,
    });
    this.metrics.observeHistogram('studygai_rag_latency_ms', latencyMs, {
      strategy: prepared.strategy,
    });
    if (citedCount > 0) {
      this.metrics.incCounter('studygai_rag_citations_total', { verified: 'true' }, citedCount);
    }

    return {
      content: completion.content,
      citations: verifiedCitations,
      retrievalMeta,
      choices: [{ message: { role: 'assistant', content: completion.content } }],
      message: completion.content,
    };
  }

  /**
   * Prepare grounded prompt + citations upfront so SSE / WebSocket callers can immediately
   * send citation metadata and stream tokens as they arrive.
   */
  async answerStream(params: {
    messages: Array<{ role: string; content: string }>;
    courseId?: string;
    userId?: string;
    sourceIds?: string[];
    mode?: RagMode;
  }): Promise<{
    stream: AsyncGenerator<string>;
    citations: CitationItem[];
    strategy: RetrievalMetadata['strategy'];
    rewrittenQuery: string;
    sourcesSearched: number;
    graphExpandedConcepts: string[];
    adaptiveMastery: { overallMastery: number; weakConceptsCount: number } | null;
  }> {
    const prepared = await this.prepareGroundedPrompt(params);
    const stream = this.llm.stream(prepared.llmMessages, {
      temperature: params.mode === 'strict' ? 0.15 : 0.35,
      maxTokens: 2048,
      preferLongContext: prepared.strategy === 'long_context',
    });

    return {
      stream,
      citations: prepared.citations,
      strategy: prepared.strategy,
      rewrittenQuery: prepared.rewrittenQuery,
      sourcesSearched: prepared.sourcesSearched,
      graphExpandedConcepts: prepared.graphExpandedConcepts,
      adaptiveMastery: prepared.adaptiveMastery,
    };
  }

  /**
   * Extract `[1]`, `[2]` inline citation markers actually referenced by the LLM answer
   * so the UI only highlights verified citations used in the response.
   */
  markCitedReferences(answerText: string, candidates: CitationItem[]): CitationItem[] {
    const citedSet = new Set<number>();
    const re = /\[(\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(answerText || '')) !== null) {
      citedSet.add(parseInt(m[1], 10));
    }
    return candidates.map((c) => ({
      ...c,
      citedInAnswer: citedSet.has(c.index),
    }));
  }

  private async prepareGroundedPrompt(params: {
    messages: Array<{ role: string; content: string }>;
    courseId?: string;
    userId?: string;
    sourceIds?: string[];
    mode?: RagMode;
  }): Promise<{
    llmMessages: LlmMessage[];
    citations: CitationItem[];
    strategy: RetrievalMetadata['strategy'];
    rewrittenQuery: string;
    sourcesSearched: number;
    graphExpandedConcepts: string[];
    adaptiveMastery: { overallMastery: number; weakConceptsCount: number } | null;
  }> {
    const mode: RagMode = params.mode || 'default';
    const sanitizedHistory: LlmMessage[] = (params.messages || [])
      .filter((m) => m && typeof m.content === 'string' && m.content.trim().length > 0)
      .slice(-12)
      .map((m) => ({
        role: m.role === 'assistant' || m.role === 'system' ? m.role : 'user',
        content: m.content.replace(/@studygai\s*/gi, '').trim() || m.content.trim(),
      }));

    const latestUserMsg = [...sanitizedHistory].reverse().find((m) => m.role === 'user');
    const rawQuery = latestUserMsg?.content || '';

    // If no courseId, run general tutor chat
    if (!params.courseId) {
      return {
        llmMessages: [
          { role: 'system', content: this.buildModePersona(mode) },
          ...sanitizedHistory,
        ],
        citations: [],
        strategy: 'no_sources',
        rewrittenQuery: rawQuery,
        sourcesSearched: 0,
        graphExpandedConcepts: [],
        adaptiveMastery: null,
      };
    }

    // 1. Multi-Tenant ACL verification (when userId is present)
    if (params.userId) {
      await this.sourceAccess.assertCourseAccess(params.courseId, params.userId);
    }

    // 1b. Load Learner Mastery Profile for Adaptive RAG (non-blocking, cached in Redis)
    let adaptiveDirective = '';
    let adaptiveMastery: { overallMastery: number; weakConceptsCount: number } | null = null;
    if (params.userId && mode !== 'strict') {
      try {
        const profile = await this.masteryService.getLearnerProfile(params.userId, params.courseId);
        if (profile.totalSignals > 0) {
          adaptiveDirective = this.masteryService.buildAdaptiveDirective(profile);
          adaptiveMastery = {
            overallMastery: profile.overallMastery,
            weakConceptsCount: profile.weakConcepts.length,
          };
        }
      } catch (err: any) {
        this.logger.debug(`Mastery lookup skipped (${err.message})`);
      }
    }

    // 2. Load enabled multi-source links for this course
    const sourceFilter: any = {
      course: new Types.ObjectId(params.courseId),
      status: 'ready',
    };
    if (params.sourceIds && params.sourceIds.length > 0) {
      const validIds = params.sourceIds
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));
      sourceFilter._id = { $in: validIds };
    } else {
      sourceFilter.enabled = true;
    }

    const activeLinks = await this.courseSourceModel
      .find(sourceFilter)
      .populate('blob', 'tokenEstimate pageCount toc summary markdownKey')
      .lean();

    // Legacy backward compatibility: if course has no v2 sources yet, fall back to legacy `course.pdfContent`
    if (activeLinks.length === 0) {
      const legacyCourse = await this.courseModel
        .findById(params.courseId)
        .select('title pdfMarkdown pdfContent pdfFileName')
        .lean();
      const legacyText = (legacyCourse?.pdfMarkdown || legacyCourse?.pdfContent || '').trim();
      if (!legacyText) {
        return {
          llmMessages: [
            { role: 'system', content: this.buildModePersona(mode) + adaptiveDirective },
            ...sanitizedHistory,
          ],
          citations: [],
          strategy: 'no_sources',
          rewrittenQuery: rawQuery,
          sourcesSearched: 0,
          graphExpandedConcepts: [],
          adaptiveMastery,
        };
      }

      const capped = legacyText.slice(0, 32_000);
      const citations: CitationItem[] = [
        {
          index: 1,
          sourceId: params.courseId,
          blobId: params.courseId,
          sourceTitle: legacyCourse?.pdfFileName || legacyCourse?.title || 'Course Document',
          sectionPath: 'Document',
          pageNumber: 1,
          parentIndex: 0,
          quote: capped.slice(0, 280),
          score: 1,
          citedInAnswer: false,
        },
      ];
      const sysPrompt = this.buildGroundedSystemPrompt(
        mode,
        `[1] Source: ${citations[0].sourceTitle}\n${capped}`,
        adaptiveDirective,
      );
      return {
        llmMessages: [{ role: 'system', content: sysPrompt }, ...sanitizedHistory],
        citations,
        strategy: 'legacy_fallback',
        rewrittenQuery: rawQuery,
        sourcesSearched: 1,
        graphExpandedConcepts: [],
        adaptiveMastery,
      };
    }

    // 3. Conversational Query Rewriting (only when multi-turn + likely coreference, to minimize latency)
    const rewrittenQuery = await this.rewriteQueryIfNeeded(sanitizedHistory, rawQuery);

    // 3b. Lightweight GraphRAG 1-Hop Prerequisite / Concept Expansion
    const graphExp = await this.conceptGraphService
      .expandQueryWithGraph(params.courseId, rewrittenQuery)
      .catch(() => ({ matchedConcepts: [], relatedConcepts: [], expandedQuery: rewrittenQuery }));
    const searchQuery = graphExp.expandedQuery || rewrittenQuery;
    const graphExpandedConcepts = graphExp.relatedConcepts || [];

    // 4. Smart Router: Long-Context Synthesis vs Hybrid Vector RAG
    const totalActiveTokens = activeLinks.reduce(
      (sum, l: any) => sum + Number(l.blob?.tokenEstimate || 0),
      0,
    );
    const longContextBudget = this.llm.getLongContextBudgetTokens();
    const wantsSynthesis = mode === 'summary' || GLOBAL_SYNTHESIS_RE.test(rewrittenQuery);

    if (wantsSynthesis && totalActiveTokens > 0 && totalActiveTokens <= longContextBudget) {
      const loaded = await this.sourcesService.getEnabledSourcesContent(
        params.courseId,
        params.sourceIds,
        longContextBudget * 4,
      );

      const citations: CitationItem[] = loaded.sources.map((s, idx) => ({
        index: idx + 1,
        sourceId: s.sourceId,
        blobId: s.blobId,
        sourceTitle: s.title,
        sectionPath: 'Full Source',
        pageNumber: 1,
        parentIndex: 0,
        quote: s.markdown.replace(/<!--\s*PAGE\s+\d+\s*-->/gi, '').trim().slice(0, 280),
        score: 1,
        citedInAnswer: false,
      }));

      const contextBlocks = loaded.sources
        .map((s, idx) => {
          const tocSummary =
            s.toc?.length > 0
              ? `Table of Contents: ${s.toc
                  .slice(0, 15)
                  .map((t: any) => `${t.title} (p.${t.page})`)
                  .join(' | ')}\n`
              : '';
          return `[${idx + 1}] Source: ${s.title} (${s.sourceType}, ${s.pageCount} pages)\n${tocSummary}${s.markdown}`;
        })
        .join('\n\n---\n\n');

      return {
        llmMessages: [
          {
            role: 'system',
            content: this.buildGroundedSystemPrompt(mode, contextBlocks, adaptiveDirective),
          },
          ...sanitizedHistory,
        ],
        citations,
        strategy: 'long_context',
        rewrittenQuery,
        sourcesSearched: activeLinks.length,
        graphExpandedConcepts,
        adaptiveMastery,
      };
    }

    // 5. Hybrid RAG Mode: Qdrant Dense + Sparse RRF -> Cross-Encoder Rerank -> Parent Expansion
    const blobToSource = new Map<string, { sourceId: string; title: string }>();
    const blobIds: string[] = [];
    for (const link of activeLinks as any[]) {
      const bId = (link.blob?._id || link.blob)?.toString();
      if (!bId) continue;
      blobIds.push(bId);
      blobToSource.set(bId, { sourceId: link._id.toString(), title: link.title });
    }

    // Transparently re-hydrate any cold S3-archived blobs before querying Qdrant
    await this.vectorTiering
      .ensureBlobsHot(blobIds)
      .catch((err) => this.logger.warn(`Cold blob re-hydration warning: ${err.message}`));

    let retrieved = await this.qdrant
      .hybridSearch({
        query: searchQuery,
        blobIds,
        prefetchLimit: 40,
        limit: 24,
        rerankTopK: 10,
      })
      .catch((err) => {
        this.logger.warn(`Hybrid Qdrant search failed (${err.message}); falling back to DB ParentChunks`);
        return [];
      });

    // Resilient lexically-ranked fallback if Qdrant returned 0 hits (e.g., Qdrant container offline in dev)
    if (retrieved.length === 0) {
      const fallbackParents = await this.parentChunkModel
        .find({ blob: { $in: blobIds.map((id) => new Types.ObjectId(id)) } })
        .sort({ parentIndex: 1 })
        .limit(80)
        .lean();

      const rankedFallback = fallbackParents
        .map((p: any) => {
          const bId = p.blob.toString();
          const meta = blobToSource.get(bId);
          const lexScore = this.sparseEncoder.lexicalOverlapScore(searchQuery, p.text || '');
          return {
            score: Number((0.25 + 0.75 * lexScore).toFixed(4)),
            rerankScore: Number((0.25 + 0.75 * lexScore).toFixed(4)),
            blobId: bId,
            sourceName: meta?.title || 'Source',
            sourceType: 'document',
            text: p.text,
            chunkIndex: p.parentIndex,
            parentIndex: p.parentIndex,
            pageNumber: p.pageStart || 1,
            sectionPath: p.sectionPath || 'Document',
            metadata: {},
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);

      retrieved = rankedFallback;
    }

    // 6. Small-to-Big Parent Expansion (deduplicate overlapping child hits from same parent)
    const uniqueParentKeys: Array<{ blob: Types.ObjectId; parentIndex: number }> = [];
    const seenParents = new Set<string>();
    const orderedHits: typeof retrieved = [];

    for (const hit of retrieved) {
      const key = `${hit.blobId}:${hit.parentIndex}`;
      if (seenParents.has(key)) continue;
      seenParents.add(key);
      orderedHits.push(hit);
      if (Types.ObjectId.isValid(hit.blobId)) {
        uniqueParentKeys.push({
          blob: new Types.ObjectId(hit.blobId),
          parentIndex: hit.parentIndex,
        });
      }
      if (orderedHits.length >= 8) break;
    }

    const parentMap = new Map<string, any>();
    if (uniqueParentKeys.length > 0) {
      const parentDocs = await this.parentChunkModel
        .find({ $or: uniqueParentKeys })
        .lean();
      for (const pd of parentDocs as any[]) {
        parentMap.set(`${pd.blob.toString()}:${pd.parentIndex}`, pd);
      }
    }

    // 7. Pack expanded parent passages cleanly into LLM token budget (~10,000 tokens / ~40K chars)
    const maxContextChars = 40_000;
    let usedChars = 0;
    const citations: CitationItem[] = [];
    const evidenceBlocks: string[] = [];

    for (const hit of orderedHits) {
      const parentDoc = parentMap.get(`${hit.blobId}:${hit.parentIndex}`);
      const expandedText = (parentDoc?.text || hit.text || '').trim();
      if (!expandedText) continue;

      if (usedChars + expandedText.length > maxContextChars && evidenceBlocks.length > 0) {
        break;
      }

      const citationIndex = citations.length + 1;
      const sourceMeta = blobToSource.get(hit.blobId);
      const sourceTitle = sourceMeta?.title || hit.sourceName || 'Course Source';
      const sectionPath = parentDoc?.sectionPath || hit.sectionPath || 'Document';
      const pageNumber = hit.pageNumber || parentDoc?.pageStart || 1;

      citations.push({
        index: citationIndex,
        sourceId: sourceMeta?.sourceId || hit.blobId,
        blobId: hit.blobId,
        sourceTitle,
        sectionPath,
        pageNumber,
        parentIndex: hit.parentIndex,
        quote: hit.text.replace(/\s+/g, ' ').trim().slice(0, 300),
        score: Number((hit.rerankScore ?? hit.score ?? 0).toFixed(4)),
        citedInAnswer: false,
      });

      evidenceBlocks.push(
        `[${citationIndex}] Source: "${sourceTitle}" | Section: ${sectionPath} | Page ${pageNumber}\n${expandedText}`,
      );
      usedChars += expandedText.length;
    }

    const sysPrompt = this.buildGroundedSystemPrompt(
      mode,
      evidenceBlocks.join('\n\n---\n\n'),
      adaptiveDirective,
    );
    return {
      llmMessages: [{ role: 'system', content: sysPrompt }, ...sanitizedHistory],
      citations,
      strategy: 'hybrid_rag',
      rewrittenQuery,
      sourcesSearched: activeLinks.length,
      graphExpandedConcepts,
      adaptiveMastery,
    };
  }

  private async rewriteQueryIfNeeded(history: LlmMessage[], rawQuery: string): Promise<string> {
    if (!rawQuery) return '';
    // Skip extra LLM round-trip on single-turn or self-contained queries (saves ~250ms p50!)
    if (history.length <= 1 || (!PRONOUN_FOLLOWUP_RE.test(rawQuery) && rawQuery.length > 35)) {
      return rawQuery;
    }

    try {
      const recentContext = history
        .slice(-5, -1)
        .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 300)}`)
        .join('\n');

      const res = await this.llm.complete(
        [
          {
            role: 'system',
            content:
              'Rewrite the user follow-up question into a concise, standalone search query using the conversation history. Output ONLY the rewritten query text—no quotes, no explanation.',
          },
          {
            role: 'user',
            content: `Conversation history:\n${recentContext}\n\nFollow-up question: ${rawQuery}`,
          },
        ],
        { temperature: 0.0, maxTokens: 120 },
      );

      const rewritten = (res.content || '').replace(/^["']|["']$/g, '').trim();
      return rewritten.length >= 3 && rewritten.length <= 400 ? rewritten : rawQuery;
    } catch (err: any) {
      this.logger.debug(`Query rewrite skipped (${err.message})`);
      return rawQuery;
    }
  }

  private buildModePersona(mode: RagMode): string {
    if (mode === 'tutor') {
      return `You are StudyGAI in Socratic Tutor mode. Guide the student step-by-step with clear intuition, probing questions, and hints rather than dumping the final solution immediately.`;
    }
    if (mode === 'summary') {
      return `You are StudyGAI, an expert academic synthesizer. Organize complex course sources into structured outlines, key concepts, formulas, and comparisons.`;
    }
    return `You are StudyGAI, an accurate, encouraging AI study assistant and research notebook companion.`;
  }

  private buildGroundedSystemPrompt(
    mode: RagMode,
    numberedEvidence: string,
    adaptiveDirective = '',
  ): string {
    const persona = this.buildModePersona(mode);
    const tutorExtra =
      mode === 'tutor'
        ? `- End with 1 short conceptual check-in question to verify the student's understanding.\n`
        : '';
    const strictRule =
      mode === 'strict'
        ? `- STRICT MODE: Never extrapolate beyond the provided excerpts. If a detail is absent, explicitly state: "This is not covered in your active course sources."\n`
        : `- Ground every factual claim in the excerpts below. If information is missing from the sources, clearly state what is not covered rather than inventing details.\n`;

    return `${persona}${adaptiveDirective ? `\n${adaptiveDirective}` : ''}

GROUNDING & CITATION RULES:
${strictRule}- Cite your sources inline immediately after every factual claim using bracketed numbers like [1], [2], or [1][3] matching the source blocks below.
- Preserve mathematical notation cleanly in LaTeX ($...$ or $$...$$) when explaining STEM topics.
- Be clear, structured, and directly useful for studying.
${tutorExtra}
VERIFIED COURSE SOURCE EXCERPTS:
${numberedEvidence}`;
  }
}
