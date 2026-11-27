"""
StudyGAI RAG Document Processing, Hybrid Embedding & Reranking Microservice.

Endpoints:
- GET  /health           -> Service health + capabilities
- GET  /info             -> Active embedding/reranker/parser profile
- POST /ingest/file      -> Single-pass parse + parent-child chunk + hybrid embed + Qdrant upsert
- POST /ingest/url       -> SSRF-safe web scraping + chunk + hybrid embed + Qdrant upsert
- POST /ingest/youtube   -> Timestamped YouTube transcript + chunk + hybrid embed + Qdrant upsert
- POST /ingest/text      -> Raw notes / extracted text + chunk + hybrid embed + Qdrant upsert
- POST /embed/query      -> Dense + Sparse query embeddings (called by NestJS & cached in Redis)
- POST /rerank           -> Cross-encoder reranking of candidate passages
- POST /search/hybrid    -> Full Hybrid RRF + Rerank search endpoint
- DELETE /blobs/{blob_id}-> Remove all vectors for a deduplicated blob

Legacy compatibility endpoints preserved:
- POST /convert-pdf, /convert-docx, /convert-image, /embed-pdf
"""

from __future__ import annotations

import logging
import os
import tempfile
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, Query, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from chunker import build_parent_child_chunks
from embeddings import get_embeddings_manager
from parsers import (
    get_capabilities,
    parse_file,
    parse_image_ocr,
    parse_web_url,
    parse_youtube_transcript,
)

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("studygai-rag-worker")

app = FastAPI(title="StudyGAI RAG Worker", version="3.0.0")

try:
    embeddings_mgr = get_embeddings_manager()
    try:
        embeddings_mgr.ensure_collection()
    except Exception as q_exc:
        logger.warning(f"Qdrant not reachable at startup ({q_exc}); will ensure collection on first write.")
except Exception as exc:
    logger.error(f"Embeddings manager initialization error: {exc}", exc_info=True)
    embeddings_mgr = None


# -------------------- Request Schemas --------------------

class IngestUrlRequest(BaseModel):
    url: str
    blob_id: str
    course_id: Optional[str] = None
    source_name: Optional[str] = None


class IngestYoutubeRequest(BaseModel):
    url: str
    blob_id: str
    course_id: Optional[str] = None
    languages: Optional[List[str]] = None


class IngestTextRequest(BaseModel):
    text: str
    blob_id: str
    source_name: str = "Note"
    source_type: str = "note"
    course_id: Optional[str] = None


class EmbedQueryRequest(BaseModel):
    query: str


class RerankCandidate(BaseModel):
    id: Any
    text: str
    score: float = 0.0


class RerankRequestBody(BaseModel):
    query: str
    documents: List[RerankCandidate]
    top_k: int = Field(default=8, ge=1, le=50)


class HybridSearchRequest(BaseModel):
    query: str
    blob_ids: Optional[List[str]] = None
    course_id: Optional[str] = None
    limit: int = Field(default=24, ge=1, le=100)
    rerank_top_k: int = Field(default=8, ge=1, le=30)


# -------------------- Helpers --------------------

async def _save_tmp(file: UploadFile) -> str:
    suffix = os.path.splitext(file.filename or "")[1] or ".bin"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
        contents = await file.read()
        f.write(contents)
        return f.name


def _index_markdown(
    markdown: str,
    blob_id: str,
    source_name: str,
    source_type: str,
    course_id: Optional[str] = None,
) -> Dict[str, Any]:
    chunked = build_parent_child_chunks(
        markdown=markdown,
        blob_id=blob_id,
        source_name=source_name,
    )
    embedding_stats: Dict[str, Any] = {"status": "skipped", "chunks_stored": 0}
    if embeddings_mgr is not None and chunked["children"]:
        embedding_stats = embeddings_mgr.upsert_child_chunks(
            children=chunked["children"],
            blob_id=blob_id,
            source_name=source_name,
            source_type=source_type,
            course_id=course_id,
        )
    return {
        "toc": chunked["toc"],
        "parents": chunked["parents"],
        "child_count": len(chunked["children"]),
        "parent_count": len(chunked["parents"]),
        "token_estimate": chunked["token_estimate"],
        "embedding_stats": embedding_stats,
    }


# -------------------- Health & Info --------------------

@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "service": "studygai-rag-worker",
        "version": "3.0.0",
        "embeddings_ready": embeddings_mgr is not None and embeddings_mgr.dense_backend != "none",
        "capabilities": get_capabilities(),
    }


@app.get("/info")
async def service_info():
    return {
        "service": "studygai-rag-worker",
        "version": "3.0.0",
        "capabilities": get_capabilities(),
        "embeddings": embeddings_mgr.get_info() if embeddings_mgr else None,
    }


# -------------------- Unified Single-Pass Ingestion --------------------

