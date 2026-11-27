"""
Tiered Multi-Source Document, Web, Image & YouTube Parser for StudyGAI.

Design for 100M-User Cost & Latency Efficiency:
- Singleton lazy-initialized Docling DocumentConverter (never reloaded per request!).
- Fast-path CPU parser (pypdfium2 / pypdf) handles ~80% of clean digital PDFs in milliseconds
  with exact `<!-- PAGE N -->` markers for pinpoint citations.
- Automatic escalation to Docling for scanned/low-text-density PDFs, DOCX, PPTX, or
  when `mode="accurate"` is requested.
- Image OCR via RapidOCR / PaddleOCR (when installed) with pytesseract fallback.
- SSRF-protected Web URL scraping via trafilatura (fast static HTML -> clean Markdown)
  with graceful BeautifulSoup/regex fallback.
- YouTube transcript extraction with `[MM:SS]` timestamp markers for timestamped citations.
"""

from __future__ import annotations

import ipaddress
import logging
import os
import re
import socket
import threading
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlparse

import requests

logger = logging.getLogger(__name__)

# Optional libraries (gracefully detected so worker runs in both lightweight CPU and full GPU images)
try:
    import pypdfium2 as pdfium
    PYPDFIUM_AVAILABLE = True
except ImportError:
    pdfium = None
    PYPDFIUM_AVAILABLE = False

try:
    from docling.document_converter import DocumentConverter
    DOCLING_AVAILABLE = True
except ImportError:
    DocumentConverter = None
    DOCLING_AVAILABLE = False

try:
    from rapidocr_onnxruntime import RapidOCR
    RAPIDOCR_AVAILABLE = True
except ImportError:
    RapidOCR = None
    RAPIDOCR_AVAILABLE = False

try:
    import pytesseract
    from PIL import Image
    TESSERACT_AVAILABLE = True
except ImportError:
    pytesseract = None
    Image = None
    TESSERACT_AVAILABLE = False

try:
    import trafilatura
    TRAFILATURA_AVAILABLE = True
except ImportError:
    trafilatura = None
    TRAFILATURA_AVAILABLE = False

try:
    from youtube_transcript_api import YouTubeTranscriptApi
    YOUTUBE_AVAILABLE = True
except ImportError:
    YouTubeTranscriptApi = None
    YOUTUBE_AVAILABLE = False

try:
    import docx as python_docx
    PYTHON_DOCX_AVAILABLE = True
except ImportError:
    python_docx = None
    PYTHON_DOCX_AVAILABLE = False

try:
    from pptx import Presentation
    PYTHON_PPTX_AVAILABLE = True
except ImportError:
    Presentation = None
    PYTHON_PPTX_AVAILABLE = False


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
TEXT_EXTENSIONS = {".txt", ".md", ".markdown", ".csv", ".json"}

_converter_lock = threading.Lock()
_docling_converter = None
_rapidocr_engine = None


def get_docling_converter():
    """Singleton DocumentConverter to avoid reloading heavy ML models on every request."""
    global _docling_converter
    if not DOCLING_AVAILABLE:
        return None
    if _docling_converter is None:
        with _converter_lock:
            if _docling_converter is None:
                logger.info("Initializing singleton Docling DocumentConverter...")
                _docling_converter = DocumentConverter()
                logger.info("Docling DocumentConverter ready")
    return _docling_converter


def get_rapidocr():
    """Singleton RapidOCR (ONNX-based PaddleOCR, fast & accurate on CPU)."""
    global _rapidocr_engine
    if not RAPIDOCR_AVAILABLE:
        return None
    if _rapidocr_engine is None:
        with _converter_lock:
            if _rapidocr_engine is None:
                _rapidocr_engine = RapidOCR()
    return _rapidocr_engine


