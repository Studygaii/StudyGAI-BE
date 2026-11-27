"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var QdrantService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.QdrantService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const axios_1 = __importDefault(require("axios"));
const crypto = __importStar(require("crypto"));
const cache_service_1 = require("../cache/cache.service");
const sparse_encoder_service_1 = require("../rag/sparse-encoder.service");
const metrics_service_1 = require("../ops/metrics.service");
/**
 * Production 100M-User Multi-Tenant Hybrid Qdrant Service.
 *
 * Scaling Features:
 * - Named vectors (`dense` + `sparse`) with configurable INT8 Scalar (4x RAM cut) or
 *   1-bit Binary Quantization (32x RAM cut) + Two-Stage Oversample & NVMe Rescoring.
 * - Tenant-aware HNSW (`m: 0, payload_m: 16`) + explicit `is_tenant: true` payload indexes
 *   on `blob_id` and `course_id`.
 * - Optional Custom Shard-Key Routing (`QDRANT_SHARDING_MODE=custom`, `QDRANT_SHARD_COUNT=16..64`)
 *   so writes and filtered reads route strictly to owning shard(s) across distributed nodes.
 * - Export & Restore APIs (`exportBlobPoints`, `restoreBlobPoints`) powering Hot/Cold S3 Tiering.
 */
