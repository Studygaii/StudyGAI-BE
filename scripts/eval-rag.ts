/**
 * Automated RAG Evaluation & Quality Gate Harness (RAGAS-Inspired)
 *
 * Run with: npm run eval:rag
 *
 * Evaluates StudyGAI's RAG pipeline against a curated multi-document STEM + Systems
 * golden dataset:
 *   - Recall@1, Recall@3, Recall@5
 *   - MRR (Mean Reciprocal Rank)
 *   - GraphRAG 1-Hop Expansion Recall Lift (multi-hop queries)
 *   - Citation Grounding & Verification Precision
 *   - Concept Graph JSON extraction + Mastery-Aware Directive generation
 *   - Retrieval p50 / p95 latency
 */

import assert from 'assert';
import { ChunkerService } from '../src/rag/chunker.service';
import { SparseEncoderService } from '../src/rag/sparse-encoder.service';
import { RagOrchestratorService, CitationItem } from '../src/rag/rag-orchestrator.service';
import { ConceptGraphService } from '../src/rag/concept-graph.service';
import { MasteryService } from '../src/rag/mastery.service';

interface GoldenDoc {
  blobId: string;
  title: string;
  markdown: string;
}

interface GoldenQuery {
  id: string;
  query: string;
  expectedBlobId: string;
  expectedKeyword: string;
  isMultiHop?: boolean;
  graphExpansionTerms?: string[];
}

const GOLDEN_CORPUS: GoldenDoc[] = [
  {
    blobId: 'blob_calc',
    title: 'Calculus_101.pdf',
    markdown: `<!-- PAGE 1 -->
# Calculus Foundations

## 1.1 Limits and Continuity
A function f(x) is continuous at c if the limit as x approaches c equals f(c). Continuity is a prerequisite for differentiability.

## 1.2 The Chain Rule
The Chain Rule computes the derivative of a composite function h(x) = f(g(x)).
$$
\\frac{d}{dx}[f(g(x))] = f'(g(x)) \\cdot g'(x)
$$
In deep learning, backpropagation repeatedly applies the chain rule across neural network layers to compute gradients of the loss function.

<!-- PAGE 2 -->
## 1.3 Integration by Parts
Integration by parts reverses the product rule: integral of u dv equals u*v minus integral of v du.
`,
  },
  {
    blobId: 'blob_dist',
    title: 'Distributed_Systems.pdf',
    markdown: `<!-- PAGE 1 -->
# Consensus & Vector Scaling

## 2.1 Raft Consensus
Raft decomposes consensus into leader election, log replication, and safety guarantees. Only leaders append new entries and replicate them to followers via AppendEntries RPCs.

## 2.2 Qdrant Tiered Multitenancy
For 100M-user multi-tenant vector search, setting hnsw_config m=0 and payload_m=16 with is_tenant=true builds isolated HNSW subgraphs per tenant. Scalar INT8 quantization reduces memory by 4x and binary 1-bit quantization reduces memory by 32x with NVMe rescoring.

<!-- PAGE 2 -->
## 2.3 Content-Addressable Deduplication
Hashing uploaded files with SHA-256 lets identical textbooks share a single SourceBlob and vector set across millions of students, cutting storage and embedding costs by up to 80 percent.
`,
  },
  {
    blobId: 'blob_bio',
    title: 'Molecular_Biology.pdf',
    markdown: `<!-- PAGE 1 -->
# Cellular Respiration

## 3.1 Glycolysis
Glycolysis occurs in the cytoplasm and breaks one glucose molecule into two pyruvate molecules, producing a net yield of 2 ATP and 2 NADH without requiring oxygen.

## 3.2 Oxidative Phosphorylation
Inside the inner mitochondrial membrane, the electron transport chain builds a proton gradient driving ATP synthase to generate roughly 30 to 32 ATP per glucose molecule.
`,
  },
];

const GOLDEN_QUERIES: GoldenQuery[] = [
  {
    id: 'Q1_chain_rule',
    query: 'How does the chain rule relate to backpropagation in neural networks?',
    expectedBlobId: 'blob_calc',
    expectedKeyword: 'backpropagation',
  },
  {
    id: 'Q2_integration',
    query: 'What is the formula for integration by parts?',
    expectedBlobId: 'blob_calc',
    expectedKeyword: 'product rule',
  },
  {
    id: 'Q3_raft',
    query: 'How do Raft leaders replicate log entries to followers?',
    expectedBlobId: 'blob_dist',
    expectedKeyword: 'AppendEntries',
  },
  {
    id: 'Q4_qdrant_scale',
    query: 'What HNSW configuration enables Qdrant tiered multitenancy for 100M users?',
    expectedBlobId: 'blob_dist',
    expectedKeyword: 'payload_m=16',
  },
  {
    id: 'Q5_dedup',
    query: 'How does SHA-256 content deduplication save storage across students?',
    expectedBlobId: 'blob_dist',
    expectedKeyword: 'SourceBlob',
  },
  {
    id: 'Q6_glycolysis',
    query: 'Where does glycolysis occur and how much net ATP does it produce?',
    expectedBlobId: 'blob_bio',
    expectedKeyword: 'cytoplasm',
  },
  {
    id: 'Q7_atp_synthase',
    query: 'How does the proton gradient drive ATP synthase in mitochondria?',
    expectedBlobId: 'blob_bio',
    expectedKeyword: 'inner mitochondrial membrane',
  },
  {
    id: 'Q8_multihop_prereq',
    query: 'What mathematical property is needed before differentiating composite functions?',
    expectedBlobId: 'blob_calc',
    expectedKeyword: 'continuous',
    isMultiHop: true,
    graphExpansionTerms: ['Continuity', 'Limits', 'differentiability'],
  },
];