def get_capabilities() -> Dict[str, bool]:
    return {
        "pypdfium2_fast_pdf": PYPDFIUM_AVAILABLE,
        "docling": DOCLING_AVAILABLE,
        "rapidocr": RAPIDOCR_AVAILABLE,
        "tesseract_ocr": TESSERACT_AVAILABLE,
        "trafilatura_web": TRAFILATURA_AVAILABLE,
        "youtube_transcript": YOUTUBE_AVAILABLE,
        "docx": PYTHON_DOCX_AVAILABLE or DOCLING_AVAILABLE,
        "pptx": PYTHON_PPTX_AVAILABLE or DOCLING_AVAILABLE,
    }


def _fast_parse_pdf_pypdfium(filepath: str) -> Optional[Dict[str, Any]]:
    """Fast CPU PDF extraction via pypdfium2 with per-page citation markers."""
    if not PYPDFIUM_AVAILABLE:
        return None
    pdf = pdfium.PdfDocument(filepath)
    page_count = len(pdf)
    pages_md: List[str] = []
    total_chars = 0

    for idx in range(page_count):
        page = pdf[idx]
        textpage = page.get_textpage()
        page_text = (textpage.get_text_bounded() or "").strip()
        textpage.close()
        page.close()
        total_chars += len(page_text)
        pages_md.append(f"<!-- PAGE {idx + 1} -->\n{page_text}")

    pdf.close()
    markdown = "\n\n".join(pages_md).strip()
    avg_chars_per_page = total_chars / max(1, page_count)
    return {
        "status": "success",
        "markdown": markdown,
        "char_count": len(markdown),
        "page_count": page_count,
        "avg_chars_per_page": avg_chars_per_page,
        "formulas": [],
        "images": [],
        "metadata": {"page_count": page_count},
        "extraction_method": "pypdfium2_fast",
    }


def _extract_formulas_and_images(doc: Any) -> Dict[str, Any]:
    formulas: List[Dict[str, Any]] = []
    images: List[Dict[str, Any]] = []
    try:
        if hasattr(doc, "document") and hasattr(doc.document, "blocks"):
            for block_idx, block in enumerate(doc.document.blocks):
                if hasattr(block, "children"):
                    for child in block.children:
                        if hasattr(child, "type") and "math" in str(child.type).lower():
                            formulas.append(
                                {
                                    "block_index": block_idx,
                                    "latex": str(child),
                                    "type": "inline" if "inline" in str(child.type).lower() else "display",
                                }
                            )
                if hasattr(block, "type") and "image" in str(block.type).lower():
                    images.append(
                        {
                            "block_index": block_idx,
                            "description": getattr(block, "alt_text", "Image"),
                            "caption": getattr(block, "caption", ""),
                            "id": f"img_{block_idx}",
                        }
                    )
    except Exception as exc:
        logger.warning(f"Formula/image metadata extraction warning: {exc}")
    return {"formulas": formulas, "images": images}


def parse_with_docling(filepath: str) -> Dict[str, Any]:
    converter = get_docling_converter()
    if converter is None:
        raise RuntimeError("Docling library not installed")

    doc = converter.convert(filepath)
    markdown = (
        doc.document.export_to_markdown()
        if hasattr(doc.document, "export_to_markdown")
        else str(doc.document)
    )
    fi = _extract_formulas_and_images(doc)
    page_count = len(doc.pages) if hasattr(doc, "pages") else 1

    return {
        "status": "success",
        "markdown": markdown,
        "char_count": len(markdown),
        "page_count": page_count,
        "formulas": fi["formulas"],
        "images": fi["images"],
        "metadata": {
            "title": getattr(doc.document, "title", None),
            "page_count": page_count,
        },
        "extraction_method": "docling",
    }


