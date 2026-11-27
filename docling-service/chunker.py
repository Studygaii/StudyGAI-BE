"""
Structure-Aware Parent-Child Markdown / AST Chunker for StudyGAI RAG.

Features:
- Deterministic, guaranteed-terminating splitting (fixes prior infinite-loop bug).
- Preserves page numbers from `<!-- PAGE N -->` markers.
- Tracks Markdown heading hierarchy (# / ## / ###) to build a Document TOC tree
  and breadcrumb section paths (e.g. "Chapter 3 > 3.2 Chain Rule").
- Preserves atomic blocks: fenced code blocks, Markdown tables, and display LaTeX ($$...$$).
- Produces Small-to-Big hierarchy:
    * Parent chunks (~4,800 chars / ~1,200 tokens) for rich LLM context.
    * Child chunks (~1,200 chars / ~300 tokens, ~200 char sentence-aligned overlap)
      for pinpoint dense + sparse retrieval.
- Prepends Anthropic-style Contextual Retrieval headers to child text before embedding.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional, Tuple


PAGE_MARKER_RE = re.compile(r"<!--\s*PAGE\s+(\d+)\s*-->", re.IGNORECASE)
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
SENTENCE_BREAK_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9(\[\"`$])")


@dataclass
class TocEntry:
    level: int
    title: str
    page: int
    parent_index: int


@dataclass
class ParentChunk:
    parent_index: int
    text: str
    section_path: str
    page_start: int
    page_end: int
    token_count: int
    has_formula: bool
    has_table: bool


@dataclass
class ChildChunk:
    point_id: str
    child_index: int
    parent_index: int
    text: str
    contextual_text: str
    section_path: str
    page_number: int
    token_count: int
    has_formula: bool
    has_table: bool


def estimate_tokens(text: str) -> int:
    """Fast token count approximation (~4 chars/token for English/STEM)."""
    if not text:
        return 0
    return max(1, (len(text) + 3) // 4)


def deterministic_point_id(blob_id: str, child_index: int) -> str:
    """Deterministic UUIDv5 so re-indexing the same blob is 100% idempotent."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"studygai:chunk:{blob_id}:{child_index}"))


def _contains_formula(text: str) -> bool:
    return "$$" in text or "\\(" in text or "\\[" in text or bool(re.search(r"\$[^$\n]{2,}\$", text))


def _contains_table(text: str) -> bool:
    lines = text.splitlines()
    for i in range(len(lines) - 1):
        if "|" in lines[i] and re.match(r"^\s*\|?[\s:-]+\|[\s|:-]*$", lines[i + 1]):
            return True
    return False


def _split_atomic_blocks(markdown: str) -> List[Tuple[str, int, str]]:
    """
    Parse Markdown into atomic semantic blocks while tracking current page and heading breadcrumb.
    Returns list of (block_text, page_number, section_path).
    Never splits inside fenced code blocks, display LaTeX blocks ($$...$$), or Markdown tables.
    """
    lines = markdown.replace("\r\n", "\n").split("\n")
    blocks: List[Tuple[str, int, str]] = []

    current_page = 1
    heading_stack: List[Tuple[int, str]] = []

    buf: List[str] = []
    buf_page = 1
    in_code_fence = False
    in_math_fence = False
    in_table = False

    def current_section_path() -> str:
        if not heading_stack:
            return "Document"
        return " > ".join(title for _, title in heading_stack)

    def flush_buf() -> None:
        nonlocal buf
        text = "\n".join(buf).strip()
        if text:
            blocks.append((text, buf_page, current_section_path()))
        buf = []

    for line in lines:
        # Check for page marker
        page_match = PAGE_MARKER_RE.search(line)
        if page_match and not in_code_fence and not in_math_fence:
            flush_buf()
            current_page = int(page_match.group(1))
            buf_page = current_page
            # Strip marker if line has remaining text
            cleaned = PAGE_MARKER_RE.sub("", line).strip()
            if cleaned:
                buf.append(cleaned)
            continue

        stripped = line.strip()

        # Toggle code fence
        if stripped.startswith("```"):
            if not in_code_fence:
                flush_buf()
                buf_page = current_page
                in_code_fence = True
                buf.append(line)
            else:
                buf.append(line)
                in_code_fence = False
                flush_buf()
            continue

        if in_code_fence:
            buf.append(line)
            continue

        # Toggle display LaTeX fence ($$ on its own line)
        if stripped == "$$":
            if not in_math_fence:
                flush_buf()
                buf_page = current_page
                in_math_fence = True
                buf.append(line)
            else:
                buf.append(line)
                in_math_fence = False
                flush_buf()
            continue

        if in_math_fence:
            buf.append(line)
            continue

        # Headings update breadcrumb stack and start a clean section boundary
        heading_match = HEADING_RE.match(line)
        if heading_match:
            flush_buf()
            level = len(heading_match.group(1))
            title = heading_match.group(2).strip()
            while heading_stack and heading_stack[-1][0] >= level:
                heading_stack.pop()
            heading_stack.append((level, title))
            buf_page = current_page
            blocks.append((line.strip(), current_page, current_section_path()))
            continue

        # Markdown table lines stay grouped together
        is_table_line = stripped.startswith("|") or (
            "|" in stripped and len(stripped.split("|")) >= 3
        )
        if is_table_line:
            if not in_table:
                flush_buf()
                buf_page = current_page
                in_table = True
            buf.append(line)
            continue
        elif in_table:
            in_table = False
            flush_buf()

        # Blank line separates paragraphs
        if not stripped:
            flush_buf()
            continue

        if not buf:
            buf_page = current_page
        buf.append(line)

    flush_buf()
    return blocks


