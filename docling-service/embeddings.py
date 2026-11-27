"""
Hybrid Embeddings, Cross-Encoder Reranking & Qdrant Multitenant Manager for StudyGAI.

Supports pluggable profiles via environment variables:
- RAG_PROFILE=cpu (default): FastEmbed ONNX dense (BAAI/bge-small-en-v1.5, 384d) +
  deterministic BM25 sparse + FlashRank / MiniLM cross-encoder reranker.
- RAG_PROFILE=gpu: SentenceTransformers BAAI/bge-m3 (1024d) or external TEI/Infinity
  server (EMBEDDING_SERVER_URL) + BAAI/bge-reranker-v2-m3.

Qdrant 100M-User Production Configuration:
- Named vectors: "dense" (Cosine, on_disk=True, INT8 scalar quantization always_ram=True)
  + "sparse" (IDF-weighted lexical vectors for exact formulas, terms, acronyms, citations).
- Tiered Multitenancy: hnsw_config(m=0, payload_m=16) + is_tenant=True payload index on
  `blob_id` and `course_id`, creating isolated per-source / per-notebook HNSW subgraphs.
- All payload filter keys match top-level payload fields (`blob_id`, `course_id`) — fixing
  the prior broken `payload.course_id` filter bug.
"""

from __future__ import annotations

import hashlib
import logging
import math
import os
import re
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

try:
    import requests
except ImportError:
    requests = None

logger = logging.getLogger(__name__)

# Optional Qdrant client
try:
    from qdrant_client import QdrantClient
    from qdrant_client.models import (
        Distance,
        FieldCondition,
        Filter,
        HnswConfigDiff,
        KeywordIndexParams,
        MatchAny,
        MatchValue,
        Modifier,
        PayloadSchemaType,
        PointStruct,
        ScalarQuantization,
        ScalarQuantizationConfig,
        ScalarType,
        SparseIndexParams,
        SparseVector,
        SparseVectorParams,
        VectorParams,
    )
    QDRANT_SDK_AVAILABLE = True
except ImportError:
    QdrantClient = None
    QDRANT_SDK_AVAILABLE = False

# Optional FastEmbed (lightweight ONNX runtime — great on CPU)
try:
    from fastembed import TextEmbedding, SparseTextEmbedding
    FASTEMBED_AVAILABLE = True
except ImportError:
    TextEmbedding = None
    SparseTextEmbedding = None
    FASTEMBED_AVAILABLE = False

# Optional SentenceTransformers (CPU or GPU)
try:
    from sentence_transformers import SentenceTransformer, CrossEncoder
    SENTENCE_TRANSFORMERS_AVAILABLE = True
except ImportError:
    SentenceTransformer = None
    CrossEncoder = None
    SENTENCE_TRANSFORMERS_AVAILABLE = False

# Optional FlashRank (ultra-fast CPU ONNX cross-encoder reranker)
try:
    from flashrank import Ranker, RerankRequest
    FLASHRANK_AVAILABLE = True
except ImportError:
    Ranker = None
    RerankRequest = None
    FLASHRANK_AVAILABLE = False


TOKEN_RE = re.compile(r"[a-zA-Z0-9_]+|[\u0370-\u03ff]+")
STOPWORDS = {
    "the", "and", "for", "that", "this", "with", "from", "are", "was", "were",
    "have", "has", "had", "not", "but", "what", "which", "who", "when", "where",
    "why", "how", "can", "will", "just", "should", "now", "into", "about", "than",
    "then", "them", "these", "those", "its", "their", "our", "your", "you", "they",
}
SPARSE_VOCAB_SIZE = 262_144  # 2^18 deterministic hash buckets