def parse_image_ocr(filepath: str) -> Dict[str, Any]:
    """Extract text from images using RapidOCR (preferred) or pytesseract fallback."""
    if RAPIDOCR_AVAILABLE:
        engine = get_rapidocr()
        result, _ = engine(filepath)
        lines = [item[1] for item in (result or []) if len(item) >= 2 and item[1]]
        text = "\n".join(lines).strip()
        return {
            "status": "success",
            "markdown": f"<!-- PAGE 1 -->\n{text}" if text else "<!-- PAGE 1 -->\nNo text detected in image.",
            "char_count": len(text),
            "page_count": 1,
            "formulas": [],
            "images": [],
            "metadata": {"page_count": 1},
            "extraction_method": "rapidocr",
        }

    if TESSERACT_AVAILABLE:
        img = Image.open(filepath)
        text = (pytesseract.image_to_string(img) or "").strip()
        return {
            "status": "success",
            "markdown": f"<!-- PAGE 1 -->\n{text}" if text else "<!-- PAGE 1 -->\nNo text detected in image.",
            "char_count": len(text),
            "page_count": 1,
            "formulas": [],
            "images": [],
            "metadata": {"page_count": 1},
            "extraction_method": "pytesseract_ocr",
        }

    raise RuntimeError("No OCR backend installed (install rapidocr-onnxruntime or pytesseract + Tesseract)")


def _parse_docx_fast(filepath: str) -> Optional[Dict[str, Any]]:
    if not PYTHON_DOCX_AVAILABLE:
        return None
    doc = python_docx.Document(filepath)
    parts: List[str] = ["<!-- PAGE 1 -->"]
    for p in doc.paragraphs:
        txt = p.text.strip()
        if not txt:
            continue
        style = (p.style.name or "").lower() if p.style else ""
        if "heading 1" in style:
            parts.append(f"# {txt}")
        elif "heading 2" in style:
            parts.append(f"## {txt}")
        elif "heading 3" in style:
            parts.append(f"### {txt}")
        else:
            parts.append(txt)
    for table in doc.tables:
        rows = []
        for row in table.rows:
            rows.append("| " + " | ".join(cell.text.strip().replace("\n", " ") for cell in row.cells) + " |")
        if rows:
            sep = "| " + " | ".join("---" for _ in table.rows[0].cells) + " |"
            rows.insert(1, sep)
            parts.append("\n".join(rows))
    markdown = "\n\n".join(parts).strip()
    return {
        "status": "success",
        "markdown": markdown,
        "char_count": len(markdown),
        "page_count": 1,
        "formulas": [],
        "images": [],
        "metadata": {"page_count": 1},
        "extraction_method": "python_docx",
    }


def _parse_pptx_fast(filepath: str) -> Optional[Dict[str, Any]]:
    if not PYTHON_PPTX_AVAILABLE:
        return None
    prs = Presentation(filepath)
    slides_md: List[str] = []
    for idx, slide in enumerate(prs.slides, start=1):
        lines = [f"<!-- PAGE {idx} -->", f"## Slide {idx}"]
        for shape in slide.shapes:
            if hasattr(shape, "text") and shape.text and shape.text.strip():
                lines.append(shape.text.strip())
        slides_md.append("\n\n".join(lines))
    markdown = "\n\n".join(slides_md).strip()
    return {
        "status": "success",
        "markdown": markdown,
        "char_count": len(markdown),
        "page_count": len(prs.slides),
        "formulas": [],
        "images": [],
        "metadata": {"page_count": len(prs.slides)},
        "extraction_method": "python_pptx",
    }


