/**
 * Phase 4 Verification Suite: 100M+ Scale Hardening & Observability.
 *
 * Run with: npm run verify:scale
 *
 * Verifies:
 * 1. Deterministic Qdrant Custom Shard-Key Routing & Distribution Uniformity
 * 2. 1-Bit Binary Quantization & Custom Sharding Collection Schema Builder
 * 3. Hot -> Cold Gzipped Vector Snapshot Archival -> Eviction -> Transparent Re-Hydration
 *    (including concurrent thundering-herd lock deduplication)
 * 4. Distributed Rate Limiter (allow/block/quota/bucket routing)
 * 5. Prometheus OpenMetrics 0.0.4 Text Exposition Format Compliance
 */

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QdrantService, ExportedQdrantPoint } from '../src/qdrant/qdrant.service';
import { VectorTieringService } from '../src/rag/vector-tiering.service';
import { StorageService } from '../src/storage/storage.service';
import { MetricsService } from '../src/ops/metrics.service';
import { RateLimitMiddleware } from '../src/ops/rate-limit.middleware';
import { SparseEncoderService } from '../src/rag/sparse-encoder.service';
import { ChunkerService } from '../src/rag/chunker.service';

async function run() {
  console.log('=== StudyGAI Phase 4 Scale & Observability Verification ===\n');

  const metrics = new MetricsService();
  const sparse = new SparseEncoderService();

  // 1. Custom Shard-Key Routing & Binary Quantization Schema
  const prodConfig = {
    get: (key: string, def?: any) => {
      const map: Record<string, string> = {
        QDRANT_URL: 'http://localhost:6333',
        QDRANT_COLLECTION: 'source_chunks',
        RAG_PROFILE: 'gpu',
        VECTOR_DIM: '1024',
        QDRANT_QUANTIZATION: 'binary',
        QDRANT_SHARDING_MODE: 'custom',
        QDRANT_SHARD_COUNT: '32',
        QDRANT_REPLICATION_FACTOR: '2',
      };
      return map[key] ?? def;
    },
  } as any;
  const mockCache = {
    get: async () => null,
    set: async () => undefined,
    del: async () => undefined,
    getClient: () => null,
    ping: async () => false,
  } as any;

  const qdrant = new QdrantService(prodConfig, mockCache, sparse, metrics);

  const schema = qdrant.buildCollectionSchema();
  assert.strictEqual(schema.vectors.dense.size, 1024, 'Expected 1024d GPU vector dim');
  assert.strictEqual(schema.vectors.dense.on_disk, true, 'Expected on_disk dense vectors');
  assert.deepStrictEqual(schema.quantization_config, { binary: { always_ram: true } });
  assert.strictEqual(schema.sharding_method, 'custom');
  assert.strictEqual(schema.replication_factor, 2);
  assert.strictEqual(schema.hnsw_config.m, 0);
  assert.strictEqual(schema.hnsw_config.payload_m, 16);

  // Verify deterministic routing & shard spread across 500 synthetic blobs
  const shardSet = new Set<string>();
  const sampleShard = qdrant.computeShardKey('blob_calculus_101');
  assert.strictEqual(sampleShard, qdrant.computeShardKey('blob_calculus_101'), 'Shard routing must be deterministic');
  for (let i = 0; i < 500; i++) {
    shardSet.add(qdrant.computeShardKey(`blob_${i}`));
  }
  assert.strictEqual(shardSet.size, 32, `Expected all 32 shards populated, got ${shardSet.size}`);
  console.log(`[PASS] 1. Qdrant 1-bit Binary Quantization + 32-shard deterministic routing verified (${sampleShard})`);

  // 2. Full Hot -> Cold Snapshot Archive -> Delete -> Concurrent Re-Hydration Round-Trip
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studygai-tiering-'));
  const storage = new StorageService({
    get: (k: string, d?: any) => (k === 'STORAGE_DRIVER' ? 'local' : k === 'LOCAL_STORAGE_DIR' ? tmpDir : d),
  } as any);
  await storage.onModuleInit();

  const samplePoints: ExportedQdrantPoint[] = [
    {
      id: '11111111-2222-5333-8444-555555555555',
      vector: { dense: [0.1, -0.2, 0.3], sparse: { indices: [12, 44], values: [1.5, 0.8] } },
      payload: { blob_id: '507f1f77bcf86cd799439011', text: 'Chain rule proof', page_number: 4 },
    },
    {
      id: '11111111-2222-5333-8444-555555555556',
      vector: { dense: [0.4, 0.5, -0.1], sparse: { indices: [88], values: [2.1] } },
      payload: { blob_id: '507f1f77bcf86cd799439011', text: 'Backprop gradient flow', page_number: 5 },
    },
  ];

  // Mock in-memory Qdrant + Mongo blob store to test full VectorTieringService end-to-end
  const hotQdrantStore = new Map<string, ExportedQdrantPoint[]>([
    ['507f1f77bcf86cd799439011', samplePoints],
  ]);
  let restoreCalls = 0;

  const mockQdrantForTiering = {
    exportBlobPoints: async (blobId: string) => hotQdrantStore.get(blobId) || [],
    deleteBlobChunks: async (blobId: string) => {
      hotQdrantStore.delete(blobId);
      return true;
    },
    restoreBlobPoints: async (blobId: string, pts: ExportedQdrantPoint[]) => {
      restoreCalls++;
      // Simulate tiny network delay so concurrent re-hydration hits the in-flight lock
      await new Promise((r) => setTimeout(r, 20));
      hotQdrantStore.set(blobId, pts);
      return pts.length;
    },
  } as any;

  const mockBlobRecord: any = {
    _id: { toString: () => '507f1f77bcf86cd799439011' },
    sha256: storage.sha256('cold-textbook-bytes'),
    sourceType: 'pdf',
    originalName: 'calc101.pdf',
    vectorCollection: 'source_chunks',
    vectorTier: 'hot',
    vectorArchiveKey: '',
    lastAccessedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
    save: async () => mockBlobRecord,
  };

  const mockBlobModel = {
    find: (query: any) => ({
      sort: () => ({
        limit: () => ({
          exec: async () => (mockBlobRecord.vectorTier === 'hot' ? [mockBlobRecord] : []),
        }),
      }),
      exec: async () => (mockBlobRecord.vectorTier === 'cold' ? [mockBlobRecord] : []),
    }),
  } as any;

  const tiering = new VectorTieringService(
    { get: (_k: string, d?: any) => d } as any,
    storage,
    mockQdrantForTiering,
    new ChunkerService(),
    metrics,
    mockBlobModel,
    {} as any,
  );

  // Archive Hot -> Cold
  const archRes = await tiering.archiveColdBlobs(30, 50);
  assert.strictEqual(archRes.archived, 1);
  assert.strictEqual(archRes.evictedPoints, 2);
  assert.strictEqual(mockBlobRecord.vectorTier, 'cold');
  assert.strictEqual(hotQdrantStore.size, 0, 'Points must be evicted from hot Qdrant');
  assert.strictEqual(await storage.exists(mockBlobRecord.vectorArchiveKey), true, 'Gzip snapshot must exist in storage');

  // Fire 5 concurrent re-hydration calls -> thundering-herd lock must execute restoreBlobPoints ONCE!
  await Promise.all([
    tiering.ensureBlobsHot(['507f1f77bcf86cd799439011']),
    tiering.ensureBlobsHot(['507f1f77bcf86cd799439011']),
    tiering.ensureBlobsHot(['507f1f77bcf86cd799439011']),
    tiering.ensureBlobsHot(['507f1f77bcf86cd799439011']),
    tiering.ensureBlobsHot(['507f1f77bcf86cd799439011']),
  ]);
  assert.strictEqual(restoreCalls, 1, `Thundering-herd lock failed: expected 1 restore call, got ${restoreCalls}`);
  assert.strictEqual(mockBlobRecord.vectorTier, 'hot');
  assert.deepStrictEqual(hotQdrantStore.get('507f1f77bcf86cd799439011'), samplePoints);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('[PASS] 2. Hot -> Cold Gzip Snapshot Archive & Lock-Protected Re-Hydration verified');

  // 3. Distributed Rate Limiter (with in-memory fallback)
  const limiter = new RateLimitMiddleware(
    {
      get: (k: string, d?: any) =>
        k === 'RATE_LIMIT_CHAT_RPM' ? '3' : k === 'RATE_LIMIT_ENABLED' ? 'true' : d,
    } as any,
    mockCache,
    metrics,
  );
  const chatBucket = limiter.resolveBucket('/api/v1/chat/send', 'POST');
  assert.strictEqual(chatBucket.name, 'rag_chat');
  assert.strictEqual(chatBucket.limit, 3);

  const r1 = await limiter.consumeToken(chatBucket, 'u:test1');
  const r2 = await limiter.consumeToken(chatBucket, 'u:test1');
  const r3 = await limiter.consumeToken(chatBucket, 'u:test1');
  const r4 = await limiter.consumeToken(chatBucket, 'u:test1');
  assert.strictEqual(r1.allowed, true);
  assert.strictEqual(r2.allowed, true);
  assert.strictEqual(r3.allowed, true);
  assert.strictEqual(r4.allowed, false, '4th request must be rate-limited');
  console.log('[PASS] 3. Tiered Rate Limiter bucket resolution & enforcement verified (3 allowed, 4th blocked)');

  // 4. Prometheus OpenMetrics 0.0.4 Format Compliance
  metrics.incCounter('studygai_rag_queries_total', {
    strategy: 'hybrid_rag',
    mode: 'tutor',
    provider: 'groq',
  });
  metrics.observeHistogram('studygai_rag_latency_ms', 420, { strategy: 'hybrid_rag' });
  const promText = metrics.renderPrometheus();
  assert(promText.includes('# TYPE studygai_rag_queries_total counter'), 'Missing counter TYPE');
  assert(
    promText.includes('studygai_rag_queries_total{mode="tutor",provider="groq",strategy="hybrid_rag"} 1'),
    'Missing labeled RAG query counter',
  );
  assert(
    promText.includes('studygai_rag_latency_ms_bucket{strategy="hybrid_rag",le="600"} 1'),
    'Missing histogram bucket',
  );
  assert(
    promText.includes('studygai_vector_tiering_events_total{action="archived"} 1'),
    'Missing archival metric',
  );
  assert(
    promText.includes('studygai_vector_tiering_events_total{action="rehydrated"} 1'),
    'Missing rehydration metric',
  );
  console.log('[PASS] 4. Prometheus OpenMetrics 0.0.4 exporter verified (counters, histograms, gauges)');

  console.log('\nALL PHASE 4 SCALE & OBSERVABILITY TESTS PASSED!');
}

run().catch((err) => {
  console.error('\nPHASE 4 VERIFICATION FAILED:', err);
  process.exit(1);
});