@app.post("/ingest/file")
async def ingest_file(
    file: UploadFile = File(...),
    blob_id: str = Query(...),
    course_id: Optional[str] = Query(None),
    source_name: Optional[str] = Query(None),
    source_type: str = Query("pdf"),
    mode: str = Query("auto"),
):
    tmp = None
    try:
        tmp = await _save_tmp(file)
        name = source_name or file.filename or "Document"
        parsed = parse_file(tmp, filename=name, mode=mode)
        markdown = parsed["markdown"]

        # Append formula/image summaries when extracted by Docling
        if parsed.get("formulas"):
            formula_lines = ["\n\n### Extracted Mathematical Formulas"]
            for i, f in enumerate(parsed["formulas"][:50], start=1):
                formula_lines.append(f"- Formula {i}: $${f.get('latex', '')}$$")
            markdown += "\n".join(formula_lines)

        indexed = _index_markdown(
            markdown=markdown,
            blob_id=blob_id,
            source_name=name,
            source_type=source_type,
            course_id=course_id,
        )
        return JSONResponse(
            {
                "status": "success",
                "blob_id": blob_id,
                "filename": name,
                "markdown": markdown,
                "char_count": len(markdown),
                "page_count": parsed.get("page_count", 1),
                "extraction_method": parsed.get("extraction_method", "unknown"),
                "metadata": parsed.get("metadata", {}),
                "toc": indexed["toc"],
                "parents": indexed["parents"],
                "child_count": indexed["child_count"],
                "parent_count": indexed["parent_count"],
                "token_estimate": indexed["token_estimate"],
                "embedding_stats": indexed["embedding_stats"],
            }
        )
    except Exception as exc:
        logger.error(f"/ingest/file error: {exc}", exc_info=True)
        return JSONResponse({"status": "error", "error": str(exc)}, status_code=500)
    finally:
        if tmp and os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass


@app.post("/ingest/url")
async def ingest_url(body: IngestUrlRequest):
    try:
        parsed = parse_web_url(body.url)
        name = body.source_name or parsed.get("title") or body.url
        indexed = _index_markdown(
            markdown=parsed["markdown"],
            blob_id=body.blob_id,
            source_name=name,
            source_type="url",
            course_id=body.course_id,
        )
        return JSONResponse(
            {
                "status": "success",
                "blob_id": body.blob_id,
                "title": name,
                "url": parsed.get("url", body.url),
                "markdown": parsed["markdown"],
                "char_count": parsed["char_count"],
                "page_count": parsed["page_count"],
                "extraction_method": parsed["extraction_method"],
                "toc": indexed["toc"],
                "parents": indexed["parents"],
                "child_count": indexed["child_count"],
                "parent_count": indexed["parent_count"],
                "token_estimate": indexed["token_estimate"],
                "embedding_stats": indexed["embedding_stats"],
            }
        )
    except ValueError as exc:
        return JSONResponse({"status": "error", "error": str(exc)}, status_code=400)
    except Exception as exc:
        logger.error(f"/ingest/url error: {exc}", exc_info=True)
        return JSONResponse({"status": "error", "error": str(exc)}, status_code=500)


@app.post("/ingest/youtube")
async def ingest_youtube(body: IngestYoutubeRequest):
    try:
        parsed = parse_youtube_transcript(body.url, languages=body.languages)
        name = parsed.get("title") or body.url
        indexed = _index_markdown(
            markdown=parsed["markdown"],
            blob_id=body.blob_id,
            source_name=name,
            source_type="youtube",
            course_id=body.course_id,
        )
        return JSONResponse(
            {
                "status": "success",
                "blob_id": body.blob_id,
                "video_id": parsed.get("video_id"),
                "title": name,
                "markdown": parsed["markdown"],
                "char_count": parsed["char_count"],
                "page_count": parsed["page_count"],
                "extraction_method": parsed["extraction_method"],
                "toc": indexed["toc"],
                "parents": indexed["parents"],
                "child_count": indexed["child_count"],
                "parent_count": indexed["parent_count"],
                "token_estimate": indexed["token_estimate"],
                "embedding_stats": indexed["embedding_stats"],
            }
        )
    except ValueError as exc:
        return JSONResponse({"status": "error", "error": str(exc)}, status_code=400)
    except Exception as exc:
        logger.error(f"/ingest/youtube error: {exc}", exc_info=True)
        return JSONResponse({"status": "error", "error": str(exc)}, status_code=500)