def hash_sparse_vector(text: str) -> Dict[str, List[Any]]:
    """
    Deterministic, zero-dependency BM25-style TF sparse vector using feature hashing.
    Works identically across Python and TypeScript so hybrid lexical search ALWAYS works
    (especially for formulas, theorem names, acronyms, and exact numbers).
    """
    tokens = [
        t.lower()
        for t in TOKEN_RE.findall(text or "")
        if len(t) > 1 and t.lower() not in STOPWORDS
    ]
    if not tokens:
        return {"indices": [], "values": []}

    counts = Counter(tokens)
    k1 = 1.5
    b = 0.75
    avgdl = 120.0
    dl = float(len(tokens))

    buckets: Dict[int, float] = {}
    for term, tf in counts.items():
        # FNV-1a / sha256 deterministic 32-bit bucket
        digest = hashlib.sha256(term.encode("utf-8")).digest()
        idx = int.from_bytes(digest[:4], "big") % SPARSE_VOCAB_SIZE
        weight = (tf * (k1 + 1.0)) / (tf + k1 * (1.0 - b + b * (dl / avgdl)))
        buckets[idx] = buckets.get(idx, 0.0) + float(weight)

    # Sort indices ascending (required by Qdrant sparse vectors)
    sorted_items = sorted(buckets.items(), key=lambda x: x[0])
    return {
        "indices": [idx for idx, _ in sorted_items],
        "values": [round(val, 5) for _, val in sorted_items],
    }


