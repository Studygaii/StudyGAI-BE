"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var RagOrchestratorService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RagOrchestratorService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const qdrant_service_1 = require("../qdrant/qdrant.service");
const llm_service_1 = require("../common/llm.service");
const source_access_service_1 = require("./source-access.service");
const sources_service_1 = require("./sources.service");
const mastery_service_1 = require("./mastery.service");
const concept_graph_service_1 = require("./concept-graph.service");
const vector_tiering_service_1 = require("./vector-tiering.service");
const sparse_encoder_service_1 = require("./sparse-encoder.service");
const metrics_service_1 = require("../ops/metrics.service");
const GLOBAL_SYNTHESIS_RE = /\b(summarize|summary|overview|outline|study\s*guide|compare|contrast|key\s*takeaways|all\s*sources|entire\s*(course|document|book|chapter)|table\s*of\s*contents|main\s*themes|briefing)\b/i;
const PRONOUN_FOLLOWUP_RE = /\b(it|this|that|they|them|those|these|above|previous|earlier|second|third|latter|former|same|more\s*about|elaborate|explain\s*again)\b/i;
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
let RagOrchestratorService = RagOrchestratorService_1 = class RagOrchestratorService {
    constructor(qdrant, llm, sourceAccess, sourcesService, masteryService, conceptGraphService, vectorTiering, sparseEncoder, metrics, courseSourceModel, parentChunkModel, courseModel) {
        this.qdrant = qdrant;
        this.llm = llm;
        this.sourceAccess = sourceAccess;
        this.sourcesService = sourcesService;
        this.masteryService = masteryService;
        this.conceptGraphService = conceptGraphService;
        this.vectorTiering = vectorTiering;
        this.sparseEncoder = sparseEncoder;
        this.metrics = metrics;
        this.courseSourceModel = courseSourceModel;
        this.parentChunkModel = parentChunkModel;
        this.courseModel = courseModel;
        this.logger = new common_1.Logger(RagOrchestratorService_1.name);
    }
    async answer(params) {
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
        const retrievalMeta = {
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
    async answerStream(params) {
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
    markCitedReferences(answerText, candidates) {
        const citedSet = new Set();
        const re = /\[(\d+)\]/g;
        let m;
        while ((m = re.exec(answerText || '')) !== null) {
            citedSet.add(parseInt(m[1], 10));
        }
        return candidates.map((c) => ({
            ...c,
            citedInAnswer: citedSet.has(c.index),
        }));
    }
    async prepareGroundedPrompt(params) {
        const mode = params.mode || 'default';
        const sanitizedHistory = (params.messages || [])
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
        let adaptiveMastery = null;
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
            }
            catch (err) {
                this.logger.debug(`Mastery lookup skipped (${err.message})`);
            }
        }
        // 2. Load enabled multi-source links for this course
        const sourceFilter = {
            course: new mongoose_2.Types.ObjectId(params.courseId),
            status: 'ready',
        };
        if (params.sourceIds && params.sourceIds.length > 0) {
            const validIds = params.sourceIds
                .filter((id) => mongoose_2.Types.ObjectId.isValid(id))
                .map((id) => new mongoose_2.Types.ObjectId(id));
            sourceFilter._id = { $in: validIds };
        }
        else {
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
            const capped = legacyText.slice(0, 32000);
            const citations = [
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
            const sysPrompt = this.buildGroundedSystemPrompt(mode, `[1] Source: ${citations[0].sourceTitle}\n${capped}`, adaptiveDirective);
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
        const totalActiveTokens = activeLinks.reduce((sum, l) => sum + Number(l.blob?.tokenEstimate || 0), 0);
        const longContextBudget = this.llm.getLongContextBudgetTokens();
        const wantsSynthesis = mode === 'summary' || GLOBAL_SYNTHESIS_RE.test(rewrittenQuery);
        if (wantsSynthesis && totalActiveTokens > 0 && totalActiveTokens <= longContextBudget) {
            const loaded = await this.sourcesService.getEnabledSourcesContent(params.courseId, params.sourceIds, longContextBudget * 4);
            const citations = loaded.sources.map((s, idx) => ({
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
                const tocSummary = s.toc?.length > 0
                    ? `Table of Contents: ${s.toc
                        .slice(0, 15)
                        .map((t) => `${t.title} (p.${t.page})`)
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
        const blobToSource = new Map();
        const blobIds = [];
        for (const link of activeLinks) {
            const bId = (link.blob?._id || link.blob)?.toString();
            if (!bId)
                continue;
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
                .find({ blob: { $in: blobIds.map((id) => new mongoose_2.Types.ObjectId(id)) } })
                .sort({ parentIndex: 1 })
                .limit(80)
                .lean();
            const rankedFallback = fallbackParents
                .map((p) => {
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
        const uniqueParentKeys = [];
        const seenParents = new Set();
        const orderedHits = [];
        for (const hit of retrieved) {
            const key = `${hit.blobId}:${hit.parentIndex}`;
            if (seenParents.has(key))
                continue;
            seenParents.add(key);
            orderedHits.push(hit);
            if (mongoose_2.Types.ObjectId.isValid(hit.blobId)) {
                uniqueParentKeys.push({
                    blob: new mongoose_2.Types.ObjectId(hit.blobId),
                    parentIndex: hit.parentIndex,
                });
            }
            if (orderedHits.length >= 8)
                break;
        }
        const parentMap = new Map();
        if (uniqueParentKeys.length > 0) {
            const parentDocs = await this.parentChunkModel
                .find({ $or: uniqueParentKeys })
                .lean();
            for (const pd of parentDocs) {
                parentMap.set(`${pd.blob.toString()}:${pd.parentIndex}`, pd);
            }
        }
        // 7. Pack expanded parent passages cleanly into LLM token budget (~10,000 tokens / ~40K chars)
        const maxContextChars = 40000;
        let usedChars = 0;
        const citations = [];
        const evidenceBlocks = [];
        for (const hit of orderedHits) {
            const parentDoc = parentMap.get(`${hit.blobId}:${hit.parentIndex}`);
            const expandedText = (parentDoc?.text || hit.text || '').trim();
            if (!expandedText)
                continue;
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
            evidenceBlocks.push(`[${citationIndex}] Source: "${sourceTitle}" | Section: ${sectionPath} | Page ${pageNumber}\n${expandedText}`);
            usedChars += expandedText.length;
        }
        const sysPrompt = this.buildGroundedSystemPrompt(mode, evidenceBlocks.join('\n\n---\n\n'), adaptiveDirective);
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
    async rewriteQueryIfNeeded(history, rawQuery) {
        if (!rawQuery)
            return '';
        // Skip extra LLM round-trip on single-turn or self-contained queries (saves ~250ms p50!)
        if (history.length <= 1 || (!PRONOUN_FOLLOWUP_RE.test(rawQuery) && rawQuery.length > 35)) {
            return rawQuery;
        }
        try {
            const recentContext = history
                .slice(-5, -1)
                .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 300)}`)
                .join('\n');
            const res = await this.llm.complete([
                {
                    role: 'system',
                    content: 'Rewrite the user follow-up question into a concise, standalone search query using the conversation history. Output ONLY the rewritten query text—no quotes, no explanation.',
                },
                {
                    role: 'user',
                    content: `Conversation history:\n${recentContext}\n\nFollow-up question: ${rawQuery}`,
                },
            ], { temperature: 0.0, maxTokens: 120 });
            const rewritten = (res.content || '').replace(/^["']|["']$/g, '').trim();
            return rewritten.length >= 3 && rewritten.length <= 400 ? rewritten : rawQuery;
        }
        catch (err) {
            this.logger.debug(`Query rewrite skipped (${err.message})`);
            return rawQuery;
        }
    }
    buildModePersona(mode) {
        if (mode === 'tutor') {
            return `You are StudyGAI in Socratic Tutor mode. Guide the student step-by-step with clear intuition, probing questions, and hints rather than dumping the final solution immediately.`;
        }
        if (mode === 'summary') {
            return `You are StudyGAI, an expert academic synthesizer. Organize complex course sources into structured outlines, key concepts, formulas, and comparisons.`;
        }
        return `You are StudyGAI, an accurate, encouraging AI study assistant and research notebook companion.`;
    }
    buildGroundedSystemPrompt(mode, numberedEvidence, adaptiveDirective = '') {
        const persona = this.buildModePersona(mode);
        const tutorExtra = mode === 'tutor'
            ? `- End with 1 short conceptual check-in question to verify the student's understanding.\n`
            : '';
        const strictRule = mode === 'strict'
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
};
exports.RagOrchestratorService = RagOrchestratorService;
exports.RagOrchestratorService = RagOrchestratorService = RagOrchestratorService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(9, (0, mongoose_1.InjectModel)('course_sources')),
    __param(10, (0, mongoose_1.InjectModel)('parent_chunks')),
    __param(11, (0, mongoose_1.InjectModel)('courses')),
    __metadata("design:paramtypes", [qdrant_service_1.QdrantService,
        llm_service_1.LlmService,
        source_access_service_1.SourceAccessService,
        sources_service_1.SourcesService,
        mastery_service_1.MasteryService,
        concept_graph_service_1.ConceptGraphService,
        vector_tiering_service_1.VectorTieringService,
        sparse_encoder_service_1.SparseEncoderService,
        metrics_service_1.MetricsService,
        mongoose_2.Model,
        mongoose_2.Model,
        mongoose_2.Model])
], RagOrchestratorService);
//# sourceMappingURL=rag-orchestrator.service.js.map