@app.post("/ingest/text")
async def ingest_text(body: IngestTextRequest):
    try:
        markdown = body.text.strip()
        if not markdown:
            return JSONResponse({"status": "error", "error": "Text content cannot be empty"}, status_code=400)
        if "<!-- PAGE" not in markdown:
            markdown = f"<!-- PAGE 1 -->\n{markdown}"
        indexed = _index_markdown(
            markdown=markdown,
            blob_id=body.blob_id,
            source_name=body.source_name,
            source_type=body.source_type,
            course_id=body.course_id,
        )
        return JSONResponse(
            {
                "status": "success",
                "blob_id": body.blob_id,
                "markdown": markdown,
                "char_count": len(markdown),
                "page_count": 1,
                "extraction_method": "direct_text",
                "toc": indexed["toc"],
                "parents": indexed["parents"],
                "child_count": indexed["child_count"],
                "parent_count": indexed["parent_count"],
                "token_estimate": indexed["token_estimate"],
                "embedding_stats": indexed["embedding_stats"],
            }
        )
    except Exception as exc:
        logger.error(f"/ingest/text error: {exc}", exc_info=True)
        return JSONResponse({"status": "error", "error": str(exc)}, status_code=500)


# -------------------- Query Embedding, Rerank & Hybrid Search --------------------

@app.post("/embed/query")
async def embed_query(body: EmbedQueryRequest):
    if embeddings_mgr is None:
        return JSONResponse({"status": "error", "error": "Embeddings manager unavailable"}, status_code=503)
    try:
        data = embeddings_mgr.embed_query(body.query)
        return JSONResponse({"status": "success", **data})
    except Exception as exc:
        logger.error(f"/embed/query error: {exc}")
        return JSONResponse({"status": "error", "error": str(exc)}, status_code=500)


@app.post("/rerank")
async def rerank_passages(body: RerankRequestBody):
    if embeddings_mgr is None:
        return JSONResponse({"status": "error", "error": "Reranker unavailable"}, status_code=503)
    try:
        docs = [d.model_dump() for d in body.documents]
        ranked = embeddings_mgr.rerank(body.query, docs, top_k=body.top_k)
        return JSONResponse({"status": "success", "results": ranked})
    except Exception as exc:
        logger.error(f"/rerank error: {exc}")
        return JSONResponse({"status": "error", "error": str(exc)}, status_code=500)


@app.post("/search/hybrid")
async def search_hybrid(body: HybridSearchRequest):
    if embeddings_mgr is None:
        return JSONResponse({"status": "error", "error": "Search unavailable"}, status_code=503)
    try:
        results = embeddings_mgr.hybrid_search(
            query=body.query,
            blob_ids=body.blob_ids,
            course_id=body.course_id,
            limit=body.limit,
            rerank_top_k=body.rerank_top_k,
        )
        return JSONResponse({"status": "success", "count": len(results), "results": results})
    except Exception as exc:
        logger.error(f"/search/hybrid error: {exc}")
        return JSONResponse({"status": "error", "error": str(exc)}, status_code=500)


@app.delete("/blobs/{blob_id}")
async def delete_blob(blob_id: str):
    if embeddings_mgr is None:
        return JSONResponse({"status": "error", "error": "Embeddings manager unavailable"}, status_code=503)
    try:
        embeddings_mgr.delete_blob_chunks(blob_id)
        return JSONResponse({"status": "success", "blob_id": blob_id})
    except Exception as exc:
        return JSONResponse({"status": "error", "error": str(exc)}, status_code=500)


# -------------------- Legacy Endpoints (Backward Compatibility) --------------------

@app.post("/convert-pdf")
@app.post("/convert-docx")
async def convert_document_legacy(file: UploadFile = File(...)):
    tmp = None
    try:
        tmp = await _save_tmp(file)
        parsed = parse_file(tmp, filename=file.filename or "document.pdf", mode="auto")
        return JSONResponse(
            {
                "status": "success",
                "filename": file.filename,
                "markdown": parsed["markdown"],
                "char_count": parsed["char_count"],
                "page_count": parsed["page_count"],
                "extraction_method": parsed["extraction_method"],
                "metadata": parsed.get("metadata", {}),
            }
        )
    except Exception as exc:
        return JSONResponse({"status": "error", "error": str(exc)}, status_code=500)
    finally:
        if tmp and os.path.exists(tmp):
            os.unlink(tmp)


@app.post("/convert-image")
async def convert_image_legacy(file: UploadFile = File(...)):
    tmp = None
    try:
        tmp = await _save_tmp(file)
        parsed = parse_image_ocr(tmp)
        return JSONResponse(
            {
                "status": "success",
                "filename": file.filename,
                "markdown": parsed["markdown"],
                "char_count": parsed["char_count"],
                "page_count": 1,
                "extraction_method": parsed["extraction_method"],
            }
        )
    except Exception as exc:
        return JSONResponse({"status": "error", "error": str(exc)}, status_code=500)
    finally:
        if tmp and os.path.exists(tmp):
            os.unlink(tmp)


@app.post("/embed-pdf")
async def embed_pdf_legacy(file: UploadFile = File(...), course_id: str = Query(None)):
    if not course_id:
        return JSONResponse({"status": "error", "error": "course_id is required"}, status_code=400)
    return await ingest_file(file=file, blob_id=course_id, course_id=course_id, source_name=file.filename)


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "5000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
