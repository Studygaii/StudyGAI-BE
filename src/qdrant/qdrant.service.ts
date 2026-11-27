import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';
import { CacheService } from '../cache/cache.service';
import { SparseEncoderService, SparseVector } from '../rag/sparse-encoder.service';
import { ChildChunkData } from '../rag/chunker.service';
import { MetricsService } from '../ops/metrics.service';

export type QdrantQuantizationMode = 'scalar' | 'binary' | 'none';
export type QdrantShardingMode = 'auto' | 'custom';

export interface SearchResult {
  id?: string;
  score: number;
  rerankScore?: number;
  blobId: string;
  sourceName: string;
  sourceType: string;
  text: string;
  chunkIndex: number;
  parentIndex: number;
  pageNumber: number;
  sectionPath: string;
  hasFormula?: boolean;
  hasTable?: boolean;
  metadata: Record<string, any>;
}

export interface QueryEmbeddingResult {
  dense: number[];
  sparse: SparseVector;
  model: string;
}

export interface ExportedQdrantPoint {
  id: string | number;
  vector: Record<string, any>;
  payload: Record<string, any>;
}

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
@Injectable()
export class QdrantService implements OnModuleInit {
  private readonly logger = new Logger(QdrantService.name);
  private readonly qdrantUrl: string;
  private readonly apiKey?: string;
  private readonly workerUrl: string;
  private readonly defaultCollection: string;
  private readonly vectorSize: number;
  private readonly quantizationMode: QdrantQuantizationMode;
  private readonly shardingMode: QdrantShardingMode;
  private readonly shardCount: number;
  private readonly replicationFactor: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly cache: CacheService,
    private readonly sparseEncoder: SparseEncoderService,
    private readonly metrics: MetricsService,
  ) {
    this.qdrantUrl = (this.configService.get<string>('QDRANT_URL') || 'http://localhost:6333').replace(/\/$/, '');
    this.apiKey = this.configService.get<string>('QDRANT_API_KEY');
    this.workerUrl = (
      this.configService.get<string>('RAG_WORKER_URL') ||
      this.configService.get<string>('DOCLING_SERVICE_URL') ||
      'http://localhost:5000'
    ).replace(/\/$/, '');
    this.defaultCollection = this.configService.get<string>('QDRANT_COLLECTION', 'source_chunks');
    const profile = (this.configService.get<string>('RAG_PROFILE', 'cpu') || 'cpu').toLowerCase();
    const defaultDim = profile === 'gpu' ? 1024 : 384;
    this.vectorSize = Number(this.configService.get<string>('VECTOR_DIM', String(defaultDim)));

    this.quantizationMode = (
      this.configService.get<string>('QDRANT_QUANTIZATION', 'scalar') || 'scalar'
    ).toLowerCase() as QdrantQuantizationMode;
    this.shardingMode = (
      this.configService.get<string>('QDRANT_SHARDING_MODE', 'auto') || 'auto'
    ).toLowerCase() as QdrantShardingMode;
    this.shardCount = Math.max(1, Number(this.configService.get<string>('QDRANT_SHARD_COUNT', '16')));
    this.replicationFactor = Math.max(1, Number(this.configService.get<string>('QDRANT_REPLICATION_FACTOR', '1')));

    this.logger.log(
      `QdrantService configured: url=${this.qdrantUrl}, collection=${this.defaultCollection}, dim=${this.vectorSize}, quant=${this.quantizationMode}, sharding=${this.shardingMode}(${this.shardCount})`,
    );
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureCollection(this.defaultCollection);
    } catch (error: any) {
      this.logger.warn(`Qdrant startup init skipped (${error.message}); will ensure on first vector operation`);
    }
  }

  getDefaultCollection(): string {
    return this.defaultCollection;
  }

  /**
   * Deterministic Shard-Key Router for 100M+ user Qdrant clusters.
   * Maps any `blobId` stably to `shard_00`..`shard_<N-1>` so writes and reads hit
   * ONLY the owning shard(s) instead of fanning out across every cluster node.
   */
  computeShardKey(blobId: string, shardCount = this.shardCount): string {
    const safeCount = Math.max(1, shardCount);
    const digest = crypto.createHash('sha256').update(blobId || '', 'utf8').digest();
    const bucket = digest.readUInt32BE(0) % safeCount;
    return `shard_${String(bucket).padStart(2, '0')}`;
  }

  /** Compute deduplicated list of shard keys for a batch of active notebook blobIds */
  computeShardKeysForBlobs(blobIds: string[]): string[] | undefined {
    if (this.shardingMode !== 'custom' || !blobIds || blobIds.length === 0) return undefined;
    return Array.from(new Set(blobIds.map((id) => this.computeShardKey(id))));
  }

  /** Build Qdrant collection creation payload (exposed for unit verification) */
  buildCollectionSchema(): Record<string, any> {
    const quantizationConfig =
      this.quantizationMode === 'binary'
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

  async ensureCollection(collectionName: string = this.defaultCollection): Promise<void> {
    const exists = await this.collectionExists(collectionName);
    if (!exists) {
      this.logger.log(
        `Creating hybrid multi-tenant collection "${collectionName}" (dim=${this.vectorSize}, quant=${this.quantizationMode}, sharding=${this.shardingMode})...`,
      );
      const body = this.buildCollectionSchema();

      try {
        await axios.put(`${this.qdrantUrl}/collections/${collectionName}`, body, {
          headers: this.getHeaders(),
          timeout: 15_000,
        });
      } catch (err: any) {
        if (err?.response?.status !== 409) {
          body.sparse_vectors.sparse = {};
          await axios.put(`${this.qdrantUrl}/collections/${collectionName}`, body, {
            headers: this.getHeaders(),
            timeout: 15_000,
          });
        }
      }

      // Provision custom shard keys when custom sharding is enabled
      if (this.shardingMode === 'custom') {
        for (let i = 0; i < this.shardCount; i++) {
          const shardKey = `shard_${String(i).padStart(2, '0')}`;
          await axios
            .put(
              `${this.qdrantUrl}/collections/${collectionName}/shards`,
              { shard_key: shardKey },
              { headers: this.getHeaders(), timeout: 10_000 },
            )
            .catch(() => undefined);
        }
      }
    }

    const indexes: Array<{ field_name: string; field_schema: any }> = [
      { field_name: 'blob_id', field_schema: { type: 'keyword', is_tenant: true } },
      { field_name: 'course_id', field_schema: { type: 'keyword', is_tenant: true } },
      { field_name: 'source_type', field_schema: 'keyword' },
      { field_name: 'page_number', field_schema: 'integer' },
    ];

    for (const idx of indexes) {
      await axios
        .put(`${this.qdrantUrl}/collections/${collectionName}/index`, idx, {
          headers: this.getHeaders(),
          timeout: 10_000,
        })
        .catch((err) => {
          this.logger.debug(`Payload index "${idx.field_name}" note: ${err.message}`);
        });
    }
  }

  private async collectionExists(collectionName: string): Promise<boolean> {
    try {
      const response = await axios.get(`${this.qdrantUrl}/collections/${collectionName}`, {
        headers: this.getHeaders(),
        timeout: 8_000,
      });
      return response.status === 200;
    } catch (error: any) {
      if (error?.response?.status === 404) return false;
      throw error;
    }
  }

  async embedQuery(query: string): Promise<QueryEmbeddingResult> {
    const normalized = (query || '').trim();
    const sparse = this.sparseEncoder.encode(normalized);

    const cacheKey = `rag:qemb:${crypto.createHash('sha256').update(normalized.toLowerCase()).digest('hex')}`;
    const cached = await this.cache.get<QueryEmbeddingResult>(cacheKey).catch(() => null);
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

    const cloudEmbUrl = this.configService.get<string>('EMBEDDING_API_URL');
    const cloudEmbKey = this.configService.get<string>('EMBEDDING_API_KEY');
    const cloudEmbModel = this.configService.get<string>('EMBEDDING_API_MODEL', 'text-embedding-3-small');

    if (cloudEmbUrl && cloudEmbKey) {
      try {
        const resp = await axios.post(
          cloudEmbUrl,
          { input: normalized, model: cloudEmbModel },
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${cloudEmbKey}`,
            },
            timeout: 15_000,
          },
        );
        const dense = resp.data?.data?.[0]?.embedding || resp.data?.embeddings?.[0] || [];
        if (Array.isArray(dense) && dense.length > 0) {
          const result: QueryEmbeddingResult = { dense, sparse, model: cloudEmbModel };
          await this.cache.set(cacheKey, result, 86_400).catch(() => undefined);
          return result;
        }
      } catch (err: any) {
        this.logger.warn(`Cloud embedding API failed (${err.message}); falling back to RAG worker`);
      }
    }

    try {
      const resp = await axios.post(
        `${this.workerUrl}/embed/query`,
        { query: normalized },
        { timeout: 15_000 },
      );
      if (resp.data?.status === 'success' && Array.isArray(resp.data?.dense)) {
        const result: QueryEmbeddingResult = {
          dense: resp.data.dense,
          sparse: resp.data.sparse?.indices ? resp.data.sparse : sparse,
          model: resp.data.model || 'worker-default',
        };
        await this.cache.set(cacheKey, result, 86_400).catch(() => undefined);
        return result;
      }
    } catch (err: any) {
      this.logger.warn(`RAG worker /embed/query unreachable (${err.message}); using sparse-only fallback`);
    }

    return { dense: [], sparse, model: 'sparse-only-fallback' };
  }

  async hybridSearch(params: {
    query: string;
    blobIds?: string[];
    courseId?: string;
    prefetchLimit?: number;
    limit?: number;
    rerankTopK?: number;
    collectionName?: string;
  }): Promise<SearchResult[]> {
    const {
      query,
      blobIds,
      courseId,
      prefetchLimit = 40,
      limit = 24,
      rerankTopK = 10,
      collectionName = this.defaultCollection,
    } = params;

    const must: any[] = [];
    if (blobIds && blobIds.length > 0) {
      must.push({ key: 'blob_id', match: { any: blobIds } });
    } else if (courseId) {
      must.push({ key: 'course_id', match: { value: courseId } });
    } else {
      return [];
    }

    const filter = { must };
    const shardKey = blobIds ? this.computeShardKeysForBlobs(blobIds) : undefined;
    const searchParams =
      this.quantizationMode !== 'none'
        ? { quantization: { ignore: false, rescore: true, oversampling: this.quantizationMode === 'binary' ? 3.0 : 2.0 } }
        : undefined;

    const qEmb = await this.embedQuery(query);

    const prefetch: any[] = [];
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

    if (prefetch.length === 0) return [];

    let rawPoints: any[] = [];
    try {
      const resp = await axios.post(
        `${this.qdrantUrl}/collections/${collectionName}/points/query`,
        prefetch.length > 1
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
            },
        { headers: this.getHeaders(), timeout: 15_000 },
      );

      const res = resp.data?.result;
      rawPoints = Array.isArray(res) ? res : res?.points || [];
    } catch (err: any) {
      this.logger.warn(`Qdrant /points/query fallback (${err.message})`);
      if (qEmb.dense.length > 0) {
        const resp = await axios.post(
          `${this.qdrantUrl}/collections/${collectionName}/points/search`,
          {
            vector: { name: 'dense', vector: qEmb.dense },
            filter,
            limit,
            with_payload: true,
            ...(searchParams ? { params: searchParams } : {}),
            ...(shardKey ? { shard_key: shardKey } : {}),
          },
          { headers: this.getHeaders(), timeout: 15_000 },
        );
        rawPoints = resp.data?.result || [];
      }
    }

    const mapped = rawPoints.map((hit: any) => this.mapPointToResult(hit));
    if (mapped.length === 0) return [];

    return this.rerank(query, mapped, rerankTopK);
  }

  async searchSimilarChunks(
    query: string,
    courseId: string,
    limit = 8,
    collectionName: string = this.defaultCollection,
  ): Promise<SearchResult[]> {
    return this.hybridSearch({
      query,
      courseId,
      limit: Math.max(limit * 3, 20),
      rerankTopK: limit,
      collectionName,
    });
  }

  async rerank(query: string, candidates: SearchResult[], topK = 10): Promise<SearchResult[]> {
    if (candidates.length <= 1) return candidates.slice(0, topK);

    const rerankApiUrl = this.configService.get<string>('RERANK_API_URL');
    const rerankApiKey = this.configService.get<string>('RERANK_API_KEY');
    const rerankApiModel = this.configService.get<string>('RERANK_API_MODEL', 'rerank-v3.5');

    if (rerankApiUrl && rerankApiKey) {
      try {
        const resp = await axios.post(
          rerankApiUrl,
          {
            model: rerankApiModel,
            query,
            documents: candidates.map((c) => c.text.slice(0, 2000)),
            top_n: topK,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${rerankApiKey}`,
            },
            timeout: 15_000,
          },
        );
        const results = resp.data?.results || [];
        if (Array.isArray(results) && results.length > 0) {
          return results
            .filter((r: any) => typeof r.index === 'number' && candidates[r.index])
            .map((r: any) => ({
              ...candidates[r.index],
              rerankScore: Number(r.relevance_score ?? r.score ?? 0),
            }));
        }
      } catch (err: any) {
        this.logger.warn(`Cloud reranker failed (${err.message}); falling back to RAG worker`);
      }
    }

    try {
      const resp = await axios.post(
        `${this.workerUrl}/rerank`,
        {
          query,
          documents: candidates.map((c, idx) => ({
            id: idx,
            text: c.text.slice(0, 2000),
            score: c.score,
          })),
          top_k: topK,
        },
        { timeout: 15_000 },
      );
      if (resp.data?.status === 'success' && Array.isArray(resp.data?.results)) {
        return resp.data.results
          .filter((r: any) => typeof r.id === 'number' && candidates[r.id])
          .map((r: any) => ({
            ...candidates[r.id],
            rerankScore: Number(r.rerank_score ?? r.score ?? 0),
          }));
      }
    } catch (err: any) {
      this.logger.debug(`Worker /rerank unavailable (${err.message}); using lexical rerank fallback`);
    }

    const scored = candidates.map((c) => {
      const lex = this.sparseEncoder.lexicalOverlapScore(query, c.text);
      return { ...c, rerankScore: Number((0.65 * c.score + 0.35 * lex).toFixed(6)) };
    });
    scored.sort((a, b) => (b.rerankScore || 0) - (a.rerankScore || 0));
    return scored.slice(0, topK);
  }

  async upsertChildChunksFallback(params: {
    children: ChildChunkData[];
    blobId: string;
    courseId?: string;
    sourceName: string;
    sourceType: string;
    collectionName?: string;
  }): Promise<{ chunksStored: number; collection: string }> {
    const {
      children,
      blobId,
      courseId = '',
      sourceName,
      sourceType,
      collectionName = this.defaultCollection,
    } = params;

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
        const vector: Record<string, any> = {};
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

      await axios.put(
        `${this.qdrantUrl}/collections/${collectionName}/points?wait=true`,
        {
          points,
          ...(shardKey ? { shard_key: shardKey } : {}),
        },
        { headers: this.getHeaders(), timeout: 30_000 },
      );
      stored += points.length;
    }

    return { chunksStored: stored, collection: collectionName };
  }

  /**
   * Export ALL points (including full dense + sparse vectors and payload) for a blob
   * so VectorTieringService can archive inactive notebooks to cheap S3/R2 cold storage.
   */
  async exportBlobPoints(
    blobId: string,
    collectionName: string = this.defaultCollection,
  ): Promise<ExportedQdrantPoint[]> {
    const exported: ExportedQdrantPoint[] = [];
    const shardKey = this.shardingMode === 'custom' ? this.computeShardKey(blobId) : undefined;
    let offset: string | number | null = null;

    for (let page = 0; page < 200; page++) {
      const resp = await axios.post(
        `${this.qdrantUrl}/collections/${collectionName}/points/scroll`,
        {
          filter: { must: [{ key: 'blob_id', match: { value: blobId } }] },
          limit: 128,
          with_payload: true,
          with_vector: true,
          ...(offset !== null ? { offset } : {}),
          ...(shardKey ? { shard_key: shardKey } : {}),
        },
        { headers: this.getHeaders(), timeout: 20_000 },
      );

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
      if (offset === null || pts.length === 0) break;
    }

    return exported;
  }

  /**
   * Restore previously archived dense + sparse points back into hot Qdrant on demand.
   */
  async restoreBlobPoints(
    blobId: string,
    points: ExportedQdrantPoint[],
    collectionName: string = this.defaultCollection,
  ): Promise<number> {
    if (!points.length) return 0;
    await this.ensureCollection(collectionName);
    const shardKey = this.shardingMode === 'custom' ? this.computeShardKey(blobId) : undefined;

    const batchSize = 64;
    let restored = 0;
    for (let i = 0; i < points.length; i += batchSize) {
      const batch = points.slice(i, i + batchSize);
      await axios.put(
        `${this.qdrantUrl}/collections/${collectionName}/points?wait=true`,
        {
          points: batch,
          ...(shardKey ? { shard_key: shardKey } : {}),
        },
        { headers: this.getHeaders(), timeout: 30_000 },
      );
      restored += batch.length;
    }
    return restored;
  }

  async getCourseChunks(
    courseId: string,
    blobIds?: string[],
    limit = 20,
    collectionName: string = this.defaultCollection,
  ): Promise<SearchResult[]> {
    const filter =
      blobIds && blobIds.length > 0
        ? { must: [{ key: 'blob_id', match: { any: blobIds } }] }
        : { must: [{ key: 'course_id', match: { value: courseId } }] };
    const shardKey = blobIds ? this.computeShardKeysForBlobs(blobIds) : undefined;

    const response = await axios.post(
      `${this.qdrantUrl}/collections/${collectionName}/points/scroll`,
      {
        filter,
        limit,
        with_payload: true,
        with_vectors: false,
        ...(shardKey ? { shard_key: shardKey } : {}),
      },
      { headers: this.getHeaders(), timeout: 15_000 },
    );

    const res = response.data?.result;
    const points = Array.isArray(res) ? res : res?.points || [];
    return points.map((p: any) => this.mapPointToResult({ ...p, score: 1 }));
  }

  async getCoursChunks(
    courseId: string,
    limit = 10,
    collectionName: string = this.defaultCollection,
  ): Promise<SearchResult[]> {
    return this.getCourseChunks(courseId, undefined, limit, collectionName);
  }

  async deleteBlobChunks(
    blobId: string,
    collectionName: string = this.defaultCollection,
  ): Promise<boolean> {
    const shardKey = this.shardingMode === 'custom' ? this.computeShardKey(blobId) : undefined;
    await axios.post(
      `${this.qdrantUrl}/collections/${collectionName}/points/delete?wait=true`,
      {
        filter: { must: [{ key: 'blob_id', match: { value: blobId } }] },
        ...(shardKey ? { shard_key: shardKey } : {}),
      },
      { headers: this.getHeaders(), timeout: 15_000 },
    );
    return true;
  }

  async deleteCoursChunks(
    courseId: string,
    collectionName: string = this.defaultCollection,
  ): Promise<boolean> {
    await axios.post(
      `${this.qdrantUrl}/collections/${collectionName}/points/delete?wait=true`,
      { filter: { must: [{ key: 'course_id', match: { value: courseId } }] } },
      { headers: this.getHeaders(), timeout: 15_000 },
    );
    return true;
  }

  async getEmbeddingStats(
    courseId: string,
    blobIds?: string[],
    collectionName: string = this.defaultCollection,
  ): Promise<Record<string, any>> {
    const filter =
      blobIds && blobIds.length > 0
        ? { must: [{ key: 'blob_id', match: { any: blobIds } }] }
        : { must: [{ key: 'course_id', match: { value: courseId } }] };
    const shardKey = blobIds ? this.computeShardKeysForBlobs(blobIds) : undefined;

    const countResp = await axios.post(
      `${this.qdrantUrl}/collections/${collectionName}/points/count`,
      { filter, exact: true, ...(shardKey ? { shard_key: shardKey } : {}) },
      { headers: this.getHeaders(), timeout: 10_000 },
    );
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

  async health(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.qdrantUrl}/readyz`, {
        headers: this.getHeaders(),
        timeout: 5_000,
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  private mapPointToResult(hit: any): SearchResult {
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

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['api-key'] = this.apiKey;
    return headers;
  }
}
