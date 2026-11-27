import { Injectable, Logger } from '@nestjs/common';
import { env } from 'process';

@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);
  private extractor: any = null;
  // Disabled: Model too heavy for Node.js environment
  // private model = 'Xenova/all-MiniLM-L6-v2';

  async initialize() {
    // Disabled for now due to memory constraints
    // TODO: Use external embedding service (e.g., OpenAI, Hugging Face API)
    this.logger.log('Embeddings service initialized (model generation disabled)');
  }

  /**
   * Split text into overlapping chunks
   */
  chunkText(text: string, chunkSize: number = 512, overlap: number = 100): string[] {
    const trimmed = (text || '').trim();
    if (!trimmed) return [];
    if (trimmed.length <= chunkSize) return [trimmed];

    const safeOverlap = Math.max(0, Math.min(overlap, Math.floor(chunkSize / 3)));
    const chunks: string[] = [];
    let start = 0;

    while (start < trimmed.length) {
      const end = Math.min(start + chunkSize, trimmed.length);
      const chunk = trimmed.substring(start, end).trim();

      if (chunk.length > 0) {
        chunks.push(chunk);
      }

      if (end >= trimmed.length) {
        break;
      }

      start = Math.max(start + 1, end - safeOverlap);
    }

    return chunks.length > 0 ? chunks : [trimmed];
  }

  /**
   * Generate embeddings for text chunks - DISABLED to avoid memory issues
   * Returns empty arrays for now - can be enabled after memory optimization
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return [];
    }

    try {
      this.logger.log(`Chunking complete: ${texts.length} chunks ready for storage (embeddings disabled for now)`);
      // Return empty embeddings to complete the pipeline without memory overflow
      // TODO: Re-enable with external embedding service or model optimization
      return texts.map(() => []);
    } catch (error) {
      this.logger.error(`Error generating embeddings: ${error.message}`);
      return texts.map(() => []);
    }
  }

  /**
   * Single text embedding
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const embeddings = await this.generateEmbeddings([text]);
    return embeddings[0] || [];
  }
}