def parse_file(filepath: str, filename: str = "", mode: str = "auto") -> Dict[str, Any]:
    """
    Unified tiered parser:
    - mode="auto": fast CPU path first, escalates to Docling only when needed.
    - mode="accurate": prefers Docling when available.
    """
    ext = os.path.splitext(filename or filepath)[1].lower()

    if ext in TEXT_EXTENSIONS:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            raw = f.read().strip()
        markdown = f"<!-- PAGE 1 -->\n{raw}"
        return {
            "status": "success",
            "markdown": markdown,
            "char_count": len(markdown),
            "page_count": 1,
            "formulas": [],
            "images": [],
            "metadata": {"page_count": 1},
            "extraction_method": "plain_text",
        }

    if ext in IMAGE_EXTENSIONS:
        return parse_image_ocr(filepath)

    if ext == ".pdf":
        if mode != "accurate" and PYPDFIUM_AVAILABLE:
            fast = _fast_parse_pdf_pypdfium(filepath)
            # If digital PDF has healthy text density (>= 80 chars/page), use fast path!
            if fast and fast["avg_chars_per_page"] >= 80:
                return fast
            logger.info(
                f"Low text density ({fast['avg_chars_per_page'] if fast else 0:.1f} chars/page) "
                f"in {filename}; escalating to Docling"
            )

        if DOCLING_AVAILABLE:
            try:
                return parse_with_docling(filepath)
            except Exception as exc:
                logger.warning(f"Docling PDF parse failed ({exc}); falling back to pypdfium2")

        if PYPDFIUM_AVAILABLE:
            fast = _fast_parse_pdf_pypdfium(filepath)
            if fast:
                return fast
        raise RuntimeError("No PDF parser available (install pypdfium2 or docling)")

    if ext in {".docx", ".doc", ".docm"}:
        if mode == "accurate" and DOCLING_AVAILABLE:
            try:
                return parse_with_docling(filepath)
            except Exception as exc:
                logger.warning(f"Docling DOCX failed ({exc}); falling back to python-docx")
        fast = _parse_docx_fast(filepath)
        if fast:
            return fast
        if DOCLING_AVAILABLE:
            return parse_with_docling(filepath)
        raise RuntimeError("No DOCX parser available")

    if ext in {".pptx", ".ppt"}:
        fast = _parse_pptx_fast(filepath)
        if fast:
            return fast
        if DOCLING_AVAILABLE:
            return parse_with_docling(filepath)
        raise RuntimeError("No PPTX parser available")

    if DOCLING_AVAILABLE:
        return parse_with_docling(filepath)

    raise RuntimeError(f"Unsupported file extension: {ext}")


def _validate_public_url(url: str) -> str:
    """SSRF defense: only allow http/https URLs resolving to public IP addresses."""
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Only valid http/https URLs are supported")

    hostname = parsed.hostname.lower()
    if hostname in {"localhost", "127.0.0.1", "0.0.0.0", "::1"} or hostname.endswith(".local"):
        raise ValueError("Private/local hostnames are not allowed")

    try:
        infos = socket.getaddrinfo(hostname, None)
        for info in infos:
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                raise ValueError("URL resolves to a non-public IP address")
    except socket.gaierror as exc:
        raise ValueError(f"Could not resolve hostname: {hostname}") from exc

    return url.strip()


def parse_web_url(url: str) -> Dict[str, Any]:
    """Scrape a public web page into clean structured Markdown."""
    safe_url = _validate_public_url(url)
    headers = {
        "User-Agent": "StudyGAI-Bot/1.0 (+https://studygai.app; educational study assistant)",
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9",
    }
    resp = requests.get(safe_url, headers=headers, timeout=20, allow_redirects=True)
    resp.raise_for_status()
    # Re-validate final URL after redirects
    _validate_public_url(resp.url)

    html = resp.text
    title_match = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    page_title = re.sub(r"\s+", " ", title_match.group(1)).strip() if title_match else safe_url

    markdown = ""
    method = "html_strip"

    if TRAFILATURA_AVAILABLE:
        extracted = trafilatura.extract(
            html,
            url=resp.url,
            output_format="markdown",
            include_tables=True,
            include_links=False,
            favor_recall=True,
        )
        if extracted and extracted.strip():
            markdown = f"<!-- PAGE 1 -->\n# {page_title}\n\n{extracted.strip()}"
            method = "trafilatura"

    if not markdown:
        # Lightweight clean fallback if trafilatura is unavailable
        no_script = re.sub(r"<(script|style|noscript)[^>]*>.*?</\1>", " ", html, flags=re.I | re.S)
        text_only = re.sub(r"<[^>]+>", "\n", no_script)
        text_only = re.sub(r"\n{3,}", "\n\n", text_only).strip()
        markdown = f"<!-- PAGE 1 -->\n# {page_title}\n\n{text_only}"

    return {
        "status": "success",
        "title": page_title,
        "url": resp.url,
        "markdown": markdown,
        "char_count": len(markdown),
        "page_count": 1,
        "formulas": [],
        "images": [],
        "metadata": {"source_url": resp.url, "title": page_title},
        "extraction_method": method,
    }


