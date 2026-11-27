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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var IngestionProcessor_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.IngestionProcessor = exports.RAG_INGESTION_QUEUE = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const axios_1 = __importDefault(require("axios"));
const form_data_1 = __importDefault(require("form-data"));
const bullmq_1 = require("bullmq");
const storage_service_1 = require("../storage/storage.service");
const chunker_service_1 = require("./chunker.service");
const qdrant_service_1 = require("../qdrant/qdrant.service");
const cache_service_1 = require("../cache/cache.service");
const metrics_service_1 = require("../ops/metrics.service");
exports.RAG_INGESTION_QUEUE = 'rag-ingestion';
/**
 * Event-Driven Async Document Ingestion Engine (BullMQ on Redis with graceful local fallback).
 *
 * Pipeline stages:
 * 1. Parse (single-pass Python RAG worker `/ingest/*`, or Node.js fallback if worker is offline)
 * 2. Structure-Aware Parent-Child Chunking + TOC Extraction
 * 3. Persist extracted Markdown in Object Storage + ParentChunks in MongoDB
 * 4. Dual-vector (Dense + Sparse) idempotent indexing in Qdrant
 * 5. Update CourseSource + SourceBlob + Course counters & invalidate stale caches
 */
let IngestionProcessor = IngestionProcessor_1 = class IngestionProcessor {
    constructor(configService, storage, chunker, qdrant, cache, metrics, blobModel, courseSourceModel, parentChunkModel, courseModel) {
        this.configService = configService;
        this.storage = storage;
        this.chunker = chunker;
        this.qdrant = qdrant;
        this.cache = cache;
        this.metrics = metrics;
        this.blobModel = blobModel;
        this.courseSourceModel = courseSourceModel;
        this.parentChunkModel = parentChunkModel;
        this.courseModel = courseModel;
        this.logger = new common_1.Logger(IngestionProcessor_1.name);
        this.queue = null;
        this.worker = null;
        this.useQueue = false;
        this.workerUrl = (this.configService.get('RAG_WORKER_URL') ||
            this.configService.get('DOCLING_SERVICE_URL') ||
            'http://localhost:5000').replace(/\/$/, '');
    }
    /** Optional hook allowing ChatGateway to broadcast real-time ingestion progress over Socket.IO */
    registerStatusEmitter(fn) {
        this.statusEmitter = fn;
    }
    async onModuleInit() {
        const enableQueue = (this.configService.get('ENABLE_BULLMQ', 'true') || 'true').toLowerCase() !== 'false';
        const redisUrl = this.configService.get('REDIS_URL', 'redis://localhost:6379');
        if (!enableQueue) {
            this.logger.log('BullMQ disabled via ENABLE_BULLMQ=false; running in-process async worker');
            return;
        }
        try {
            const parsed = new URL(redisUrl);
            const connection = {
                host: parsed.hostname || 'localhost',
                port: Number(parsed.port || 6379),
                ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
                maxRetriesPerRequest: null,
                enableReadyCheck: false,
            };
            const concurrency = Number(this.configService.get('INGESTION_CONCURRENCY', '4'));
            this.queue = new bullmq_1.Queue(exports.RAG_INGESTION_QUEUE, {
                connection,
                defaultJobOptions: {
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 2000 },
                    removeOnComplete: 500,
                    removeOnFail: 1000,
                },
            });
            this.worker = new bullmq_1.Worker(exports.RAG_INGESTION_QUEUE, async (job) => this.processPayload(job.data), { connection, concurrency });
            this.worker.on('error', (err) => {
                this.logger.warn(`BullMQ worker error: ${err.message}`);
            });
            this.worker.on('failed', (job, err) => {
                this.logger.error(`Ingestion job ${job?.id} failed: ${err?.message}`);
            });
            this.useQueue = true;
            this.logger.log(`BullMQ ingestion queue "${exports.RAG_INGESTION_QUEUE}" active (concurrency=${concurrency})`);
        }
        catch (err) {
            this.logger.warn(`BullMQ init failed (${err.message}); using in-process async fallback`);
            this.useQueue = false;
        }
    }
    async onModuleDestroy() {
        await this.worker?.close().catch(() => undefined);
        await this.queue?.close().catch(() => undefined);
    }
    /**
     * Enqueue an ingestion job (priority=1 for small/text/URL, priority=5 for heavy files).
     * Deduplicates active/waiting jobs for identical blobs, while allowing clean retries
     * if a prior job finished or failed. Falls back to in-process execution if Redis is down.
     */
    async enqueue(payload, priority = 3) {
        if (this.useQueue && this.queue) {
            try {
                const dedupJobId = `blob-${payload.blobId}`;
                const existing = await this.queue.getJob(dedupJobId).catch(() => null);
                if (existing) {
                    const state = await existing.getState().catch(() => 'unknown');
                    if (state === 'active' || state === 'waiting' || state === 'delayed' || state === 'prioritized') {
                        return { jobId: existing.id?.toString() || dedupJobId, queued: true };
                    }
                    // Prior job completed or failed — remove stale job record so retry actually runs
                    await existing.remove().catch(() => undefined);
                }
                const job = await this.queue.add(`ingest:${payload.kind}`, payload, {
                    jobId: dedupJobId,
                    priority,
                });
                return { jobId: job.id?.toString() || payload.blobId, queued: true };
            }
            catch (err) {
                this.logger.warn(`BullMQ enqueue failed (${err.message}); falling back to in-process async run`);
            }
        }
        // Non-blocking background execution fallback
        setImmediate(() => {
            this.processPayload(payload).catch((err) => {
                this.logger.error(`In-process ingestion failed for blob ${payload.blobId}: ${err.message}`);
            });
        });
        return { jobId: `inline-${payload.blobId}`, queued: false };
    }
    /** Execute full ingestion synchronously (useful for tests or `?sync=true` legacy uploads) */
    async processPayload(payload) {
        const { blobId, courseId, courseSourceId, sourceName, sourceType } = payload;
        try {
            await this.updateStatus(blobId, courseSourceId, courseId, 'parsing');
            let markdown = '';
            let pageCount = 1;
            let extractionMethod = 'fallback';
            let embeddingModel = 'sparse-only-fallback';
            let toc = [];
            let parents = [];
            let childCount = 0;
            let tokenEstimate = 0;
            let indexedByWorker = false;
            // Stage 1: Prefer unified single-pass Python RAG worker (parses + chunks + dual embeds + upserts!)
            const workerResult = await this.tryPythonWorkerIngest(payload);
            if (workerResult) {
                markdown = workerResult.markdown || '';
                pageCount = Number(workerResult.page_count || 1);
                extractionMethod = workerResult.extraction_method || 'rag_worker';
                embeddingModel = workerResult.embedding_stats?.dense_model || 'worker-hybrid';
                toc = (workerResult.toc || []).map((t) => ({
                    level: t.level,
                    title: t.title,
                    page: t.page,
                    parentIndex: t.parent_index ?? t.parentIndex ?? 0,
                }));
                parents = (workerResult.parents || []).map((p) => ({
                    parentIndex: p.parent_index ?? p.parentIndex,
                    text: p.text,
                    sectionPath: p.section_path ?? p.sectionPath ?? 'Document',
                    pageStart: p.page_start ?? p.pageStart ?? 1,
                    pageEnd: p.page_end ?? p.pageEnd ?? 1,
                    tokenCount: p.token_count ?? p.tokenCount ?? 0,
                    hasFormula: Boolean(p.has_formula ?? p.hasFormula),
                    hasTable: Boolean(p.has_table ?? p.hasTable),
                }));
                childCount = Number(workerResult.child_count || 0);
                tokenEstimate = Number(workerResult.token_estimate || 0);
                indexedByWorker = workerResult.embedding_stats?.status === 'success';
            }
            // Stage 2: Graceful Node.js fallback if Python worker is offline
            if (!markdown) {
                this.logger.warn(`Python RAG worker unavailable for blob=${blobId}; running Node.js fallback pipeline`);
                const localParsed = await this.parseLocallyFallback(payload);
                markdown = localParsed.markdown;
                pageCount = localParsed.pageCount;
                extractionMethod = localParsed.method;
            }
            if (!markdown || !markdown.trim()) {
                throw new Error('No extractable text found in source');
            }
            // If Python worker didn't chunk/index, run TypeScript Structure-Aware Parent-Child Chunker
            if (parents.length === 0 || !indexedByWorker) {
                await this.updateStatus(blobId, courseSourceId, courseId, 'chunking');
                const chunked = this.chunker.buildParentChildChunks(markdown, blobId, sourceName);
                toc = chunked.toc;
                parents = chunked.parents;
                childCount = chunked.children.length;
                tokenEstimate = chunked.tokenEstimate;
                await this.updateStatus(blobId, courseSourceId, courseId, 'embedding');
                try {
                    await this.qdrant.upsertChildChunksFallback({
                        children: chunked.children,
                        blobId,
                        courseId,
                        sourceName,
                        sourceType,
                    });
                }
                catch (qErr) {
                    // Keep source readable via ParentChunks + Object Storage even if Qdrant is temporarily down
                    this.logger.warn(`Fallback Qdrant upsert skipped (${qErr.message}); ParentChunks still saved`);
                }
            }
            // Stage 3: Store canonical extracted Markdown in Object Storage (keeps MongoDB lean!)
            const blobDoc = await this.blobModel.findById(blobId).select('sha256').lean();
            const sha = blobDoc?.sha256 || blobId;
            const markdownKey = this.storage.buildBlobKey(sha, 'markdown');
            await this.storage.putObject(markdownKey, markdown, 'text/markdown; charset=utf-8');
            // Stage 4: Persist ParentChunks idempotently via bulkWrite
            if (parents.length > 0) {
                const blobOid = new mongoose_2.Types.ObjectId(blobId);
                const ops = parents.map((p) => ({
                    updateOne: {
                        filter: { blob: blobOid, parentIndex: p.parentIndex },
                        update: {
                            $set: {
                                blob: blobOid,
                                parentIndex: p.parentIndex,
                                text: p.text,
                                sectionPath: p.sectionPath,
                                pageStart: p.pageStart,
                                pageEnd: p.pageEnd,
                                tokenCount: p.tokenCount,
                                hasFormula: p.hasFormula,
                                hasTable: p.hasTable,
                            },
                        },
                        upsert: true,
                    },
                }));
                await this.parentChunkModel.bulkWrite(ops, { ordered: false });
            }
            const summaryPreview = markdown
                .replace(/<!--\s*PAGE\s+\d+\s*-->/gi, '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 600);
            // Stage 5: Mark SourceBlob & ALL linked CourseSources as ready
            await this.blobModel.findByIdAndUpdate(blobId, {
                $set: {
                    markdownKey,
                    toc,
                    summary: summaryPreview,
                    pageCount,
                    charCount: markdown.length,
                    tokenEstimate,
                    parentCount: parents.length,
                    chunkCount: childCount,
                    extractionMethod,
                    embeddingModel,
                    vectorCollection: this.qdrant.getDefaultCollection(),
                    status: 'ready',
                    errorMessage: '',
                    vectorTier: 'hot',
                    lastAccessedAt: new Date(),
                },
            });
            await this.courseSourceModel.updateMany({ blob: new mongoose_2.Types.ObjectId(blobId) }, { $set: { status: 'ready', errorMessage: '' } });
            // Refresh Course notebook counters & legacy compatibility flags
            await this.refreshCourseStats(courseId, sourceName, pageCount, markdown.length);
            await this.cache.del(`course:pdf:${courseId}`).catch(() => undefined);
            this.emitStatus(courseId, {
                courseSourceId,
                blobId,
                status: 'ready',
                pageCount,
                chunkCount: childCount,
                tokenEstimate,
            });
            this.metrics.incCounter('studygai_ingestion_jobs_total', { kind: payload.kind, status: 'ready' });
            this.logger.log(`Ingestion READY blob=${blobId} (${sourceName}): ${parents.length} parents, ${childCount} children, ${tokenEstimate} tokens [${extractionMethod}]`);
        }
        catch (err) {
            const msg = err?.message || 'Unknown ingestion error';
            this.metrics.incCounter('studygai_ingestion_jobs_total', { kind: payload.kind, status: 'failed' });
            this.logger.error(`Ingestion FAILED blob=${blobId}: ${msg}`);
            await this.blobModel.findByIdAndUpdate(blobId, {
                $set: { status: 'failed', errorMessage: msg },
            });
            await this.courseSourceModel.updateMany({ blob: new mongoose_2.Types.ObjectId(blobId) }, { $set: { status: 'failed', errorMessage: msg } });
            this.emitStatus(courseId, { courseSourceId, blobId, status: 'failed', error: msg });
            throw err;
        }
    }
    async tryPythonWorkerIngest(payload) {
        try {
            if (payload.kind === 'url' && payload.url) {
                const resp = await axios_1.default.post(`${this.workerUrl}/ingest/url`, {
                    url: payload.url,
                    blob_id: payload.blobId,
                    course_id: payload.courseId,
                    source_name: payload.sourceName,
                }, { timeout: 60000 });
                return resp.data?.status === 'success' ? resp.data : null;
            }
            if (payload.kind === 'youtube' && payload.url) {
                const resp = await axios_1.default.post(`${this.workerUrl}/ingest/youtube`, {
                    url: payload.url,
                    blob_id: payload.blobId,
                    course_id: payload.courseId,
                }, { timeout: 60000 });
                return resp.data?.status === 'success' ? resp.data : null;
            }
            if (payload.kind === 'note' && payload.textContent) {
                const resp = await axios_1.default.post(`${this.workerUrl}/ingest/text`, {
                    text: payload.textContent,
                    blob_id: payload.blobId,
                    course_id: payload.courseId,
                    source_name: payload.sourceName,
                    source_type: 'note',
                }, { timeout: 60000 });
                return resp.data?.status === 'success' ? resp.data : null;
            }
            if (payload.kind === 'file' && payload.storageKey) {
                const fileBuf = await this.storage.getObjectBuffer(payload.storageKey);
                const form = new form_data_1.default();
                form.append('file', fileBuf, { filename: payload.sourceName });
                const resp = await axios_1.default.post(`${this.workerUrl}/ingest/file`, form, {
                    params: {
                        blob_id: payload.blobId,
                        course_id: payload.courseId,
                        source_name: payload.sourceName,
                        source_type: payload.sourceType,
                        mode: payload.mode || 'auto',
                    },
                    headers: form.getHeaders(),
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                    timeout: 180000,
                });
                return resp.data?.status === 'success' ? resp.data : null;
            }
        }
        catch (err) {
            this.logger.warn(`Python worker ingest call failed (${err.message})`);
        }
        return null;
    }
    async parseLocallyFallback(payload) {
        if (payload.kind === 'note' && payload.textContent) {
            return {
                markdown: `<!-- PAGE 1 -->\n# ${payload.sourceName}\n\n${payload.textContent.trim()}`,
                pageCount: 1,
                method: 'node_note',
            };
        }
        if (payload.kind === 'url' && payload.url) {
            const resp = await axios_1.default.get(payload.url, { timeout: 15000, responseType: 'text' });
            const html = String(resp.data || '');
            const stripped = html
                .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
                .replace(/<[^>]+>/g, '\n')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
            return {
                markdown: `<!-- PAGE 1 -->\n# ${payload.sourceName}\n\n${stripped}`,
                pageCount: 1,
                method: 'node_html_fallback',
            };
        }
        if (payload.kind === 'file' && payload.storageKey) {
            const buf = await this.storage.getObjectBuffer(payload.storageKey);
            const ext = (payload.sourceName.split('.').pop() || '').toLowerCase();
            if (ext === 'pdf') {
                const pdfParse = require('pdf-parse');
                const parsed = await pdfParse(buf);
                const text = (parsed?.text || '').trim();
                return {
                    markdown: `<!-- PAGE 1 -->\n${text}`,
                    pageCount: Number(parsed?.numpages || 1),
                    method: 'node_pdf_parse_fallback',
                };
            }
            if (ext === 'docx' || ext === 'doc' || ext === 'docm') {
                const mammoth = require('mammoth');
                const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
                const res = await mammoth.extractRawText({ arrayBuffer });
                return {
                    markdown: `<!-- PAGE 1 -->\n${(res?.value || '').trim()}`,
                    pageCount: 1,
                    method: 'node_mammoth_fallback',
                };
            }
            if (['txt', 'md', 'markdown', 'csv', 'json'].includes(ext)) {
                return {
                    markdown: `<!-- PAGE 1 -->\n${buf.toString('utf8').trim()}`,
                    pageCount: 1,
                    method: 'node_text_fallback',
                };
            }
            throw new Error(`Format .${ext} requires the Python RAG worker (OCR/PPTX/Docling) to be running at ${this.workerUrl}`);
        }
        throw new Error(`Unsupported ingestion fallback kind: ${payload.kind}`);
    }
    async updateStatus(blobId, courseSourceId, courseId, status) {
        await this.blobModel.findByIdAndUpdate(blobId, { $set: { status } });
        await this.courseSourceModel.findByIdAndUpdate(courseSourceId, { $set: { status } });
        this.emitStatus(courseId, { courseSourceId, blobId, status });
    }
    async refreshCourseStats(courseId, latestFileName, latestPages, latestChars) {
        if (!mongoose_2.Types.ObjectId.isValid(courseId))
            return;
        const sources = await this.courseSourceModel
            .find({ course: new mongoose_2.Types.ObjectId(courseId), status: 'ready' })
            .populate('blob', 'tokenEstimate')
            .lean();
        const totalTokens = sources.reduce((sum, s) => sum + Number(s.blob?.tokenEstimate || 0), 0);
        await this.courseModel.findByIdAndUpdate(courseId, {
            $set: {
                sourceCount: sources.length,
                totalTokens,
                ragVersion: 2,
                pdfProcessed: sources.length > 0,
                pdfProcessedAt: new Date(),
                pdfFileName: latestFileName,
                pdfPageCount: latestPages,
                pdfCharCount: latestChars,
            },
        });
    }
    emitStatus(courseId, payload) {
        if (this.statusEmitter && courseId) {
            try {
                this.statusEmitter(courseId, { ...payload, timestamp: new Date() });
            }
            catch {
                // Non-fatal
            }
        }
    }
};
exports.IngestionProcessor = IngestionProcessor;
exports.IngestionProcessor = IngestionProcessor = IngestionProcessor_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(6, (0, mongoose_1.InjectModel)('source_blobs')),
    __param(7, (0, mongoose_1.InjectModel)('course_sources')),
    __param(8, (0, mongoose_1.InjectModel)('parent_chunks')),
    __param(9, (0, mongoose_1.InjectModel)('courses')),
    __metadata("design:paramtypes", [config_1.ConfigService,
        storage_service_1.StorageService,
        chunker_service_1.ChunkerService,
        qdrant_service_1.QdrantService,
        cache_service_1.CacheService,
        metrics_service_1.MetricsService,
        mongoose_2.Model,
        mongoose_2.Model,
        mongoose_2.Model,
        mongoose_2.Model])
], IngestionProcessor);
//# sourceMappingURL=ingestion.processor.js.map