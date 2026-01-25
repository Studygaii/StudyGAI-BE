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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var QdrantController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.QdrantController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const qdrant_service_1 = require("./qdrant.service");
let QdrantController = QdrantController_1 = class QdrantController {
    constructor(qdrantService) {
        this.qdrantService = qdrantService;
        this.logger = new common_1.Logger(QdrantController_1.name);
    }
    async healthCheck() {
        try {
            const isHealthy = await this.qdrantService.health();
            return {
                status: isHealthy ? 'healthy' : 'unhealthy',
                service: 'qdrant',
            };
        }
        catch (error) {
            return {
                status: 'error',
                service: 'qdrant',
                error: error.message,
            };
        }
    }
    async searchChunks(query, courseId, limit = 5) {
        if (!query || !courseId) {
            return {
                status: 'error',
                error: 'query and courseId query parameters are required',
            };
        }
        try {
            const results = await this.qdrantService.searchSimilarChunks(query, courseId, limit);
            return {
                status: 'success',
                query,
                courseId,
                results,
                count: results.length,
            };
        }
        catch (error) {
            this.logger.error(`Search failed: ${error.message}`);
            return {
                status: 'error',
                error: error.message,
            };
        }
    }
    async getChunks(courseId, limit = 10) {
        try {
            const chunks = await this.qdrantService.getCoursChunks(courseId, limit);
            return {
                status: 'success',
                courseId,
                chunks,
                count: chunks.length,
            };
        }
        catch (error) {
            this.logger.error(`Get chunks failed: ${error.message}`);
            return {
                status: 'error',
                error: error.message,
            };
        }
    }
    async getStats(courseId) {
        try {
            const stats = await this.qdrantService.getEmbeddingStats(courseId);
            return {
                status: 'success',
                stats,
            };
        }
        catch (error) {
            this.logger.error(`Get stats failed: ${error.message}`);
            return {
                status: 'error',
                error: error.message,
            };
        }
    }
    async deleteChunks(courseId) {
        try {
            const success = await this.qdrantService.deleteCoursChunks(courseId);
            return {
                status: 'success',
                courseId,
                deleted: success,
            };
        }
        catch (error) {
            this.logger.error(`Delete chunks failed: ${error.message}`);
            return {
                status: 'error',
                error: error.message,
            };
        }
    }
    async globalSearch(query, limit = 10) {
        if (!query) {
            return {
                status: 'error',
                error: 'query parameter is required',
            };
        }
        try {
            const results = await this.qdrantService.searchGlobal(query, limit);
            return {
                status: 'success',
                query,
                results,
                count: results.length,
            };
        }
        catch (error) {
            this.logger.error(`Global search failed: ${error.message}`);
            return {
                status: 'error',
                error: error.message,
            };
        }
    }
};
exports.QdrantController = QdrantController;
__decorate([
    (0, common_1.Get)('/health'),
    (0, swagger_1.ApiOperation)({ summary: 'Check Qdrant database health' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], QdrantController.prototype, "healthCheck", null);
__decorate([
    (0, common_1.Post)('/search'),
    (0, swagger_1.ApiOperation)({
        summary: 'Search for similar PDF chunks based on query',
        description: 'Searches the vector database for chunks similar to the provided query within a specific course',
    }),
    __param(0, (0, common_1.Query)('query')),
    __param(1, (0, common_1.Query)('courseId')),
    __param(2, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Number]),
    __metadata("design:returntype", Promise)
], QdrantController.prototype, "searchChunks", null);
__decorate([
    (0, common_1.Get)('/course/:courseId/chunks'),
    (0, swagger_1.ApiOperation)({
        summary: 'Get all chunks for a course',
        description: 'Retrieves all stored PDF chunks associated with a specific course',
    }),
    __param(0, (0, common_1.Param)('courseId')),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Number]),
    __metadata("design:returntype", Promise)
], QdrantController.prototype, "getChunks", null);
__decorate([
    (0, common_1.Get)('/course/:courseId/stats'),
    (0, swagger_1.ApiOperation)({
        summary: 'Get embedding statistics for a course',
        description: 'Returns metadata about stored embeddings for a course',
    }),
    __param(0, (0, common_1.Param)('courseId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], QdrantController.prototype, "getStats", null);
__decorate([
    (0, common_1.Delete)('/course/:courseId/chunks'),
    (0, swagger_1.ApiOperation)({
        summary: 'Delete all chunks for a course',
        description: 'Removes all stored PDF chunks associated with a specific course',
    }),
    __param(0, (0, common_1.Param)('courseId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], QdrantController.prototype, "deleteChunks", null);
__decorate([
    (0, common_1.Get)('/global-search'),
    (0, swagger_1.ApiOperation)({
        summary: 'Global search across all chunks',
        description: 'Performs a semantic search across all stored chunks in the database',
    }),
    __param(0, (0, common_1.Query)('query')),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Number]),
    __metadata("design:returntype", Promise)
], QdrantController.prototype, "globalSearch", null);
exports.QdrantController = QdrantController = QdrantController_1 = __decorate([
    (0, swagger_1.ApiTags)('Vector Search'),
    (0, common_1.Controller)('api/v1/vector'),
    __metadata("design:paramtypes", [qdrant_service_1.QdrantService])
], QdrantController);
//# sourceMappingURL=qdrant.controller.js.map