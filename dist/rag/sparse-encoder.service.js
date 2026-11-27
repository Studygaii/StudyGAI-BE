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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SparseEncoderService = void 0;
const common_1 = require("@nestjs/common");
const crypto = __importStar(require("crypto"));
const TOKEN_RE = /[a-zA-Z0-9_]+|[\u0370-\u03ff]+/g;
const STOPWORDS = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was', 'were',
    'have', 'has', 'had', 'not', 'but', 'what', 'which', 'who', 'when', 'where',
    'why', 'how', 'can', 'will', 'just', 'should', 'now', 'into', 'about', 'than',
    'then', 'them', 'these', 'those', 'its', 'their', 'our', 'your', 'you', 'they',
]);
const SPARSE_VOCAB_SIZE = 262144; // Matches Python embeddings.py SPARSE_VOCAB_SIZE
/**
 * Deterministic BM25-style feature-hashing sparse vector encoder.
 * Produces the exact same bucket indices as `docling-service/embeddings.py` so
 * Node.js fallback ingestion and NestJS hybrid search stay 100% compatible with
 * vectors written by the Python worker.
 */
let SparseEncoderService = class SparseEncoderService {
    encode(text) {
        const matches = (text || '').match(TOKEN_RE) || [];
        const tokens = matches
            .map((t) => t.toLowerCase())
            .filter((t) => t.length > 1 && !STOPWORDS.has(t));
        if (tokens.length === 0) {
            return { indices: [], values: [] };
        }
        const counts = new Map();
        for (const t of tokens) {
            counts.set(t, (counts.get(t) || 0) + 1);
        }
        const k1 = 1.5;
        const b = 0.75;
        const avgdl = 120.0;
        const dl = tokens.length;
        const buckets = new Map();
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
    lexicalOverlapScore(query, doc) {
        const qMatches = (query || '').match(TOKEN_RE) || [];
        const qTokens = new Set(qMatches.map((t) => t.toLowerCase()).filter((t) => t.length > 1 && !STOPWORDS.has(t)));
        if (qTokens.size === 0)
            return 0;
        const dMatches = (doc || '').match(TOKEN_RE) || [];
        const dTokens = new Set(dMatches.map((t) => t.toLowerCase()));
        let hits = 0;
        for (const qt of qTokens) {
            if (dTokens.has(qt))
                hits += 1;
        }
        return hits / qTokens.size;
    }
};
exports.SparseEncoderService = SparseEncoderService;
exports.SparseEncoderService = SparseEncoderService = __decorate([
    (0, common_1.Injectable)()
], SparseEncoderService);
//# sourceMappingURL=sparse-encoder.service.js.map