"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var QdrantService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.QdrantService = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = __importDefault(require("axios"));
const embeddings_service_1 = require("../embeddings/embeddings.service");
let QdrantService = QdrantService_1 = class QdrantService {
    constructor(embeddingsService) {
        this.embeddingsService = embeddingsService;
        this.logger = new common_1.Logger(QdrantService_1.name);
        this.qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
        this.apiKey = process.env.QDRANT_API_KEY;
        this.logger.log(`Initialized Qdrant service: ${this.qdrantUrl}`);
    }
    /**
     * Initialize collections on module startup
     */
    async onModuleInit() {
        this.logger.log('Initializing Qdrant collections...');
        try {
            await this.initializePdfChunksCollection();
            this.logger.log('Qdrant collections initialized successfully');
        }
        catch (error) {
            this.logger.error(`Failed to initialize Qdrant collections: ${error.message}`);
            throw error;
        }
    }
    /**
     * Initialize the pdf_chunks collection if it doesn't exist
     */
    async initializePdfChunksCollection() {
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
            await axios_1.default.put(`${this.qdrantUrl}/collections/${collectionName}`, {
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
            }, {
                headers: this.getHeaders(),
            });
            this.logger.log(`Collection "${collectionName}" created successfully`);
        }
        catch (error) {
            if (error.response?.status === 400) {
                this.logger.log(`Collection "${collectionName}" already exists`);
            }
            else {
                throw error;
            }
        }
    }
    /**
     * Check if a collection exists in Qdrant
     */
    async collectionExists(collectionName) {
        try {
            const response = await axios_1.default.get(`${this.qdrantUrl}/collections/${collectionName}`, {
                headers: this.getHeaders(),
            });
            return response.status === 200;
        }
        catch (error) {
            if (error.response?.status === 404) {
                return false;
            }
            throw error;
        }
    }
    /**
     * Search for similar chunks in Qdrant for a given query and course
     */
    async searchSimilarChunks(query, courseId, limit = 5, collectionName = 'pdf_chunks') {
        try {
            this.logger.debug(`Searching for similar chunks: query="${query}", courseId="${courseId}", limit=${limit}`);
            // Call Qdrant search API directly (via HTTP)
            const response = await axios_1.default.post(`${this.qdrantUrl}/collections/${collectionName}/points/search`, {
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
            }, {
                headers: this.getHeaders(),
            });
            // Map results to our format
            // Handle both array and object with points property
            const points = Array.isArray(response.data.result) ? response.data.result : response.data.result?.points || [];
            const results = points.map((hit) => ({
                score: hit.score,
                text: hit.payload.text || '',
                chunkIndex: hit.payload.chunk_index || -1,
                metadata: hit.payload.metadata || {},
            }));
            this.logger.debug(`Found ${results.length} similar chunks`);
            return results;
        }
        catch (error) {
            this.logger.error(`Failed to search similar chunks: ${error.message}`);
            throw error;
        }
    }
    /**
     * Get chunks for a specific course
     */
    async getCoursChunks(courseId, limit = 10, collectionName = 'pdf_chunks') {
        try {
            this.logger.debug(`Fetching chunks for course: ${courseId}`);
            const response = await axios_1.default.post(`${this.qdrantUrl}/collections/${collectionName}/points/scroll`, {
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
            }, {
                headers: this.getHeaders(),
            });
            // Handle both array and object with points property
            const points = Array.isArray(response.data.result) ? response.data.result : response.data.result?.points || [];
            const results = points.map((point) => ({
                score: 1,
                text: point.payload.text || '',
                chunkIndex: point.payload.chunkIndex || -1,
                metadata: point.payload.metadata || {},
            }));
            this.logger.debug(`Retrieved ${results.length} chunks for course ${courseId}`);
            return results;
        }
        catch (error) {
            this.logger.error(`Failed to get course chunks: ${error.message}`);
            throw error;
        }
    }
    /**
     * Delete all chunks for a course
     */
    async deleteCoursChunks(courseId, collectionName = 'pdf_chunks') {
        try {
            this.logger.debug(`Deleting chunks for course: ${courseId}`);
            await axios_1.default.post(`${this.qdrantUrl}/collections/${collectionName}/points/delete`, {
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
            }, {
                headers: this.getHeaders(),
            });
            this.logger.debug(`Deleted all chunks for course ${courseId}`);
            return true;
        }
        catch (error) {
            this.logger.error(`Failed to delete course chunks: ${error.message}`);
            throw error;
        }
    }
    /**
     * Get embedding stats from docling service
     */
    async getEmbeddingStats(courseId, collectionName = 'pdf_chunks') {
        try {
            this.logger.debug(`Getting embedding stats for course: ${courseId}`);
            const response = await axios_1.default.post(`${this.qdrantUrl}/collections/${collectionName}/points/scroll`, {
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
            }, {
                headers: this.getHeaders(),
            });
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
        }
        catch (error) {
            this.logger.error(`Failed to get embedding stats: ${error.message}`);
            throw error;
        }
    }
    /**
     * Search across multiple courses
     */
    async searchGlobal(query, limit = 10, collectionName = 'pdf_chunks') {
        try {
            this.logger.debug(`Performing global search: query="${query}", limit=${limit}`);
            // This would require the backend to generate embeddings for the query
            // For now, returning empty as we need query embedding from Python service
            this.logger.warn('Global search requires query embedding from Python service');
            return [];
        }
        catch (error) {
            this.logger.error(`Failed to perform global search: ${error.message}`);
            throw error;
        }
    }
    /**
     * Store text chunks with embeddings in Qdrant
     */
    async storeChunksWithEmbeddings(chunks, courseId, collectionName = 'pdf_chunks') {
        try {
            this.logger.log(`[storeChunksWithEmbeddings] Storing ${chunks.length} chunks for course ${courseId}`);
            if (!chunks || chunks.length === 0) {
                this.logger.warn(`[storeChunksWithEmbeddings] No chunks provided`);
                return {
                    status: 'success',
                    chunksCreated: 0,
                    embeddingsGenerated: 0,
                    pointsStored: 0,
                    collectionName,
                };
            }
            // Generate embeddings for all chunks
            this.logger.log(`[storeChunksWithEmbeddings] Generating embeddings for ${chunks.length} chunks`);
            const embeddings = await this.embeddingsService.generateEmbeddings(chunks);
            this.logger.log(`[storeChunksWithEmbeddings] Generated ${embeddings?.length || 0} embeddings`);
            if (!embeddings || embeddings.length === 0) {
                this.logger.error('[storeChunksWithEmbeddings] Failed to generate embeddings');
                return {
                    status: 'failed',
                    chunksCreated: chunks.length,
                    embeddingsGenerated: 0,
                    pointsStored: 0,
                    collectionName,
                };
            }
            // Ensure collection exists
            this.logger.log('[storeChunksWithEmbeddings] Initializing collection...');
            await this.initializePdfChunksCollection();
            // Create Qdrant points from chunks and embeddings
            const points = chunks.map((chunk, index) => {
                // Ensure vector is valid size (384 dimensions for all-MiniLM-L6-v2)
                // If embedding is empty, use zeros
                let vector = embeddings[index];
                if (!vector || vector.length === 0) {
                    vector = new Array(384).fill(0);
                }
                return {
                    id: Math.floor(Date.now() * 1000) + index, // Use timestamp-based ID for uniqueness
                    vector: vector,
                    payload: {
                        text: chunk,
                        courseId: courseId,
                        chunkIndex: index,
                        chunkLength: chunk.length,
                        timestamp: new Date().toISOString(),
                        metadata: {
                            source: courseId,
                            type: 'pdf_chunk',
                        },
                    },
                };
            });
            // Upsert points to Qdrant in batches to avoid memory issues
            const batchSize = 50;
            let totalStored = 0;
            for (let i = 0; i < points.length; i += batchSize) {
                const batch = points.slice(i, Math.min(i + batchSize, points.length));
                this.logger.log(`[storeChunksWithEmbeddings] Upserting batch ${Math.floor(i / batchSize) + 1}: ${batch.length} points`);
                try {
                    const upsertResponse = await axios_1.default.put(`${this.qdrantUrl}/collections/${collectionName}/points?wait=true`, { points: batch }, { headers: this.getHeaders() });
                    // Qdrant returns 200 for success
                    if (upsertResponse.status === 200 || upsertResponse.status === 201) {
                        totalStored += batch.length;
                        this.logger.log(`[storeChunksWithEmbeddings] Batch upsert successful: ${totalStored}/${points.length} stored`);
                    }
                    else {
                        this.logger.warn(`[storeChunksWithEmbeddings] Batch upsert status: ${upsertResponse.status}`);
                    }
                }
                catch (batchError) {
                    this.logger.error(`[storeChunksWithEmbeddings] Batch upsert error: ${batchError.message}`);
                    if (batchError.response?.status === 400) {
                        this.logger.error(`[storeChunksWithEmbeddings] 400 Bad Request - payload may be invalid`);
                        this.logger.debug(`First batch point: ${JSON.stringify(batch[0])}`);
                    }
                }
            }
            this.logger.log(`[storeChunksWithEmbeddings] Completed: ${totalStored}/${points.length} points stored`);
            return {
                status: totalStored > 0 ? 'success' : 'partial_success',
                chunksCreated: chunks.length,
                embeddingsGenerated: embeddings.length,
                pointsStored: totalStored,
                collectionName,
            };
        }
        catch (error) {
            this.logger.error(`[storeChunksWithEmbeddings] Failed: ${error.message}`, error.stack);
            throw error;
        }
    }
    /**
     * Check Qdrant health
     */
    async health() {
        try {
            const response = await axios_1.default.get(`${this.qdrantUrl}/readyz`, {
                headers: this.getHeaders(),
            });
            this.logger.debug('Qdrant health check passed');
            return response.status === 200;
        }
        catch (error) {
            this.logger.error(`Qdrant health check failed: ${error.message}`);
            return false;
        }
    }
    /**
     * Get authorization headers
     */
    getHeaders() {
        const headers = {
            'Content-Type': 'application/json',
        };
        const apiKey = process.env.QDRANT_API_KEY;
        if (apiKey) {
            headers['api-key'] = apiKey;
        }
        return headers;
    }
};
exports.QdrantService = QdrantService;
exports.QdrantService = QdrantService = QdrantService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [embeddings_service_1.EmbeddingsService])
], QdrantService);
//# sourceMappingURL=qdrant.service.js.map