def extract_youtube_video_id(url_or_id: str) -> str:
    val = url_or_id.strip()
    if re.match(r"^[a-zA-Z0-9_-]{11}$", val):
        return val
    parsed = urlparse(val)
    host = (parsed.hostname or "").lower()
    if "youtu.be" in host:
        vid = parsed.path.lstrip("/").split("/")[0]
        if vid:
            return vid
    if "youtube.com" in host:
        if parsed.path == "/watch":
            qs = parse_qs(parsed.query)
            if "v" in qs and qs["v"]:
                return qs["v"][0]
        parts = [p for p in parsed.path.split("/") if p]
        if len(parts) >= 2 and parts[0] in {"embed", "shorts", "live", "v"}:
            return parts[1]
    raise ValueError(f"Could not extract YouTube video ID from: {url_or_id}")


def parse_youtube_transcript(url_or_id: str, languages: Optional[List[str]] = None) -> Dict[str, Any]:
    """Fetch timestamped YouTube transcript formatted as structured Markdown."""
    if not YOUTUBE_AVAILABLE:
        raise RuntimeError("youtube-transcript-api is not installed")

    video_id = extract_youtube_video_id(url_or_id)
    langs = languages or ["en", "en-US", "en-GB"]

    # Support both youtube-transcript-api v0.6.x and v1.x APIs
    if hasattr(YouTubeTranscriptApi, "get_transcript"):
        entries = YouTubeTranscriptApi.get_transcript(video_id, languages=langs)
    else:
        api = YouTubeTranscriptApi()
        fetched = api.fetch(video_id, languages=langs)
        entries = [
            {"start": getattr(s, "start", 0), "text": getattr(s, "text", "")}
            for s in fetched
        ]

    # Group transcript into ~2-minute sections for clean TOC + timestamp citations
    sections: List[str] = [f"# YouTube Lecture ({video_id})"]
    current_bucket = -1
    bucket_lines: List[str] = []

    def fmt_ts(sec: float) -> str:
        s = int(sec)
        h, rem = divmod(s, 3600)
        m, sec_rem = divmod(rem, 60)
        return f"{h:02d}:{m:02d}:{sec_rem:02d}" if h else f"{m:02d}:{sec_rem:02d}"

    for entry in entries:
        start = float(entry.get("start", 0.0))
        text = (entry.get("text") or "").replace("\n", " ").strip()
        if not text:
            continue
        bucket = int(start // 120)
        if bucket != current_bucket:
            if bucket_lines:
                sections.append(" ".join(bucket_lines))
                bucket_lines = []
            current_bucket = bucket
            sections.append(f"<!-- PAGE {bucket + 1} -->\n## Segment [{fmt_ts(start)}]")
        bucket_lines.append(f"[{fmt_ts(start)}] {text}")

    if bucket_lines:
        sections.append(" ".join(bucket_lines))

    markdown = "\n\n".join(sections).strip()
    return {
        "status": "success",
        "video_id": video_id,
        "title": f"YouTube Video ({video_id})",
        "markdown": markdown,
        "char_count": len(markdown),
        "page_count": max(1, current_bucket + 1),
        "formulas": [],
        "images": [],
        "metadata": {"video_id": video_id, "source_url": f"https://www.youtube.com/watch?v={video_id}"},
        "extraction_method": "youtube_transcript_api",
    }