def _split_oversized_block(text: str, max_chars: int, overlap_chars: int) -> List[str]:
    """
    Safely split an oversized single block on sentence/line boundaries with guaranteed forward progress.
    """
    text = text.strip()
    if len(text) <= max_chars:
        return [text] if text else []

    # Try splitting by sentences first
    sentences = SENTENCE_BREAK_RE.split(text)
    if len(sentences) > 1:
        pieces: List[str] = []
        current = ""
        for sent in sentences:
            sent = sent.strip()
            if not sent:
                continue
            if len(sent) > max_chars:
                if current:
                    pieces.append(current)
                    current = ""
                pieces.extend(_hard_window_split(sent, max_chars, overlap_chars))
            elif len(current) + len(sent) + 1 <= max_chars:
                current = f"{current} {sent}".strip() if current else sent
            else:
                if current:
                    pieces.append(current)
                # Build overlap tail from end of previous piece
                tail = current[-overlap_chars:].strip() if overlap_chars > 0 and current else ""
                if tail and len(tail) + len(sent) + 1 <= max_chars:
                    current = f"{tail} {sent}".strip()
                else:
                    current = sent
        if current:
            pieces.append(current)
        return pieces

    return _hard_window_split(text, max_chars, overlap_chars)


def _hard_window_split(text: str, max_chars: int, overlap_chars: int) -> List[str]:
    """
    Fixed-window character splitter with strict step >= 1 guarantee (never loops infinitely).
    """
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    safe_overlap = max(0, min(overlap_chars, max_chars // 3))
    step = max(1, max_chars - safe_overlap)

    chunks: List[str] = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + max_chars, n)
        # Snap end back to whitespace boundary when possible to avoid cutting mid-word
        if end < n:
            ws = text.rfind(" ", start + max_chars // 2, end)
            if ws > start:
                end = ws
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= n:
            break
        next_start = max(start + 1, end - safe_overlap)
        if next_start <= start:
            next_start = start + step
        start = next_start
    return chunks


def build_parent_child_chunks(
    markdown: str,
    blob_id: str,
    source_name: str = "Document",
    parent_max_chars: int = 4800,
    child_max_chars: int = 1200,
    child_overlap_chars: int = 180,
) -> Dict[str, Any]:
    """
    Build hierarchical Parent + Child chunks and a Document TOC from extracted Markdown.

    Returns:
        {
            "toc": [dict, ...],
            "parents": [ParentChunk as dict, ...],
            "children": [ChildChunk as dict, ...],
            "token_estimate": int,
        }
    """
    cleaned = (markdown or "").strip()
    if not cleaned:
        return {"toc": [], "parents": [], "children": [], "token_estimate": 0}

    blocks = _split_atomic_blocks(cleaned)
    if not blocks:
        blocks = [(cleaned, 1, "Document")]

    parents: List[ParentChunk] = []
    toc: List[TocEntry] = []

    # Step 1: Assemble Parent Chunks respecting section boundaries
    p_blocks: List[str] = []
    p_len = 0
    p_section = blocks[0][2]
    p_page_start = blocks[0][1]
    p_page_end = blocks[0][1]

    def flush_parent() -> None:
        nonlocal p_blocks, p_len
        if not p_blocks:
            return
        text = "\n\n".join(p_blocks).strip()
        if text:
            parents.append(
                ParentChunk(
                    parent_index=len(parents),
                    text=text,
                    section_path=p_section,
                    page_start=p_page_start,
                    page_end=p_page_end,
                    token_count=estimate_tokens(text),
                    has_formula=_contains_formula(text),
                    has_table=_contains_table(text),
                )
            )
        p_blocks = []
        p_len = 0

    for block_text, page_num, section_path in blocks:
        heading_match = HEADING_RE.match(block_text)
        if heading_match:
            # Start a fresh parent on major headings (H1/H2) if current parent has substantial content
            level = len(heading_match.group(1))
            title = heading_match.group(2).strip()
            if level <= 2 and p_len > parent_max_chars // 3:
                flush_parent()
            target_parent_idx = len(parents)
            toc.append(
                TocEntry(
                    level=level,
                    title=title,
                    page=page_num,
                    parent_index=target_parent_idx,
                )
            )

        # If a single block exceeds parent_max_chars, flush current and split it cleanly
        if len(block_text) > parent_max_chars:
            flush_parent()
            for sub in _split_oversized_block(block_text, parent_max_chars, child_overlap_chars):
                p_section = section_path
                p_page_start = page_num
                p_page_end = page_num
                p_blocks = [sub]
                p_len = len(sub)
                flush_parent()
            continue

        # Flush if adding block exceeds budget or section changed significantly on big parent
        if p_blocks and (
            p_len + len(block_text) + 2 > parent_max_chars
            or (section_path != p_section and p_len > int(parent_max_chars * 0.65))
        ):
            flush_parent()

        if not p_blocks:
            p_section = section_path
            p_page_start = page_num
            p_page_end = page_num
        else:
            p_page_end = max(p_page_end, page_num)

        p_blocks.append(block_text)
        p_len += len(block_text) + 2

    flush_parent()

    # Step 2: Slice each Parent Chunk into sentence-aware Child Chunks with Contextual Headers
    children: List[ChildChunk] = []
    for parent in parents:
        # Split parent into paragraph units first so child boundaries align cleanly
        raw_paras = [p.strip() for p in re.split(r"\n{2,}", parent.text) if p.strip()]
        child_texts: List[str] = []
        curr = ""

        for para in raw_paras:
            if len(para) > child_max_chars:
                if curr:
                    child_texts.append(curr)
                    curr = ""
                child_texts.extend(_split_oversized_block(para, child_max_chars, child_overlap_chars))
            elif curr and len(curr) + len(para) + 2 > child_max_chars:
                child_texts.append(curr)
                # Carry trailing sentence overlap from previous child if it fits
                tail = curr[-child_overlap_chars:].strip() if child_overlap_chars > 0 else ""
                if tail and len(tail) + len(para) + 2 <= child_max_chars:
                    curr = f"{tail}\n\n{para}"
                else:
                    curr = para
            else:
                curr = f"{curr}\n\n{para}" if curr else para

        if curr:
            child_texts.append(curr)

        if not child_texts:
            child_texts = [parent.text]

        for idx_in_parent, c_text in enumerate(child_texts):
            # Approximate page number linearly across parent span
            if parent.page_end > parent.page_start and len(child_texts) > 1:
                ratio = idx_in_parent / max(1, len(child_texts) - 1)
                page_num = parent.page_start + round(ratio * (parent.page_end - parent.page_start))
            else:
                page_num = parent.page_start

            child_idx = len(children)
            header = f"[Source: {source_name} | Section: {parent.section_path} | Page {page_num}]"
            contextual_text = f"{header}\n{c_text}"

            children.append(
                ChildChunk(
                    point_id=deterministic_point_id(blob_id, child_idx),
                    child_index=child_idx,
                    parent_index=parent.parent_index,
                    text=c_text,
                    contextual_text=contextual_text,
                    section_path=parent.section_path,
                    page_number=page_num,
                    token_count=estimate_tokens(c_text),
                    has_formula=_contains_formula(c_text),
                    has_table=_contains_table(c_text),
                )
            )

    total_tokens = sum(p.token_count for p in parents)
    return {
        "toc": [asdict(t) for t in toc],
        "parents": [asdict(p) for p in parents],
        "children": [asdict(c) for c in children],
        "token_estimate": total_tokens,
    }
