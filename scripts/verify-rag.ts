/**
 * Verification Suite for StudyGAI RAG v2 Core Components.
 *
 * Verifies:
 * 1. Structure-Aware Parent-Child Chunker (zero infinite loop, page markers, TOC, LaTeX, tables)
 * 2. Deterministic UUIDv5 Point IDs & Cross-Language Parity with Python chunker.py
 * 3. Deterministic BM25 Sparse Vector Encoder & Cross-Language Parity with Python embeddings.py
 * 4. Citation Grounding & Extraction (`markCitedReferences`)
 * 5. Content-Addressable Storage & SHA-256 Sharded Blob Keys
 */

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { ChunkerService } from '../src/rag/chunker.service';
import { SparseEncoderService } from '../src/rag/sparse-encoder.service';
import { RagOrchestratorService, CitationItem } from '../src/rag/rag-orchestrator.service';
import { StorageService } from '../src/storage/storage.service';

async function run() {
  console.log('=== StudyGAI RAG v2 Verification Suite ===\n');

  const chunker = new ChunkerService();
  const sparse = new SparseEncoderService();

  // 1. Regression test for prior infinite-loop chunker bug
  const longText = 'word '.repeat(250);
  const splitPieces = chunker.hardWindowSplit(longText, 512, 100);
  assert(splitPieces.length >= 2 && splitPieces.length < 10, `Unexpected split count: ${splitPieces.length}`);
  console.log(`[PASS] 1. Fixed-window splitter terminates cleanly (${splitPieces.length} pieces)`);

  // 2. Structure-Aware Parent-Child Chunker with pages, headings, LaTeX & tables
  const sampleMarkdown = `<!-- PAGE 1 -->
# Calculus 101

## 1.1 Chain Rule
The chain rule computes the derivative of a composite function. ${'Applications include backpropagation in neural networks. '.repeat(35)}

$$
\\frac{d}{dx}[f(g(x))] = f'(g(x)) \\cdot g'(x)
$$

<!-- PAGE 2 -->
## 1.2 Standard Derivatives

| Function | Derivative |
| --- | --- |
| x^n | n*x^(n-1) |
| sin(x) | cos(x) |

Remember to verify domain continuity before differentiating.
`;

  const res1 = chunker.buildParentChildChunks(sampleMarkdown, 'blob_test_123', 'calc101.pdf');
  const res2 = chunker.buildParentChildChunks(sampleMarkdown, 'blob_test_123', 'calc101.pdf');

  assert.strictEqual(res1.toc.length, 3, 'Expected 3 TOC entries');
  assert(res1.parents.length >= 2, 'Expected >= 2 parent chunks');
  assert(res1.children.length >= 2, 'Expected >= 2 child chunks');
  assert.strictEqual(
    res1.children[0].pointId,
    res2.children[0].pointId,
    'Point IDs must be deterministic across runs',
  );
  assert(res1.parents.some((p) => p.hasFormula), 'Formula detection failed');
  assert(res1.parents.some((p) => p.hasTable), 'Table detection failed');
  assert(
    res1.children[0].contextualText.includes('[Source: calc101.pdf |'),
    'Contextual header missing from child chunk',
  );
  console.log(
    `[PASS] 2. Parent-Child Chunker: ${res1.toc.length} TOC, ${res1.parents.length} parents, ${res1.children.length} children, ${res1.tokenEstimate} tokens`,
  );

  // 3. Cross-Language Parity: TypeScript vs Python UUIDv5 Point IDs & Sparse BM25 Buckets
  const pyOut = execFileSync(
    'python3',
    [
      '-c',
      `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.resolve(__dirname, '../docling-service'))})
from chunker import deterministic_point_id
from embeddings import hash_sparse_vector
print(json.dumps({
  "point_id": deterministic_point_id("blob_test_123", 7),
  "sparse": hash_sparse_vector("Explain the Chain Rule derivative backpropagation formula")
}))
`,
    ],
    { encoding: 'utf8' },
  );
  const pyData = JSON.parse(pyOut.trim());
  const tsPointId = chunker.deterministicPointId('blob_test_123', 7);
  const tsSparse = sparse.encode('Explain the Chain Rule derivative backpropagation formula');

  assert.strictEqual(tsPointId, pyData.point_id, `UUIDv5 mismatch: TS=${tsPointId} vs PY=${pyData.point_id}`);
  assert.deepStrictEqual(tsSparse.indices, pyData.sparse.indices, 'Sparse BM25 bucket indices mismatch between TS and Python!');
  assert.deepStrictEqual(tsSparse.values, pyData.sparse.values, 'Sparse BM25 weights mismatch between TS and Python!');
  console.log(`[PASS] 3. Cross-Language Parity (TS === Python): UUIDv5=${tsPointId}, ${tsSparse.indices.length} identical BM25 sparse buckets`);

  // 4. Citation Grounding Extraction
  const orchestratorProto = Object.create(RagOrchestratorService.prototype);
  const candidates: CitationItem[] = [
    {
      index: 1,
      sourceId: 's1',
      blobId: 'b1',
      sourceTitle: 'calc101.pdf',
      sectionPath: 'Calculus 101 > 1.1 Chain Rule',
      pageNumber: 1,
      parentIndex: 0,
      quote: 'The chain rule computes...',
      score: 0.92,
      citedInAnswer: false,
    },
    {
      index: 2,
      sourceId: 's2',
      blobId: 'b2',
      sourceTitle: 'notes.md',
      sectionPath: 'Document',
      pageNumber: 2,
      parentIndex: 1,
      quote: 'Derivative of sin(x)...',
      score: 0.78,
      citedInAnswer: false,
    },
  ];
  const marked = orchestratorProto.markCitedReferences(
    'The chain rule differentiates composite functions [1], which is essential for backprop [1].',
    candidates,
  );
  assert.strictEqual(marked[0].citedInAnswer, true);
  assert.strictEqual(marked[1].citedInAnswer, false);
  console.log('[PASS] 4. Citation grounding extraction accurately flags referenced [n] markers');

  // 5. Local Content-Sharded Object Storage & SHA-256 Deduplication
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studygai-storage-'));
  const mockConfig = {
    get: (key: string, def?: any) => {
      if (key === 'STORAGE_DRIVER') return 'local';
      if (key === 'LOCAL_STORAGE_DIR') return tmpDir;
      return def;
    },
  } as any;
  const storage = new StorageService(mockConfig);
  await storage.onModuleInit();

  const digest = storage.sha256('identical textbook bytes');
  const key = storage.buildBlobKey(digest, 'markdown');
  assert(key.startsWith(`blobs/md/${digest.slice(0, 2)}/${digest.slice(2, 4)}/`), `Unexpected sharded key: ${key}`);
  await storage.putObject(key, '# Hello World');
  assert.strictEqual(await storage.exists(key), true);
  assert.strictEqual(await storage.getObjectText(key), '# Hello World');
  await storage.deleteObject(key);
  assert.strictEqual(await storage.exists(key), false);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(`[PASS] 5. Content-sharded Object Storage verified (${key})`);

  console.log('\nALL RAG v2 VERIFICATION TESTS PASSED!');
}

run().catch((err) => {
  console.error('\nVERIFICATION FAILED:', err);
  process.exit(1);
});
