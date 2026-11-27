import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { ITocEntry } from '../schemas/source-blob.schema';

export interface ParentChunkData {
  parentIndex: number;
  text: string;
  sectionPath: string;
  pageStart: number;
  pageEnd: number;
  tokenCount: number;
  hasFormula: boolean;
  hasTable: boolean;
}

export interface ChildChunkData {
  pointId: string;
  childIndex: number;
  parentIndex: number;
  text: string;
  contextualText: string;
  sectionPath: string;
  pageNumber: number;
  tokenCount: number;
  hasFormula: boolean;
  hasTable: boolean;
}

export interface ChunkingResult {
  toc: ITocEntry[];
  parents: ParentChunkData[];
  children: ChildChunkData[];
  tokenEstimate: number;
}

const PAGE_MARKER_RE = /<!--\s*PAGE\s+(\d+)\s*-->/i;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const SENTENCE_BREAK_RE = /(?<=[.!?])\s+(?=[A-Z0-9(\["`$])/;

// RFC 4122 URL Namespace UUID bytes: 6ba7b811-9dad-11d1-80b4-00c04fd430c8
const UUID_NAMESPACE_URL = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex');

/**
 * Structure-Aware Parent-Child Markdown / AST Chunker (TypeScript mirror of chunker.py).
 *
 * Guarantees forward progress (eliminates prior infinite-loop bug), preserves atomic
 * Markdown tables / fenced code / display LaTeX blocks, builds a Document TOC, and
 * generates deterministic UUIDv5 point IDs for idempotent Qdrant upserts.
 */
@Injectable()
export class ChunkerService {
  estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.max(1, Math.ceil(text.length / 4));
  }

  /** RFC 4122 UUIDv5 matching Python's uuid.uuid5(uuid.NAMESPACE_URL, name) */
  deterministicPointId(blobId: string, childIndex: number): string {
    const name = `studygai:chunk:${blobId}:${childIndex}`;
    const hash = crypto
      .createHash('sha1')
      .update(UUID_NAMESPACE_URL)
      .update(Buffer.from(name, 'utf8'))
      .digest();

    hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
    hash[8] = (hash[8] & 0x3f) | 0x80; // RFC 4122 variant

    const hex = hash.subarray(0, 16).toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  buildParentChildChunks(
    markdown: string,
    blobId: string,
    sourceName = 'Document',
    parentMaxChars = 4800,
    childMaxChars = 1200,
    childOverlapChars = 180,
  ): ChunkingResult {
    const cleaned = (markdown || '').trim();
    if (!cleaned) {
      return { toc: [], parents: [], children: [], tokenEstimate: 0 };
    }

    const blocks = this.splitAtomicBlocks(cleaned);
    const activeBlocks = blocks.length > 0 ? blocks : [{ text: cleaned, page: 1, sectionPath: 'Document' }];

    const parents: ParentChunkData[] = [];
    const toc: ITocEntry[] = [];

    let pBlocks: string[] = [];
    let pLen = 0;
    let pSection = activeBlocks[0].sectionPath;
    let pPageStart = activeBlocks[0].page;
    let pPageEnd = activeBlocks[0].page;

    const flushParent = () => {
      if (pBlocks.length === 0) return;
      const text = pBlocks.join('\n\n').trim();
      if (text) {
        parents.push({
          parentIndex: parents.length,
          text,
          sectionPath: pSection,
          pageStart: pPageStart,
          pageEnd: pPageEnd,
          tokenCount: this.estimateTokens(text),
          hasFormula: this.containsFormula(text),
          hasTable: this.containsTable(text),
        });
      }
      pBlocks = [];
      pLen = 0;
    };

    for (const block of activeBlocks) {
      const headingMatch = block.text.match(HEADING_RE);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const title = headingMatch[2].trim();
        if (level <= 2 && pLen > Math.floor(parentMaxChars / 3)) {
          flushParent();
        }
        toc.push({
          level,
          title,
          page: block.page,
          parentIndex: parents.length,
        });
      }

      if (block.text.length > parentMaxChars) {
        flushParent();
        for (const sub of this.splitOversizedBlock(block.text, parentMaxChars, childOverlapChars)) {
          pSection = block.sectionPath;
          pPageStart = block.page;
          pPageEnd = block.page;
          pBlocks = [sub];
          pLen = sub.length;
          flushParent();
        }
        continue;
      }

      if (
        pBlocks.length > 0 &&
        (pLen + block.text.length + 2 > parentMaxChars ||
          (block.sectionPath !== pSection && pLen > Math.floor(parentMaxChars * 0.65)))
      ) {
        flushParent();
      }

      if (pBlocks.length === 0) {
        pSection = block.sectionPath;
        pPageStart = block.page;
        pPageEnd = block.page;
      } else {
        pPageEnd = Math.max(pPageEnd, block.page);
      }

      pBlocks.push(block.text);
      pLen += block.text.length + 2;
    }

    flushParent();

    const children: ChildChunkData[] = [];
    for (const parent of parents) {
      const rawParas = parent.text
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean);

      const childTexts: string[] = [];
      let curr = '';

      for (const para of rawParas) {
        if (para.length > childMaxChars) {
          if (curr) {
            childTexts.push(curr);
            curr = '';
          }
          childTexts.push(...this.splitOversizedBlock(para, childMaxChars, childOverlapChars));
        } else if (curr && curr.length + para.length + 2 > childMaxChars) {
          childTexts.push(curr);
          const tail = childOverlapChars > 0 ? curr.slice(-childOverlapChars).trim() : '';
          curr = tail && tail.length + para.length + 2 <= childMaxChars ? `${tail}\n\n${para}` : para;
        } else {
          curr = curr ? `${curr}\n\n${para}` : para;
        }
      }
      if (curr) childTexts.push(curr);
      if (childTexts.length === 0) childTexts.push(parent.text);

      for (let i = 0; i < childTexts.length; i++) {
        const cText = childTexts[i];
        const pageNumber =
          parent.pageEnd > parent.pageStart && childTexts.length > 1
            ? parent.pageStart + Math.round((i / (childTexts.length - 1)) * (parent.pageEnd - parent.pageStart))
            : parent.pageStart;

        const childIndex = children.length;
        const header = `[Source: ${sourceName} | Section: ${parent.sectionPath} | Page ${pageNumber}]`;
        children.push({
          pointId: this.deterministicPointId(blobId, childIndex),
          childIndex,
          parentIndex: parent.parentIndex,
          text: cText,
          contextualText: `${header}\n${cText}`,
          sectionPath: parent.sectionPath,
          pageNumber,
          tokenCount: this.estimateTokens(cText),
          hasFormula: this.containsFormula(cText),
          hasTable: this.containsTable(cText),
        });
      }
    }

    const tokenEstimate = parents.reduce((acc, p) => acc + p.tokenCount, 0);
    return { toc, parents, children, tokenEstimate };
  }

  hardWindowSplit(text: string, maxChars: number, overlapChars: number): string[] {
    const trimmed = (text || '').trim();
    if (!trimmed) return [];
    if (trimmed.length <= maxChars) return [trimmed];

    const safeOverlap = Math.max(0, Math.min(overlapChars, Math.floor(maxChars / 3)));
    const step = Math.max(1, maxChars - safeOverlap);

    const chunks: string[] = [];
    let start = 0;
    const n = trimmed.length;

    while (start < n) {
      let end = Math.min(start + maxChars, n);
      if (end < n) {
        const ws = trimmed.lastIndexOf(' ', end);
        if (ws > start + Math.floor(maxChars / 2)) {
          end = ws;
        }
      }
      const piece = trimmed.slice(start, end).trim();
      if (piece) chunks.push(piece);
      if (end >= n) break;

      let nextStart = Math.max(start + 1, end - safeOverlap);
      if (nextStart <= start) nextStart = start + step;
      start = nextStart;
    }

    return chunks;
  }

  private splitOversizedBlock(text: string, maxChars: number, overlapChars: number): string[] {
    const trimmed = text.trim();
    if (trimmed.length <= maxChars) return trimmed ? [trimmed] : [];

    const sentences = trimmed.split(SENTENCE_BREAK_RE);
    if (sentences.length > 1) {
      const pieces: string[] = [];
      let current = '';
      for (const rawSent of sentences) {
        const sent = rawSent.trim();
        if (!sent) continue;
        if (sent.length > maxChars) {
          if (current) {
            pieces.push(current);
            current = '';
          }
          pieces.push(...this.hardWindowSplit(sent, maxChars, overlapChars));
        } else if (!current || current.length + sent.length + 1 <= maxChars) {
          current = current ? `${current} ${sent}` : sent;
        } else {
          pieces.push(current);
          const tail = overlapChars > 0 ? current.slice(-overlapChars).trim() : '';
          current = tail && tail.length + sent.length + 1 <= maxChars ? `${tail} ${sent}` : sent;
        }
      }
      if (current) pieces.push(current);
      return pieces;
    }

    return this.hardWindowSplit(trimmed, maxChars, overlapChars);
  }

  private splitAtomicBlocks(
    markdown: string,
  ): Array<{ text: string; page: number; sectionPath: string }> {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const blocks: Array<{ text: string; page: number; sectionPath: string }> = [];

    let currentPage = 1;
    const headingStack: Array<{ level: number; title: string }> = [];
    let buf: string[] = [];
    let bufPage = 1;
    let inCodeFence = false;
    let inMathFence = false;
    let inTable = false;

    const sectionPath = () =>
      headingStack.length > 0 ? headingStack.map((h) => h.title).join(' > ') : 'Document';

    const flushBuf = () => {
      const text = buf.join('\n').trim();
      if (text) {
        blocks.push({ text, page: bufPage, sectionPath: sectionPath() });
      }
      buf = [];
    };

    for (const line of lines) {
      const pageMatch = line.match(PAGE_MARKER_RE);
      if (pageMatch && !inCodeFence && !inMathFence) {
        flushBuf();
        currentPage = parseInt(pageMatch[1], 10) || currentPage;
        bufPage = currentPage;
        const remainder = line.replace(PAGE_MARKER_RE, '').trim();
        if (remainder) buf.push(remainder);
        continue;
      }

      const stripped = line.trim();

      if (stripped.startsWith('```')) {
        if (!inCodeFence) {
          flushBuf();
          bufPage = currentPage;
          inCodeFence = true;
          buf.push(line);
        } else {
          buf.push(line);
          inCodeFence = false;
          flushBuf();
        }
        continue;
      }
      if (inCodeFence) {
        buf.push(line);
        continue;
      }

      if (stripped === '$$') {
        if (!inMathFence) {
          flushBuf();
          bufPage = currentPage;
          inMathFence = true;
          buf.push(line);
        } else {
          buf.push(line);
          inMathFence = false;
          flushBuf();
        }
        continue;
      }
      if (inMathFence) {
        buf.push(line);
        continue;
      }

      const headingMatch = line.match(HEADING_RE);
      if (headingMatch) {
        flushBuf();
        const level = headingMatch[1].length;
        const title = headingMatch[2].trim();
        while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
          headingStack.pop();
        }
        headingStack.push({ level, title });
        bufPage = currentPage;
        blocks.push({ text: stripped, page: currentPage, sectionPath: sectionPath() });
        continue;
      }

      const isTableLine =
        stripped.startsWith('|') || (stripped.includes('|') && stripped.split('|').length >= 3);
      if (isTableLine) {
        if (!inTable) {
          flushBuf();
          bufPage = currentPage;
          inTable = true;
        }
        buf.push(line);
        continue;
      } else if (inTable) {
        inTable = false;
        flushBuf();
      }

      if (!stripped) {
        flushBuf();
        continue;
      }

      if (buf.length === 0) bufPage = currentPage;
      buf.push(line);
    }

    flushBuf();
    return blocks;
  }

  private containsFormula(text: string): boolean {
    return text.includes('$$') || text.includes('\\(') || text.includes('\\[') || /\$[^$\n]{2,}\$/.test(text);
  }

  private containsTable(text: string): boolean {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].includes('|') && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])) {
        return true;
      }
    }
    return false;
  }
}