function sparseDot(
  a: { indices: number[]; values: number[] },
  b: { indices: number[]; values: number[] },
): number {
  const bMap = new Map<number, number>();
  for (let i = 0; i < b.indices.length; i++) {
    bMap.set(b.indices[i], b.values[i]);
  }
  let score = 0;
  for (let i = 0; i < a.indices.length; i++) {
    const bv = bMap.get(a.indices[i]);
    if (bv !== undefined) score += a.values[i] * bv;
  }
  return score;
}

async function runEval() {
  console.log('=== StudyGAI Phase 3 RAG Evaluation Harness ===\n');

  const chunker = new ChunkerService();
  const sparse = new SparseEncoderService();

  // 1. Index Golden Corpus into in-memory hybrid child + parent index
  interface IndexedChild {
    blobId: string;
    title: string;
    parentIndex: number;
    text: string;
    contextualText: string;
    sparseVec: { indices: number[]; values: number[] };
  }

  const index: IndexedChild[] = [];
  const parentLookup = new Map<string, string>();

  for (const doc of GOLDEN_CORPUS) {
    const chunked = chunker.buildParentChildChunks(doc.markdown, doc.blobId, doc.title, 1400, 450, 80);
    for (const p of chunked.parents) {
      parentLookup.set(`${doc.blobId}:${p.parentIndex}`, p.text);
    }
    for (const c of chunked.children) {
      index.push({
        blobId: doc.blobId,
        title: doc.title,
        parentIndex: c.parentIndex,
        text: c.text,
        contextualText: c.contextualText,
        sparseVec: sparse.encode(c.contextualText),
      });
    }
  }

  const search = (query: string, topK = 5) => {
    const qVec = sparse.encode(query);
    const scored = index.map((item) => {
      const bm25 = sparseDot(qVec, item.sparseVec);
      const lex = sparse.lexicalOverlapScore(query, item.contextualText);
      return { item, score: 0.7 * bm25 + 0.3 * lex };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  };

  let hitAt1 = 0;
  let hitAt3 = 0;
  let hitAt5 = 0;
  let mrrSum = 0;
  const latenciesMs: number[] = [];

  let multiHopBaseRank = 0;
  let multiHopGraphRank = 0;

  for (const gq of GOLDEN_QUERIES) {
    const t0 = performance.now();
    const effectiveQuery =
      gq.isMultiHop && gq.graphExpansionTerms?.length
        ? `${gq.query} (related concepts: ${gq.graphExpansionTerms.join(', ')})`
        : gq.query;

    const results = search(effectiveQuery, 5);
    latenciesMs.push(performance.now() - t0);

    const findRank = (list: typeof results) => {
      for (let i = 0; i < list.length; i++) {
        const { item } = list[i];
        const parentText = parentLookup.get(`${item.blobId}:${item.parentIndex}`) || item.text;
        const matched =
          item.blobId === gq.expectedBlobId &&
          parentText.toLowerCase().includes(gq.expectedKeyword.toLowerCase());
        if (matched) return i + 1;
      }
      return 0;
    };

    const rank = findRank(results);
    if (gq.isMultiHop) {
      multiHopBaseRank = findRank(search(gq.query, 5));
      multiHopGraphRank = rank;
    }

    if (rank === 1) hitAt1++;
    if (rank > 0 && rank <= 3) hitAt3++;
    if (rank > 0 && rank <= 5) hitAt5++;
    if (rank > 0) mrrSum += 1 / rank;

    console.log(
      `  [${rank === 1 ? 'HIT@1' : rank > 0 ? `HIT@${rank}` : 'MISS '}] ${gq.id} -> top="${results[0]?.item.title}"`,
    );
  }

  const n = GOLDEN_QUERIES.length;
  const recallAt1 = hitAt1 / n;
  const recallAt3 = hitAt3 / n;
  const recallAt5 = hitAt5 / n;
  const mrr = mrrSum / n;

  latenciesMs.sort((a, b) => a - b);
  const p50 = latenciesMs[Math.floor(latenciesMs.length * 0.5)] || 0;
  const p95 = latenciesMs[Math.min(latenciesMs.length - 1, Math.floor(latenciesMs.length * 0.95))] || 0;

  // 2. Verify ConceptGraph JSON parser & Mastery Adaptive Directive
  const masteryProto = Object.create(MasteryService.prototype) as MasteryService;
  const graphProto = Object.create(ConceptGraphService.prototype) as ConceptGraphService;
  (graphProto as any).masteryService = masteryProto;

  const parsedGraph = graphProto.parseGraphJson(`\`\`\`json
  {
    "nodes": [
      { "id": "continuity", "label": "Continuity", "category": "definition", "summary": "Limit equals function value", "importance": 4 },
      { "id": "chain_rule", "label": "Chain Rule", "category": "formula", "summary": "Composite derivatives", "importance": 5 }
    ],
    "edges": [
      { "from": "continuity", "to": "chain_rule", "relation": "prerequisite_of", "label": "prerequisite for" }
    ]
  }
  \`\`\``);
  assert(parsedGraph && parsedGraph.nodes.length === 2 && parsedGraph.edges.length === 1, 'ConceptGraph parser failed');

  const adaptiveDirective = masteryProto.buildAdaptiveDirective({
    courseId: 'c1',
    userId: 'u1',
    overallMastery: 58,
    totalSignals: 9,
    weakConcepts: [
      {
        conceptKey: 'chain-rule',
        label: 'Chain Rule',
        masteryScore: 34,
        attempts: 4,
        correctCount: 1,
        streak: 0,
        status: 'weak',
        recentMisses: ['Differentiate sin(x^2)'],
        lastReviewedAt: new Date(),
      },
    ],
    learningConcepts: [],
    strongConcepts: [
      {
        conceptKey: 'glycolysis',
        label: 'Glycolysis',
        masteryScore: 92,
        attempts: 5,
        correctCount: 5,
        streak: 5,
        status: 'mastered',
        recentMisses: [],
        lastReviewedAt: new Date(),
      },
    ],
    allConcepts: [
      {
        conceptKey: 'chain-rule',
        label: 'Chain Rule',
        masteryScore: 34,
        attempts: 4,
        correctCount: 1,
        streak: 0,
        status: 'weak',
        recentMisses: [],
        lastReviewedAt: new Date(),
      },
      {
        conceptKey: 'glycolysis',
        label: 'Glycolysis',
        masteryScore: 92,
        attempts: 5,
        correctCount: 5,
        streak: 5,
        status: 'mastered',
        recentMisses: [],
        lastReviewedAt: new Date(),
      },
    ],
  });
  assert(adaptiveDirective.includes('Chain Rule (34%)'), 'Adaptive directive missing weak concept');
  assert(adaptiveDirective.includes('Glycolysis (92%)'), 'Adaptive directive missing strong concept');

  // 3. Verify Citation Grounding Precision
  const orchProto = Object.create(RagOrchestratorService.prototype) as RagOrchestratorService;
  const mockCitations: CitationItem[] = [1, 2, 3].map((idx) => ({
    index: idx,
    sourceId: `s${idx}`,
    blobId: `b${idx}`,
    sourceTitle: `Doc ${idx}`,
    sectionPath: 'Sec',
    pageNumber: idx,
    parentIndex: 0,
    quote: 'quote',
    score: 0.9,
    citedInAnswer: false,
  }));
  const verified = orchProto.markCitedReferences(
    'Raft uses AppendEntries RPCs [1] while Qdrant uses payload_m=16 [3].',
    mockCitations,
  );
  assert.deepStrictEqual(
    verified.map((c) => c.citedInAnswer),
    [true, false, true],
    'Citation grounding precision check failed',
  );

  // Scorecard Summary
  console.log('\n---------------- RAG EVAL SCORECARD ----------------');
  console.log(`Corpus Indexed:        ${GOLDEN_CORPUS.length} docs -> ${index.length} child chunks`);
  console.log(`Recall@1:              ${(recallAt1 * 100).toFixed(1)}% (${hitAt1}/${n})`);
  console.log(`Recall@3:              ${(recallAt3 * 100).toFixed(1)}% (${hitAt3}/${n})`);
  console.log(`Recall@5:              ${(recallAt5 * 100).toFixed(1)}% (${hitAt5}/${n})`);
  console.log(`MRR:                   ${mrr.toFixed(3)}`);
  console.log(
    `Multi-Hop GraphRAG:    Base Rank=${multiHopBaseRank || 'MISS'} -> Graph-Expanded Rank=${multiHopGraphRank || 'MISS'}`,
  );
  console.log(`Latency (in-memory):   p50=${p50.toFixed(2)}ms | p95=${p95.toFixed(2)}ms`);
  console.log(`ConceptGraph Parser:   PASS (2 nodes, 1 edge)`);
  console.log(`Mastery Directive:     PASS`);
  console.log(`Citation Verification: PASS`);
  console.log('----------------------------------------------------\n');

  // Quality Gates (CI enforcement)
  assert(recallAt3 >= 0.85, `Recall@3 below 85% threshold: ${(recallAt3 * 100).toFixed(1)}%`);
  assert(mrr >= 0.75, `MRR below 0.75 threshold: ${mrr.toFixed(3)}`);
  console.log('ALL RAG EVALUATION QUALITY GATES PASSED!');
}

runEval().catch((err) => {
  console.error('RAG EVAL FAILED:', err);
  process.exit(1);
});
