"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var EmbeddingsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmbeddingsService = void 0;
const common_1 = require("@nestjs/common");
let EmbeddingsService = EmbeddingsService_1 = class EmbeddingsService {
    constructor() {
        this.logger = new common_1.Logger(EmbeddingsService_1.name);
        this.extractor = null;
    }
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
    chunkText(text, chunkSize = 512, overlap = 100) {
        const chunks = [];
        let start = 0;
        while (start < text.length) {
            const end = Math.min(start + chunkSize, text.length);
            const chunk = text.substring(start, end).trim();
            if (chunk.length > 0) {
                chunks.push(chunk);
            }
            // Move start, accounting for overlap
            start = end - overlap;
            if (start <= 0) {
                break;
            }
        }
        return chunks.length > 0 ? chunks : [text];
    }
    /**
     * Generate embeddings for text chunks - DISABLED to avoid memory issues
     * Returns empty arrays for now - can be enabled after memory optimization
     */
    async generateEmbeddings(texts) {
        if (!texts || texts.length === 0) {
            return [];
        }
        try {
            this.logger.log(`Chunking complete: ${texts.length} chunks ready for storage (embeddings disabled for now)`);
            // Return empty embeddings to complete the pipeline without memory overflow
            // TODO: Re-enable with external embedding service or model optimization
            return texts.map(() => []);
        }
        catch (error) {
            this.logger.error(`Error generating embeddings: ${error.message}`);
            return texts.map(() => []);
        }
    }
    /**
     * Single text embedding
     */
    async generateEmbedding(text) {
        const embeddings = await this.generateEmbeddings([text]);
        return embeddings[0] || [];
    }
};
exports.EmbeddingsService = EmbeddingsService;
exports.EmbeddingsService = EmbeddingsService = EmbeddingsService_1 = __decorate([
    (0, common_1.Injectable)()
], EmbeddingsService);
//# sourceMappingURL=embeddings.service.js.map