class EmbeddingsManager:
    """Manages Hybrid Dense + Sparse embeddings, Reranking, and Qdrant multitenant ops."""

    def __init__(self):
        self.qdrant_url = os.getenv("QDRANT_URL", "http://localhost:6333").rstrip("/")
        self.api_key = os.getenv("QDRANT_API_KEY", "")
        self.profile = os.getenv("RAG_PROFILE", "cpu").lower()
        self.collection_name = os.getenv("QDRANT_COLLECTION", "source_chunks")
        self.embedding_server_url = os.getenv("EMBEDDING_SERVER_URL", "").rstrip("/")
        self.reranker_server_url = os.getenv("RERANKER_SERVER_URL", "").rstrip("/")

        default_model = (
            "BAAI/bge-m3" if self.profile == "gpu" else "BAAI/bge-small-en-v1.5"
        )
        self.model_name = os.getenv("EMBEDDING_MODEL", default_model)
        self.reranker_model_name = os.getenv(
            "RERANKER_MODEL",
            "BAAI/bge-reranker-v2-m3" if self.profile == "gpu" else "ms-marco-MiniLM-L-12-v2",
        )
        default_dim = 1024 if "bge-m3" in self.model_name.lower() else 384
        self.vector_size = int(os.getenv("VECTOR_DIM", str(default_dim)))
        self.quantization_mode = os.getenv("QDRANT_QUANTIZATION", "scalar").lower()
        self.sharding_mode = os.getenv("QDRANT_SHARDING_MODE", "auto").lower()
        self.shard_count = max(1, int(os.getenv("QDRANT_SHARD_COUNT", "16")))
        self.replication_factor = max(1, int(os.getenv("QDRANT_REPLICATION_FACTOR", "1")))

        self.dense_backend = "none"
        self.sparse_backend = "hash_bm25"
        self.reranker_backend = "lexical"

        self._fastembed_dense = None
        self._fastembed_sparse = None
        self._st_model = None
        self._flashrank = None
        self._cross_encoder = None
        self.client = None

        self._init_qdrant_client()
        self._init_embedding_models()
        self._init_reranker()

    def _qdrant_headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["api-key"] = self.api_key
        return headers

    def _init_qdrant_client(self) -> None:
        if QDRANT_SDK_AVAILABLE:
            try:
                self.client = QdrantClient(
                    url=self.qdrant_url,
                    api_key=self.api_key if self.api_key else None,
                    timeout=30.0,
                )
                logger.info(f"Initialized Qdrant client at {self.qdrant_url}")
            except Exception as exc:
                logger.warning(f"Qdrant SDK init failed ({exc}); REST fallback active")
                self.client = None

    def _init_embedding_models(self) -> None:
        if self.embedding_server_url:
            self.dense_backend = "external_tei"
            logger.info(f"Using external embedding server: {self.embedding_server_url}")
            return

        if FASTEMBED_AVAILABLE and self.profile != "gpu":
            try:
                self._fastembed_dense = TextEmbedding(model_name=self.model_name)
                # Probe true dimension
                probe = next(iter(self._fastembed_dense.embed(["probe"])))
                self.vector_size = len(probe)
                self.dense_backend = "fastembed"
                logger.info(f"Loaded FastEmbed dense model: {self.model_name} ({self.vector_size}d)")
            except Exception as exc:
                logger.warning(f"FastEmbed dense init failed ({exc}); falling back to SentenceTransformers")

        if self.dense_backend == "none" and SENTENCE_TRANSFORMERS_AVAILABLE:
            try:
                self._st_model = SentenceTransformer(self.model_name)
                self.vector_size = self._st_model.get_sentence_embedding_dimension()
                self.dense_backend = "sentence_transformers"
                logger.info(f"Loaded SentenceTransformer model: {self.model_name} ({self.vector_size}d)")
            except Exception as exc:
                logger.error(f"SentenceTransformer load failed: {exc}")

        if FASTEMBED_AVAILABLE and os.getenv("USE_FASTEMBED_SPARSE", "false").lower() == "true":
            try:
                self._fastembed_sparse = SparseTextEmbedding(model_name="Qdrant/bm25")
                self.sparse_backend = "fastembed_bm25"
                logger.info("Loaded FastEmbed Qdrant/bm25 sparse encoder")
            except Exception as exc:
                logger.warning(f"FastEmbed sparse init failed ({exc}); using deterministic hash_bm25")

    def _init_reranker(self) -> None:
        if self.reranker_server_url:
            self.reranker_backend = "external_reranker"
            return

        if FLASHRANK_AVAILABLE and self.profile != "gpu":
            try:
                self._flashrank = Ranker(model_name=self.reranker_model_name, cache_dir="/tmp/flashrank")
                self.reranker_backend = "flashrank"
                logger.info(f"Loaded FlashRank reranker: {self.reranker_model_name}")
                return
            except Exception as exc:
                logger.warning(f"FlashRank load failed ({exc})")

        if SENTENCE_TRANSFORMERS_AVAILABLE and os.getenv("ENABLE_CROSS_ENCODER", "false").lower() == "true":
            try:
                self._cross_encoder = CrossEncoder(self.reranker_model_name)
                self.reranker_backend = "cross_encoder"
                logger.info(f"Loaded CrossEncoder reranker: {self.reranker_model_name}")
            except Exception as exc:
                logger.warning(f"CrossEncoder load failed ({exc}); using lexical reranker fallback")

    def get_info(self) -> Dict[str, Any]:
        return {
            "profile": self.profile,
            "collection": self.collection_name,
            "dense_backend": self.dense_backend,
            "dense_model": self.model_name,
            "vector_size": self.vector_size,
            "sparse_backend": self.sparse_backend,
            "reranker_backend": self.reranker_backend,
            "reranker_model": self.reranker_model_name,
        }

    def generate_dense_embeddings(self, texts: List[str], batch_size: int = 32) -> List[List[float]]:
        if not texts:
            return []

        if self.dense_backend == "external_tei":
            vectors: List[List[float]] = []
            for i in range(0, len(texts), batch_size):
                batch = texts[i : i + batch_size]
                resp = requests.post(
                    f"{self.embedding_server_url}/embed",
                    json={"inputs": batch, "truncate": True},
                    timeout=60,
                )
                resp.raise_for_status()
                data = resp.json()
                vectors.extend(data)
            return vectors

        if self.dense_backend == "fastembed" and self._fastembed_dense is not None:
            return [vec.tolist() for vec in self._fastembed_dense.embed(texts, batch_size=batch_size)]

        if self.dense_backend == "sentence_transformers" and self._st_model is not None:
            embs = self._st_model.encode(
                texts,
                batch_size=batch_size,
                normalize_embeddings=True,
                convert_to_tensor=False,
                show_progress_bar=False,
            )
            return embs.tolist() if hasattr(embs, "tolist") else list(embs)

        raise RuntimeError(
            "No dense embedding backend available (install fastembed or sentence-transformers, or set EMBEDDING_SERVER_URL)"
        )

    def generate_sparse_embeddings(self, texts: List[str]) -> List[Dict[str, List[Any]]]:
        if not texts:
            return []
        if self.sparse_backend == "fastembed_bm25" and self._fastembed_sparse is not None:
            results = []
            for sp in self._fastembed_sparse.embed(texts):
                results.append(
                    {
                        "indices": [int(i) for i in sp.indices.tolist()],
                        "values": [float(v) for v in sp.values.tolist()],
                    }
                )
            return results
        return [hash_sparse_vector(t) for t in texts]

    def embed_query(self, query: str) -> Dict[str, Any]:
        """Generate both dense + sparse query vectors for hybrid search."""
        dense = self.generate_dense_embeddings([query])[0]
        sparse = self.generate_sparse_embeddings([query])[0]
        return {
            "dense": dense,
            "sparse": sparse,
            "vector_size": len(dense),
            "model": self.model_name,
        }

    def rerank(
        self,
        query: str,
        documents: List[Dict[str, Any]],
        top_k: int = 8,
    ) -> List[Dict[str, Any]]:
        """
        Rerank candidate passages using FlashRank / CrossEncoder / External Reranker,
        with deterministic lexical+prior-score fallback.
        Each document dict should contain `id` and `text` (and optional `score`).
        """
        if not documents:
            return []

        if self.reranker_backend == "external_reranker":
            resp = requests.post(
                f"{self.reranker_server_url}/rerank",
                json={"query": query, "texts": [d.get("text", "") for d in documents], "truncate": True},
                timeout=30,
            )
            resp.raise_for_status()
            ranked = resp.json()
            out = []
            for item in ranked[:top_k]:
                idx = item["index"]
                doc = dict(documents[idx])
                doc["rerank_score"] = float(item["score"])
                out.append(doc)
            return out

        if self.reranker_backend == "flashrank" and self._flashrank is not None:
            passages = [{"id": idx, "text": d.get("text", "")[:2000]} for idx, d in enumerate(documents)]
            req = RerankRequest(query=query, passages=passages)
            ranked = self._flashrank.rerank(req)
            out = []
            for r in ranked[:top_k]:
                doc = dict(documents[int(r["id"])])
                doc["rerank_score"] = float(r["score"])
                out.append(doc)
            return out

        if self.reranker_backend == "cross_encoder" and self._cross_encoder is not None:
            pairs = [(query, d.get("text", "")[:2000]) for d in documents]
            scores = self._cross_encoder.predict(pairs)
            scored = []
            for doc, sc in zip(documents, scores):
                item = dict(doc)
                item["rerank_score"] = float(sc)
                scored.append(item)
            scored.sort(key=lambda x: x["rerank_score"], reverse=True)
            return scored[:top_k]

        # Lightweight lexical overlap + prior RRF score fallback
        q_tokens = set(t.lower() for t in TOKEN_RE.findall(query or "") if len(t) > 1 and t.lower() not in STOPWORDS)
        scored = []
        for doc in documents:
            d_tokens = set(t.lower() for t in TOKEN_RE.findall(doc.get("text", "")))
            overlap = (len(q_tokens & d_tokens) / max(1, len(q_tokens))) if q_tokens else 0.0
            prior = float(doc.get("score", 0.0))
            combined = 0.65 * prior + 0.35 * overlap
            item = dict(doc)
            item["rerank_score"] = round(combined, 6)
            scored.append(item)
        scored.sort(key=lambda x: x["rerank_score"], reverse=True)
        return scored[:top_k]

    def compute_shard_key(self, blob_id: str, shard_count: Optional[int] = None) -> str:
        """
        Deterministic Shard-Key Router — byte-identical to TypeScript QdrantService.computeShardKey.
        Maps any blob_id stably to `shard_00`..`shard_<N-1>`.
        """
        safe_count = max(1, shard_count if shard_count is not None else self.shard_count)
        digest = hashlib.sha256((blob_id or "").encode("utf-8")).digest()
        bucket = int.from_bytes(digest[:4], "big") % safe_count
        return f"shard_{bucket:02d}"

    def compute_shard_keys_for_blobs(self, blob_ids: Optional[List[str]]) -> Optional[List[str]]:
        if self.sharding_mode != "custom" or not blob_ids:
            return None
        return sorted({self.compute_shard_key(bid) for bid in blob_ids})

    def ensure_collection(self, collection_name: Optional[str] = None) -> None:
        """
        Ensure the hybrid multi-tenant Qdrant collection and its payload indexes exist.
        Uses REST API directly for maximum version compatibility with Qdrant 1.9+.
        """
        col = collection_name or self.collection_name
        check = requests.get(
            f"{self.qdrant_url}/collections/{col}",
            headers=self._qdrant_headers(),
            timeout=10,
        )
        if check.status_code == 404:
            quant_cfg: Optional[Dict[str, Any]] = None
            if self.quantization_mode == "binary":
                quant_cfg = {"binary": {"always_ram": True}}
            elif self.quantization_mode == "scalar":
                quant_cfg = {
                    "scalar": {
                        "type": "int8",
                        "quantile": 0.99,
                        "always_ram": True,
                    }
                }

            payload: Dict[str, Any] = {
                "vectors": {
                    "dense": {
                        "size": self.vector_size,
                        "distance": "Cosine",
                        "on_disk": True,
                    }
                },
                "sparse_vectors": {
                    "sparse": {
                        "modifier": "idf",
                    }
                },
                "hnsw_config": {
                    "m": 0,           # Disable global cross-tenant HNSW graph
                    "payload_m": 16,  # Build isolated fast HNSW subgraphs per tenant (blob_id)
                },
            }
            if quant_cfg is not None:
                payload["quantization_config"] = quant_cfg
            if self.sharding_mode == "custom":
                payload["sharding_method"] = "custom"
                payload["replication_factor"] = self.replication_factor

            resp = requests.put(
                f"{self.qdrant_url}/collections/{col}",
                json=payload,
                headers=self._qdrant_headers(),
                timeout=15,
            )
            if resp.status_code not in (200, 201, 409):
                logger.warning(f"Full hybrid collection create failed ({resp.text}); retrying without modifier")
                payload["sparse_vectors"]["sparse"] = {}
                resp = requests.put(
                    f"{self.qdrant_url}/collections/{col}",
                    json=payload,
                    headers=self._qdrant_headers(),
                    timeout=15,
                )
                resp.raise_for_status()

            if self.sharding_mode == "custom":
                for i in range(self.shard_count):
                    shard_key = f"shard_{i:02d}"
                    try:
                        requests.put(
                            f"{self.qdrant_url}/collections/{col}/shards",
                            json={"shard_key": shard_key},
                            headers=self._qdrant_headers(),
                            timeout=10,
                        )
                    except Exception:
                        pass

            logger.info(
                f"Created Qdrant collection '{col}' (dense={self.vector_size}d + sparse + quant={self.quantization_mode} + sharding={self.sharding_mode}({self.shard_count}))"
            )

        # Always ensure explicit payload indexes exist (idempotent in Qdrant)
        indexes = [
            ("blob_id", {"type": "keyword", "is_tenant": True}),
            ("course_id", {"type": "keyword", "is_tenant": True}),
            ("source_type", "keyword"),
            ("page_number", "integer"),
        ]
        for field_name, field_schema in indexes:
            try:
                requests.put(
                    f"{self.qdrant_url}/collections/{col}/index",
                    json={"field_name": field_name, "field_schema": field_schema},
                    headers=self._qdrant_headers(),
                    timeout=10,
                )
            except Exception as exc:
                logger.warning(f"Payload index ensure warning for {field_name}: {exc}")

    def upsert_child_chunks(
        self,
        children: List[Dict[str, Any]],
        blob_id: str,
        source_name: str,
        source_type: str = "pdf",
        course_id: Optional[str] = None,
        collection_name: Optional[str] = None,
        batch_size: int = 64,
    ) -> Dict[str, Any]:
        """
        Embed child chunks (using contextual_text) into Dense + Sparse vectors and upsert
        idempotently into Qdrant in safe batches.
        """
        col = collection_name or self.collection_name
        self.ensure_collection(col)

        if not children:
            return {"status": "success", "chunks_stored": 0, "collection": col}

        texts_to_embed = [c.get("contextual_text") or c["text"] for c in children]
        dense_vectors = self.generate_dense_embeddings(texts_to_embed)
        sparse_vectors = self.generate_sparse_embeddings(texts_to_embed)

        total_upserted = 0
        for i in range(0, len(children), batch_size):
            batch_children = children[i : i + batch_size]
            batch_dense = dense_vectors[i : i + batch_size]
            batch_sparse = sparse_vectors[i : i + batch_size]

            points_payload = []
            for c, d_vec, s_vec in zip(batch_children, batch_dense, batch_sparse):
                vector_obj: Dict[str, Any] = {"dense": d_vec}
                if s_vec.get("indices"):
                    vector_obj["sparse"] = s_vec

                payload = {
                    "blob_id": blob_id,
                    "course_id": course_id or "",
                    "source_name": source_name,
                    "source_type": source_type,
                    "chunk_index": c["child_index"],
                    "parent_index": c["parent_index"],
                    "page_number": c.get("page_number", 1),
                    "section_path": c.get("section_path", "Document"),
                    "text": c["text"],
                    "has_formula": bool(c.get("has_formula", False)),
                    "has_table": bool(c.get("has_table", False)),
                    "token_count": int(c.get("token_count", 0)),
                    "chunk_count": len(children),
                }
                points_payload.append(
                    {
                        "id": c["point_id"],
                        "vector": vector_obj,
                        "payload": payload,
                    }
                )

            upsert_body: Dict[str, Any] = {"points": points_payload}
            if self.sharding_mode == "custom":
                upsert_body["shard_key"] = self.compute_shard_key(blob_id)

            resp = requests.put(
                f"{self.qdrant_url}/collections/{col}/points?wait=true",
                json=upsert_body,
                headers=self._qdrant_headers(),
                timeout=60,
            )
            resp.raise_for_status()
            total_upserted += len(points_payload)

        logger.info(f"Upserted {total_upserted} hybrid points into '{col}' for blob={blob_id}")
        return {
            "status": "success",
            "chunks_stored": total_upserted,
            "collection": col,
            "dense_model": self.model_name,
            "vector_size": self.vector_size,
            "sparse_backend": self.sparse_backend,
        }

    def hybrid_search(
        self,
        query: str,
        blob_ids: Optional[List[str]] = None,
        course_id: Optional[str] = None,
        limit: int = 20,
        rerank_top_k: int = 8,
        collection_name: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Execute Hybrid (Dense + Sparse RRF) search in Qdrant filtered by blob_ids or course_id,
        followed by Cross-Encoder reranking.
        """
        col = collection_name or self.collection_name
        q_emb = self.embed_query(query)

        must_filters: List[Dict[str, Any]] = []
        if blob_ids:
            must_filters.append({"key": "blob_id", "match": {"any": blob_ids}})
        elif course_id:
            must_filters.append({"key": "course_id", "match": {"value": course_id}})

        q_filter = {"must": must_filters} if must_filters else None
        shard_keys = self.compute_shard_keys_for_blobs(blob_ids)
        search_params = (
            {
                "quantization": {
                    "ignore": False,
                    "rescore": True,
                    "oversampling": 3.0 if self.quantization_mode == "binary" else 2.0,
                }
            }
            if self.quantization_mode != "none"
            else None
        )

        # Prefer Qdrant v1.10+ unified Query API with native RRF prefetch
        prefetch = [
            {
                "query": q_emb["dense"],
                "using": "dense",
                "limit": max(limit, 30),
                **({"filter": q_filter} if q_filter else {}),
                **({"params": search_params} if search_params else {}),
            }
        ]
        if q_emb["sparse"].get("indices"):
            prefetch.append(
                {
                    "query": q_emb["sparse"],
                    "using": "sparse",
                    "limit": max(limit, 30),
                    **({"filter": q_filter} if q_filter else {}),
                }
            )

        points: List[Dict[str, Any]] = []
        try:
            resp = requests.post(
                f"{self.qdrant_url}/collections/{col}/points/query",
                json={
                    "prefetch": prefetch,
                    "query": {"fusion": "rrf"},
                    "limit": limit,
                    "with_payload": True,
                    **({"shard_key": shard_keys} if shard_keys else {}),
                },
                headers=self._qdrant_headers(),
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json().get("result", {})
            points = data.get("points", data) if isinstance(data, dict) else data
        except Exception as exc:
            logger.warning(f"Qdrant Query RRF API fallback ({exc}); running dense search")
            resp = requests.post(
                f"{self.qdrant_url}/collections/{col}/points/search",
                json={
                    "vector": {"name": "dense", "vector": q_emb["dense"]},
                    "limit": limit,
                    "with_payload": True,
                    **({"filter": q_filter} if q_filter else {}),
                    **({"params": search_params} if search_params else {}),
                    **({"shard_key": shard_keys} if shard_keys else {}),
                },
                headers=self._qdrant_headers(),
                timeout=15,
            )
            resp.raise_for_status()
            points = resp.json().get("result", [])

        candidates = []
        for p in points:
            pl = p.get("payload") or {}
            candidates.append(
                {
                    "id": p.get("id"),
                    "score": float(p.get("score", 0.0)),
                    "blob_id": pl.get("blob_id", ""),
                    "source_name": pl.get("source_name", "Source"),
                    "source_type": pl.get("source_type", "pdf"),
                    "chunk_index": pl.get("chunk_index", 0),
                    "parent_index": pl.get("parent_index", 0),
                    "page_number": pl.get("page_number", 1),
                    "section_path": pl.get("section_path", "Document"),
                    "text": pl.get("text", ""),
                    "has_formula": pl.get("has_formula", False),
                    "has_table": pl.get("has_table", False),
                }
            )

        if rerank_top_k and candidates:
            return self.rerank(query, candidates, top_k=rerank_top_k)
        return candidates

    def delete_blob_chunks(self, blob_id: str, collection_name: Optional[str] = None) -> None:
        col = collection_name or self.collection_name
        delete_body: Dict[str, Any] = {
            "filter": {"must": [{"key": "blob_id", "match": {"value": blob_id}}]}
        }
        if self.sharding_mode == "custom":
            delete_body["shard_key"] = self.compute_shard_key(blob_id)

        resp = requests.post(
            f"{self.qdrant_url}/collections/{col}/points/delete?wait=true",
            json=delete_body,
            headers=self._qdrant_headers(),
            timeout=15,
        )
        resp.raise_for_status()
        logger.info(f"Deleted Qdrant chunks for blob={blob_id}")


_embeddings_manager: Optional[EmbeddingsManager] = None


def get_embeddings_manager() -> EmbeddingsManager:
    global _embeddings_manager
    if _embeddings_manager is None:
        _embeddings_manager = EmbeddingsManager()
    return _embeddings_manager
