import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

export interface SparseVector {
  indices: number[];
  values: number[];
}

const TOKEN_RE = /[a-zA-Z0-9_]+|[\u0370-\u03ff]+/g;
const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was', 'were',
  'have', 'has', 'had', 'not', 'but', 'what', 'which', 'who', 'when', 'where',
  'why', 'how', 'can', 'will', 'just', 'should', 'now', 'into', 'about', 'than',
  'then', 'them', 'these', 'those', 'its', 'their', 'our', 'your', 'you', 'they',
]);
const SPARSE_VOCAB_SIZE = 262_144; // Matches Python embeddings.py SPARSE_VOCAB_SIZE

/**
 * Deterministic BM25-style feature-hashing sparse vector encoder.
 * Produces the exact same bucket indices as `docling-service/embeddings.py` so
 * Node.js fallback ingestion and NestJS hybrid search stay 100% compatible with
 * vectors written by the Python worker.
 */
@Injectable()
export class SparseEncoderService {
  encode(text: string): SparseVector {
    const matches = (text || '').match(TOKEN_RE) || [];
    const tokens = matches
      .map((t) => t.toLowerCase())
      .filter((t) => t.length > 1 && !STOPWORDS.has(t));

    if (tokens.length === 0) {
      return { indices: [], values: [] };
    }

    const counts = new Map<string, number>();
    for (const t of tokens) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }

    const k1 = 1.5;
    const b = 0.75;
    const avgdl = 120.0;
    const dl = tokens.length;

    const buckets = new Map<number, number>();
    for (const [term, tf] of counts.entries()) {
      const digest = crypto.createHash('sha256').update(term, 'utf8').digest();
      const idx = digest.readUInt32BE(0) % SPARSE_VOCAB_SIZE;
      const weight = (tf * (k1 + 1.0)) / (tf + k1 * (1.0 - b + b * (dl / avgdl)));
      buckets.set(idx, (buckets.get(idx) || 0) + weight);
    }

    const sorted = Array.from(buckets.entries()).sort((a, bEntry) => a[0] - bEntry[0]);
    return {
      indices: sorted.map(([idx]) => idx),
      values: sorted.map(([, val]) => Number(val.toFixed(5))),
    };
  }

  /** Lexical overlap score in [0, 1] used as a lightweight rerank fallback */
  lexicalOverlapScore(query: string, doc: string): number {
    const qMatches = (query || '').match(TOKEN_RE) || [];
    const qTokens = new Set(
      qMatches.map((t) => t.toLowerCase()).filter((t) => t.length > 1 && !STOPWORDS.has(t)),
    );
    if (qTokens.size === 0) return 0;

    const dMatches = (doc || '').match(TOKEN_RE) || [];
    const dTokens = new Set(dMatches.map((t) => t.toLowerCase()));
    let hits = 0;
    for (const qt of qTokens) {
      if (dTokens.has(qt)) hits += 1;
    }
    return hits / qTokens.size;
  }
}
