import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { randomBytes } from 'crypto';

interface SearchResult {
  score: number;
  text: string;
  chunkIndex: number;
  metadata: Record<string, any>;
}

@Injectable()
export class QdrantService implements OnModuleInit {
  private qdrantUrl: string;
  private apiKey: string | undefined;
  private readonly logger = new Logger(QdrantService.name);

  constructor() {
    this.qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
    this.apiKey = process.env.QDRANT_API_KEY;

    this.logger.log(`Initialized Qdrant service: ${this.qdrantUrl}`);
  }

  /**
   * Initialize collections on module startup
   */
  async onModuleInit(): Promise<void> {
    this.logger.log('Initializing Qdrant collections...');
    try {
      await this.initializePdfChunksCollection();
      this.logger.log('Qdrant collections initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize Qdrant collections: ${error.message}`);
      throw error;
    }
  }

  /**
   * Initialize the pdf_chunks collection if it doesn't exist
   */
  private async initializePdfChunksCollection(): Promise<void> {
    const collectionName = 'pdf_chunks';

    try {
      // Check if collection exists
      const exists = await this.collectionExists(collectionName);
      if (exists) {
        this.logger.log(`Collection "${collectionName}" already exists`);
        return;
      }

      // Create collection with proper schema
      this.logger.log(`Creating collection "${collectionName}"...`);
      await axios.put(
        `${this.qdrantUrl}/collections/${collectionName}`,
        {
          vectors: {
            size: 384, // all-MiniLM-L6-v2 embedding size
            distance: 'Cosine',
          },
          payload_schema: {
            course_id: {
              type: 'keyword',
              index: true,
            },
            text: {
              type: 'text',
            },
            chunk_index: {
              type: 'integer',
            },
            pdf_name: {
              type: 'keyword',
              index: true,
            },
            page_number: {
              type: 'integer',
            },
            metadata: {
              type: 'object',
            },
          },
        },
        {
          headers: this.getHeaders(),
        },
      );

      this.logger.log(`Collection "${collectionName}" created successfully`);
    } catch (error) {
      if (error.response?.status === 400) {
        this.logger.log(`Collection "${collectionName}" already exists`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Check if a collection exists in Qdrant
   */
  private async collectionExists(collectionName: string): Promise<boolean> {
    try {
      const response = await axios.get(
        `${this.qdrantUrl}/collections/${collectionName}`,
        {
          headers: this.getHeaders(),
        },
      );
      return response.status === 200;
    } catch (error) {
      if (error.response?.status === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Search for similar chunks in Qdrant for a given query and course
   */
  async searchSimilarChunks(
    query: string,
    courseId: string,
    limit: number = 5,
    collectionName: string = 'pdf_chunks',
  ): Promise<SearchResult[]> {
    try {
      this.logger.debug(
        `Searching for similar chunks: query="${query}", courseId="${courseId}", limit=${limit}`,
      );

      // Call Qdrant search API directly (via HTTP)
      const response = await axios.post(
        `${this.qdrantUrl}/collections/${collectionName}/points/search`,
        {
          vector: [], // Will be populated by the backend
          limit: limit,
          filter: {
            must: [
              {
                key: 'payload.course_id',
                match: {
                  value: courseId,
                },
              },
            ],
          },
          with_payload: true,
          with_vectors: false,
        },
        {
          headers: this.getHeaders(),
        },
      );

      // Map results to our format
      // Handle both array and object with points property
      const points = Array.isArray(response.data.result) ? response.data.result : response.data.result?.points || [];
      const results: SearchResult[] = points.map((hit: any) => ({
        score: hit.score,
        text: hit.payload.text || '',
        chunkIndex: hit.payload.chunk_index || -1,
        metadata: hit.payload.metadata || {},
      }));

      this.logger.debug(`Found ${results.length} similar chunks`);
      return results;
    } catch (error) {
      this.logger.error(`Failed to search similar chunks: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get chunks for a specific course
   */
  async getCoursChunks(
    courseId: string,
    limit: number = 10,
    collectionName: string = 'pdf_chunks',
  ): Promise<SearchResult[]> {
    try {
      this.logger.debug(`Fetching chunks for course: ${courseId}`);

      const response = await axios.post(
        `${this.qdrantUrl}/collections/${collectionName}/points/scroll`,
        {
          filter: {
            must: [
              {
                key: 'courseId',
                match: {
                  value: courseId,
                },
              },
            ],
          },
          limit: limit,
          with_payload: true,
          with_vectors: false,
        },
        {
          headers: this.getHeaders(),
        },
      );

      // Handle both array and object with points property
      const points = Array.isArray(response.data.result) ? response.data.result : response.data.result?.points || [];
      const results: SearchResult[] = points.map((point: any) => ({
        score: 1,
        text: point.payload.text || '',
        chunkIndex: point.payload.chunkIndex || -1,
        metadata: point.payload.metadata || {},
      }));

      this.logger.debug(`Retrieved ${results.length} chunks for course ${courseId}`);
      return results;
    } catch (error) {
      this.logger.error(`Failed to get course chunks: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete all chunks for a course
   */
  async deleteCoursChunks(
    courseId: string,
    collectionName: string = 'pdf_chunks',
  ): Promise<boolean> {
    try {
      this.logger.debug(`Deleting chunks for course: ${courseId}`);

      await axios.post(
        `${this.qdrantUrl}/collections/${collectionName}/points/delete`,
        {
          filter: {
            must: [
              {
                key: 'payload.course_id',
                match: {
                  value: courseId,
                },
              },
            ],
          },
        },
        {
          headers: this.getHeaders(),
        },
      );

      this.logger.debug(`Deleted all chunks for course ${courseId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete course chunks: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get embedding stats from docling service
   */
  async getEmbeddingStats(
    courseId: string,
    collectionName: string = 'pdf_chunks',
  ): Promise<Record<string, any>> {
    try {
      this.logger.debug(`Getting embedding stats for course: ${courseId}`);

      const response = await axios.post(
        `${this.qdrantUrl}/collections/${collectionName}/points/scroll`,
        {
          filter: {
            must: [
              {
                key: 'payload.course_id',
                match: {
                  value: courseId,
                },
              },
            ],
          },
          limit: 1,
          with_payload: true,
          with_vectors: false,
        },
        {
          headers: this.getHeaders(),
        },
      );

      // Handle both array and object with points property
      const points = Array.isArray(response.data.result) ? response.data.result : response.data.result?.points || [];
      
      if (points.length === 0) {
        return {
          courseId,
          totalChunks: 0,
          hasEmbeddings: false,
        };
      }

      const firstPoint = points[0];
      return {
        courseId,
        totalChunks: firstPoint.payload.chunk_count || 0,
        hasEmbeddings: true,
        source: firstPoint.payload.metadata?.source || 'unknown',
      };
    } catch (error) {
      this.logger.error(`Failed to get embedding stats: ${error.message}`);
      throw error;
    }
  }

  /**
   * Search across multiple courses
   */
  async searchGlobal(
    query: string,
    limit: number = 10,
    collectionName: string = 'pdf_chunks',
  ): Promise<SearchResult[]> {
    try {
      this.logger.debug(`Performing global search: query="${query}", limit=${limit}`);

      // This would require the backend to generate embeddings for the query
      // For now, returning empty as we need query embedding from Python service
      this.logger.warn('Global search requires query embedding from Python service');
      return [];
    } catch (error) {
      this.logger.error(`Failed to perform global search: ${error.message}`);
      throw error;
    }
  }

  /**
   * Store text chunks with embeddings in Qdrant
   * DEPRECATED: This method previously called the disabled NestJS embeddings service.
   * Use the Python Docling microservice instead (docling-service/main.py POST /embed-pdf)
   * which handles PDF parsing, chunking, and embedding generation.
   */
  async storeChunksWithEmbeddings(
    chunks: string[],
    courseId: string,
    collectionName: string = 'pdf_chunks',
  ): Promise<any> {
    this.logger.warn('[storeChunksWithEmbeddings] DEPRECATED: Use Python Docling microservice instead');
    throw new Error('storeChunksWithEmbeddings is deprecated. Use Python Docling /embed-pdf endpoint.');
  }

  /**
   * Check Qdrant health
   */
  async health(): Promise<boolean> {
    try {
      const response = await axios.get(
        `${this.qdrantUrl}/readyz`,
        {
          headers: this.getHeaders(),
        },
      );
      this.logger.debug('Qdrant health check passed');
      return response.status === 200;
    } catch (error) {
      this.logger.error(`Qdrant health check failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Get authorization headers
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const apiKey = process.env.QDRANT_API_KEY;
    if (apiKey) {
      headers['api-key'] = apiKey;
    }

    return headers;
  }
}