let QdrantService = QdrantService_1 = class QdrantService {
    constructor(configService, cache, sparseEncoder, metrics) {
        this.configService = configService;
        this.cache = cache;
        this.sparseEncoder = sparseEncoder;
        this.metrics = metrics;
        this.logger = new common_1.Logger(QdrantService_1.name);
        this.qdrantUrl = (this.configService.get('QDRANT_URL') || 'http://localhost:6333').replace(/\/$/, '');
        this.apiKey = this.configService.get('QDRANT_API_KEY');
        this.workerUrl = (this.configService.get('RAG_WORKER_URL') ||
            this.configService.get('DOCLING_SERVICE_URL') ||
            'http://localhost:5000').replace(/\/$/, '');
        this.defaultCollection = this.configService.get('QDRANT_COLLECTION', 'source_chunks');
        const profile = (this.configService.get('RAG_PROFILE', 'cpu') || 'cpu').toLowerCase();
        const defaultDim = profile === 'gpu' ? 1024 : 384;
        this.vectorSize = Number(this.configService.get('VECTOR_DIM', String(defaultDim)));
        this.quantizationMode = (this.configService.get('QDRANT_QUANTIZATION', 'scalar') || 'scalar').toLowerCase();
        this.shardingMode = (this.configService.get('QDRANT_SHARDING_MODE', 'auto') || 'auto').toLowerCase();
        this.shardCount = Math.max(1, Number(this.configService.get('QDRANT_SHARD_COUNT', '16')));
        this.replicationFactor = Math.max(1, Number(this.configService.get('QDRANT_REPLICATION_FACTOR', '1')));
        this.logger.log(`QdrantService configured: url=${this.qdrantUrl}, collection=${this.defaultCollection}, dim=${this.vectorSize}, quant=${this.quantizationMode}, sharding=${this.shardingMode}(${this.shardCount})`);
    }
    async onModuleInit() {
        try {
            await this.ensureCollection(this.defaultCollection);
        }
        catch (error) {
            this.logger.warn(`Qdrant startup init skipped (${error.message}); will ensure on first vector operation`);
        }
    }
    getDefaultCollection() {
        return this.defaultCollection;
    }
    /**
     * Deterministic Shard-Key Router for 100M+ user Qdrant clusters.
     * Maps any `blobId` stably to `shard_00`..`shard_<N-1>` so writes and reads hit
     * ONLY the owning shard(s) instead of fanning out across every cluster node.
     */
    computeShardKey(blobId, shardCount = this.shardCount) {
        const safeCount = Math.max(1, shardCount);
        const digest = crypto.createHash('sha256').update(blobId || '', 'utf8').digest();
        const bucket = digest.readUInt32BE(0) % safeCount;
        return `shard_${String(bucket).padStart(2, '0')}`;
    }
    /** Compute deduplicated list of shard keys for a batch of active notebook blobIds */
    computeShardKeysForBlobs(blobIds) {
        if (this.shardingMode !== 'custom' || !blobIds || blobIds.length === 0)
            return undefined;
        return Array.from(new Set(blobIds.map((id) => this.computeShardKey(id))));
    }
    /** Build Qdrant collection creation payload (exposed for unit verification) */
    buildCollectionSchema() {
        const quantizationConfig = this.quantizationMode === 'binary'
            ? { binary: { always_ram: true } }
            : this.quantizationMode === 'scalar'
                ? { scalar: { type: 'int8', quantile: 0.99, always_ram: true } }
                : undefined;
        return {
            vectors: {
                dense: {
                    size: this.vectorSize,
                    distance: 'Cosine',
                    on_disk: true,
                },
            },
            sparse_vectors: {
                sparse: {
                    modifier: 'idf',
                },
            },
            hnsw_config: {
                m: 0,
                payload_m: 16,
            },
            ...(quantizationConfig ? { quantization_config: quantizationConfig } : {}),
            ...(this.shardingMode === 'custom'
                ? {
                    sharding_method: 'custom',
                    replication_factor: this.replicationFactor,
                }
                : {}),
        };
    }
    async ensureCollection(collectionName = this.defaultCollection) {
        const exists = await this.collectionExists(collectionName);
        if (!exists) {
            this.logger.log(`Creating hybrid multi-tenant collection "${collectionName}" (dim=${this.vectorSize}, quant=${this.quantizationMode}, sharding=${this.shardingMode})...`);
            const body = this.buildCollectionSchema();
            try {
                await axios_1.default.put(`${this.qdrantUrl}/collections/${collectionName}`, body, {
                    headers: this.getHeaders(),
                    timeout: 15000,
                });
            }
            catch (err) {
                if (err?.response?.status !== 409) {
                    body.sparse_vectors.sparse = {};
                    await axios_1.default.put(`${this.qdrantUrl}/collections/${collectionName}`, body, {
                        headers: this.getHeaders(),
                        timeout: 15000,
                    });
                }
            }
            // Provision custom shard keys when custom sharding is enabled
            if (this.shardingMode === 'custom') {
                for (let i = 0; i < this.shardCount; i++) {
                    const shardKey = `shard_${String(i).padStart(2, '0')}`;
                    await axios_1.default
                        .put(`${this.qdrantUrl}/collections/${collectionName}/shards`, { shard_key: shardKey }, { headers: this.getHeaders(), timeout: 10000 })
                        .catch(() => undefined);
                }
            }
        }
        const indexes = [
            { field_name: 'blob_id', field_schema: { type: 'keyword', is_tenant: true } },
            { field_name: 'course_id', field_schema: { type: 'keyword', is_tenant: true } },
            { field_name: 'source_type', field_schema: 'keyword' },
            { field_name: 'page_number', field_schema: 'integer' },
        ];
        for (const idx of indexes) {
            await axios_1.default
                .put(`${this.qdrantUrl}/collections/${collectionName}/index`, idx, {
                headers: this.getHeaders(),
                timeout: 10000,
            })
                .catch((err) => {
                this.logger.debug(`Payload index "${idx.field_name}" note: ${err.message}`);
            });
        }
    }
    async collectionExists(collectionName) {
        try {
            const response = await axios_1.default.get(`${this.qdrantUrl}/collections/${collectionName}`, {
                headers: this.getHeaders(),
                timeout: 8000,
            });
            return response.status === 200;
        }
        catch (error) {
            if (error?.response?.status === 404)
                return false;
            throw error;
        }
    }
    async embedQuery(query) {
        const normalized = (query || '').trim();
        const sparse = this.sparseEncoder.encode(normalized);
        const cacheKey = `rag:qemb:${crypto.createHash('sha256').update(normalized.toLowerCase()).digest('hex')}`;
        const cached = await this.cache.get(cacheKey).catch(() => null);
        if (cached && Array.isArray(cached.dense) && cached.dense.length > 0) {
            this.metrics.incCounter('studygai_rag_cache_events_total', {
                layer: 'query_embedding',
                outcome: 'hit',
            });
            return cached;
        }
        this.metrics.incCounter('studygai_rag_cache_events_total', {
            layer: 'query_embedding',
            outcome: 'miss',
        });
        const cloudEmbUrl = this.configService.get('EMBEDDING_API_URL');
        const cloudEmbKey = this.configService.get('EMBEDDING_API_KEY');
        const cloudEmbModel = this.configService.get('EMBEDDING_API_MODEL', 'text-embedding-3-small');
        if (cloudEmbUrl && cloudEmbKey) {
            try {
                const resp = await axios_1.default.post(cloudEmbUrl, { input: normalized, model: cloudEmbModel }, {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${cloudEmbKey}`,
                    },
                    timeout: 15000,
                });
                const dense = resp.data?.data?.[0]?.embedding || resp.data?.embeddings?.[0] || [];
                if (Array.isArray(dense) && dense.length > 0) {
                    const result = { dense, sparse, model: cloudEmbModel };
                    await this.cache.set(cacheKey, result, 86400).catch(() => undefined);
                    return result;
                }
            }
            catch (err) {
                this.logger.warn(`Cloud embedding API failed (${err.message}); falling back to RAG worker`);
            }
        }
        try {
            const resp = await axios_1.default.post(`${this.workerUrl}/embed/query`, { query: normalized }, { timeout: 15000 });
            if (resp.data?.status === 'success' && Array.isArray(resp.data?.dense)) {
                const result = {
                    dense: resp.data.dense,
                    sparse: resp.data.sparse?.indices ? resp.data.sparse : sparse,
                    model: resp.data.model || 'worker-default',
                };
                await this.cache.set(cacheKey, result, 86400).catch(() => undefined);
                return result;
            }
        }
        catch (err) {
            this.logger.warn(`RAG worker /embed/query unreachable (${err.message}); using sparse-only fallback`);
        }
        return { dense: [], sparse, model: 'sparse-only-fallback' };
    }
    async hybridSearch(params) {
        const { query, blobIds, courseId, prefetchLimit = 40, limit = 24, rerankTopK = 10, collectionName = this.defaultCollection, } = params;
        const must = [];
        if (blobIds && blobIds.length > 0) {
            must.push({ key: 'blob_id', match: { any: blobIds } });
        }
        else if (courseId) {
            must.push({ key: 'course_id', match: { value: courseId } });
        }
        else {
            return [];
        }
        const filter = { must };
        const shardKey = blobIds ? this.computeShardKeysForBlobs(blobIds) : undefined;
        const searchParams = this.quantizationMode !== 'none'
            ? { quantization: { ignore: false, rescore: true, oversampling: this.quantizationMode === 'binary' ? 3.0 : 2.0 } }
            : undefined;
        const qEmb = await this.embedQuery(query);
        const prefetch = [];
        if (qEmb.dense.length > 0) {
            prefetch.push({
                query: qEmb.dense,
                using: 'dense',
                limit: prefetchLimit,
                filter,
                ...(searchParams ? { params: searchParams } : {}),
            });
        }
        if (qEmb.sparse.indices.length > 0) {
            prefetch.push({
                query: qEmb.sparse,
                using: 'sparse',
                limit: prefetchLimit,
                filter,
            });
        }
        if (prefetch.length === 0)
            return [];
        let rawPoints = [];
        try {
            const resp = await axios_1.default.post(`${this.qdrantUrl}/collections/${collectionName}/points/query`, prefetch.length > 1
                ? {
                    prefetch,
                    query: { fusion: 'rrf' },
                    limit,
                    with_payload: true,
                    ...(shardKey ? { shard_key: shardKey } : {}),
                }
                : {
                    query: prefetch[0].query,
                    using: prefetch[0].using,
                    filter,
                    limit,
                    with_payload: true,
                    ...(searchParams && prefetch[0].using === 'dense' ? { params: searchParams } : {}),
                    ...(shardKey ? { shard_key: shardKey } : {}),
                }, { headers: this.getHeaders(), timeout: 15000 });
            const res = resp.data?.result;
            rawPoints = Array.isArray(res) ? res : res?.points || [];
        }
        catch (err) {
            this.logger.warn(`Qdrant /points/query fallback (${err.message})`);
            if (qEmb.dense.length > 0) {
                const resp = await axios_1.default.post(`${this.qdrantUrl}/collections/${collectionName}/points/search`, {
                    vector: { name: 'dense', vector: qEmb.dense },
                    filter,
                    limit,
                    with_payload: true,
                    ...(searchParams ? { params: searchParams } : {}),
                    ...(shardKey ? { shard_key: shardKey } : {}),
                }, { headers: this.getHeaders(), timeout: 15000 });
                rawPoints = resp.data?.result || [];
            }
        }
        const mapped = rawPoints.map((hit) => this.mapPointToResult(hit));
        if (mapped.length === 0)
            return [];
        return this.rerank(query, mapped, rerankTopK);
    }
    async searchSimilarChunks(query, courseId, limit = 8, collectionName = this.defaultCollection) {
        return this.hybridSearch({
            query,
            courseId,
            limit: Math.max(limit * 3, 20),
            rerankTopK: limit,
            collectionName,
        });
    }
    async rerank(query, candidates, topK = 10) {
        if (candidates.length <= 1)
            return candidates.slice(0, topK);
        const rerankApiUrl = this.configService.get('RERANK_API_URL');
        const rerankApiKey = this.configService.get('RERANK_API_KEY');
        const rerankApiModel = this.configService.get('RERANK_API_MODEL', 'rerank-v3.5');
        if (rerankApiUrl && rerankApiKey) {
            try {
                const resp = await axios_1.default.post(rerankApiUrl, {
                    model: rerankApiModel,
                    query,
                    documents: candidates.map((c) => c.text.slice(0, 2000)),
                    top_n: topK,
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${rerankApiKey}`,
                    },
                    timeout: 15000,
                });
                const results = resp.data?.results || [];
                if (Array.isArray(results) && results.length > 0) {
                    return results
                        .filter((r) => typeof r.index === 'number' && candidates[r.index])
                        .map((r) => ({
                        ...candidates[r.index],
                        rerankScore: Number(r.relevance_score ?? r.score ?? 0),
                    }));
                }
            }
            catch (err) {
                this.logger.warn(`Cloud reranker failed (${err.message}); falling back to RAG worker`);
            }
        }
        try {
            const resp = await axios_1.default.post(`${this.workerUrl}/rerank`, {
                query,
                documents: candidates.map((c, idx) => ({
                    id: idx,
                    text: c.text.slice(0, 2000),
                    score: c.score,
                })),
                top_k: topK,
            }, { timeout: 15000 });
            if (resp.data?.status === 'success' && Array.isArray(resp.data?.results)) {
                return resp.data.results
                    .filter((r) => typeof r.id === 'number' && candidates[r.id])
                    .map((r) => ({
                    ...candidates[r.id],
                    rerankScore: Number(r.rerank_score ?? r.score ?? 0),
                }));
            }
        }
        catch (err) {
            this.logger.debug(`Worker /rerank unavailable (${err.message}); using lexical rerank fallback`);
        }
        const scored = candidates.map((c) => {
            const lex = this.sparseEncoder.lexicalOverlapScore(query, c.text);
            return { ...c, rerankScore: Number((0.65 * c.score + 0.35 * lex).toFixed(6)) };
        });
        scored.sort((a, b) => (b.rerankScore || 0) - (a.rerankScore || 0));
        return scored.slice(0, topK);
    }
    async upsertChildChunksFallback(params) {
        const { children, blobId, courseId = '', sourceName, sourceType, collectionName = this.defaultCollection, } = params;
        if (children.length === 0) {
            return { chunksStored: 0, collection: collectionName };
        }
        await this.ensureCollection(collectionName);
        const shardKey = this.shardingMode === 'custom' ? this.computeShardKey(blobId) : undefined;
        const batchSize = 64;
        let stored = 0;
        for (let i = 0; i < children.length; i += batchSize) {
            const batch = children.slice(i, i + batchSize);
            const points = batch.map((c) => {
                const sparse = this.sparseEncoder.encode(c.contextualText || c.text);
                const vector = {};
                if (sparse.indices.length > 0) {
                    vector.sparse = sparse;
                }
                return {
                    id: c.pointId,
                    vector,
                    payload: {
                        blob_id: blobId,
                        course_id: courseId,
                        source_name: sourceName,
                        source_type: sourceType,
                        chunk_index: c.childIndex,
                        parent_index: c.parentIndex,
                        page_number: c.pageNumber,
                        section_path: c.sectionPath,
                        text: c.text,
                        has_formula: c.hasFormula,
                        has_table: c.hasTable,
                        token_count: c.tokenCount,
                        chunk_count: children.length,
                    },
                };
            });
            await axios_1.default.put(`${this.qdrantUrl}/collections/${collectionName}/points?wait=true`, {
                points,
                ...(shardKey ? { shard_key: shardKey } : {}),
            }, { headers: this.getHeaders(), timeout: 30000 });
            stored += points.length;
        }
        return { chunksStored: stored, collection: collectionName };
    }
    /**
     * Export ALL points (including full dense + sparse vectors and payload) for a blob
     * so VectorTieringService can archive inactive notebooks to cheap S3/R2 cold storage.
     */
    async exportBlobPoints(blobId, collectionName = this.defaultCollection) {
        const exported = [];
        const shardKey = this.shardingMode === 'custom' ? this.computeShardKey(blobId) : undefined;
        let offset = null;
        for (let page = 0; page < 200; page++) {
            const resp = await axios_1.default.post(`${this.qdrantUrl}/collections/${collectionName}/points/scroll`, {
                filter: { must: [{ key: 'blob_id', match: { value: blobId } }] },
                limit: 128,
                with_payload: true,
                with_vector: true,
                ...(offset !== null ? { offset } : {}),
                ...(shardKey ? { shard_key: shardKey } : {}),
            }, { headers: this.getHeaders(), timeout: 20000 });
            const res = resp.data?.result || {};
            const pts = Array.isArray(res) ? res : res.points || [];
            for (const p of pts) {
                exported.push({
                    id: p.id,
                    vector: p.vector || {},
                    payload: p.payload || {},
                });
            }
            offset = res.next_page_offset ?? null;
            if (offset === null || pts.length === 0)
                break;
        }
        return exported;
    }
    /**
     * Restore previously archived dense + sparse points back into hot Qdrant on demand.
     */
    async restoreBlobPoints(blobId, points, collectionName = this.defaultCollection) {
        if (!points.length)
            return 0;
        await this.ensureCollection(collectionName);
        const shardKey = this.shardingMode === 'custom' ? this.computeShardKey(blobId) : undefined;
        const batchSize = 64;
        let restored = 0;
        for (let i = 0; i < points.length; i += batchSize) {
            const batch = points.slice(i, i + batchSize);
            await axios_1.default.put(`${this.qdrantUrl}/collections/${collectionName}/points?wait=true`, {
                points: batch,
                ...(shardKey ? { shard_key: shardKey } : {}),
            }, { headers: this.getHeaders(), timeout: 30000 });
            restored += batch.length;
        }
        return restored;
    }
    async getCourseChunks(courseId, blobIds, limit = 20, collectionName = this.defaultCollection) {
        const filter = blobIds && blobIds.length > 0
            ? { must: [{ key: 'blob_id', match: { any: blobIds } }] }
            : { must: [{ key: 'course_id', match: { value: courseId } }] };
        const shardKey = blobIds ? this.computeShardKeysForBlobs(blobIds) : undefined;
        const response = await axios_1.default.post(`${this.qdrantUrl}/collections/${collectionName}/points/scroll`, {
            filter,
            limit,
            with_payload: true,
            with_vectors: false,
            ...(shardKey ? { shard_key: shardKey } : {}),
        }, { headers: this.getHeaders(), timeout: 15000 });
        const res = response.data?.result;
        const points = Array.isArray(res) ? res : res?.points || [];
        return points.map((p) => this.mapPointToResult({ ...p, score: 1 }));
    }
    async getCoursChunks(courseId, limit = 10, collectionName = this.defaultCollection) {
        return this.getCourseChunks(courseId, undefined, limit, collectionName);
    }
    async deleteBlobChunks(blobId, collectionName = this.defaultCollection) {
        const shardKey = this.shardingMode === 'custom' ? this.computeShardKey(blobId) : undefined;
        await axios_1.default.post(`${this.qdrantUrl}/collections/${collectionName}/points/delete?wait=true`, {
            filter: { must: [{ key: 'blob_id', match: { value: blobId } }] },
            ...(shardKey ? { shard_key: shardKey } : {}),
        }, { headers: this.getHeaders(), timeout: 15000 });
        return true;
    }
    async deleteCoursChunks(courseId, collectionName = this.defaultCollection) {
        await axios_1.default.post(`${this.qdrantUrl}/collections/${collectionName}/points/delete?wait=true`, { filter: { must: [{ key: 'course_id', match: { value: courseId } }] } }, { headers: this.getHeaders(), timeout: 15000 });
        return true;
    }
    async getEmbeddingStats(courseId, blobIds, collectionName = this.defaultCollection) {
        const filter = blobIds && blobIds.length > 0
            ? { must: [{ key: 'blob_id', match: { any: blobIds } }] }
            : { must: [{ key: 'course_id', match: { value: courseId } }] };
        const shardKey = blobIds ? this.computeShardKeysForBlobs(blobIds) : undefined;
        const countResp = await axios_1.default.post(`${this.qdrantUrl}/collections/${collectionName}/points/count`, { filter, exact: true, ...(shardKey ? { shard_key: shardKey } : {}) }, { headers: this.getHeaders(), timeout: 10000 });
        const totalChunks = Number(countResp.data?.result?.count || 0);
        return {
            courseId,
            collection: collectionName,
            totalChunks,
            hasEmbeddings: totalChunks > 0,
            blobCount: blobIds?.length ?? null,
            quantization: this.quantizationMode,
            shardingMode: this.shardingMode,
        };
    }
    async health() {
        try {
            const response = await axios_1.default.get(`${this.qdrantUrl}/readyz`, {
                headers: this.getHeaders(),
                timeout: 5000,
            });
            return response.status === 200;
        }
        catch {
            return false;
        }
    }
    mapPointToResult(hit) {
        const pl = hit?.payload || {};
        return {
            id: hit?.id?.toString(),
            score: Number(hit?.score ?? 0),
            blobId: pl.blob_id || '',
            sourceName: pl.source_name || pl.pdf_name || 'Source',
            sourceType: pl.source_type || 'pdf',
            text: pl.text || '',
            chunkIndex: Number(pl.chunk_index ?? -1),
            parentIndex: Number(pl.parent_index ?? 0),
            pageNumber: Number(pl.page_number ?? 1),
            sectionPath: pl.section_path || 'Document',
            hasFormula: Boolean(pl.has_formula),
            hasTable: Boolean(pl.has_table),
            metadata: {
                blobId: pl.blob_id,
                sourceName: pl.source_name,
                sourceType: pl.source_type,
                pageNumber: pl.page_number,
                sectionPath: pl.section_path,
                parentIndex: pl.parent_index,
            },
        };
    }
    getHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        if (this.apiKey)
            headers['api-key'] = this.apiKey;
        return headers;
    }
};
exports.QdrantService = QdrantService;
exports.QdrantService = QdrantService = QdrantService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        cache_service_1.CacheService,
        sparse_encoder_service_1.SparseEncoderService,
        metrics_service_1.MetricsService])
], QdrantService);
//# sourceMappingURL=qdrant.service.js.map