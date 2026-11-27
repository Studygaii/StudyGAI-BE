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
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const qdrant_service_1 = require("./qdrant.service");
const source_access_service_1 = require("../rag/source-access.service");
let QdrantController = QdrantController_1 = class QdrantController {
    constructor(qdrantService, sourceAccess, courseSourceModel) {
        this.qdrantService = qdrantService;
        this.sourceAccess = sourceAccess;
        this.courseSourceModel = courseSourceModel;
        this.logger = new common_1.Logger(QdrantController_1.name);
    }
    async healthCheck() {
        try {
            const isHealthy = await this.qdrantService.health();
            return {
                status: isHealthy ? 'healthy' : 'unhealthy',
                service: 'qdrant',
                collection: this.qdrantService.getDefaultCollection(),
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
    async searchChunks(query, courseId, limit = 8, req) {
        if (!query || !courseId) {
            return {
                status: 'error',
                error: 'query and courseId query parameters are required',
            };
        }
        const userId = req.user?.id || req.user?._id;
        await this.sourceAccess.assertCourseAccess(courseId, userId);
        const activeSources = await this.courseSourceModel
            .find({ course: new mongoose_2.Types.ObjectId(courseId), enabled: true, status: 'ready' })
            .select('blob')
            .lean();
        const blobIds = activeSources.map((s) => s.blob?.toString()).filter(Boolean);
        const parsedLimit = Math.min(30, Math.max(1, Number(limit) || 8));
        const results = await this.qdrantService.hybridSearch({
            query,
            blobIds: blobIds.length > 0 ? blobIds : undefined,
            courseId,
            limit: Math.max(parsedLimit * 3, 24),
            rerankTopK: parsedLimit,
        });
        return {
            status: 'success',
            query,
            courseId,
            results,
            count: results.length,
        };
    }
    async getChunks(courseId, limit = 15, req) {
        const userId = req.user?.id || req.user?._id;
        await this.sourceAccess.assertCourseAccess(courseId, userId);
        const sources = await this.courseSourceModel
            .find({ course: new mongoose_2.Types.ObjectId(courseId), status: 'ready' })
            .select('blob')
            .lean();
        const blobIds = sources.map((s) => s.blob?.toString()).filter(Boolean);
        const chunks = await this.qdrantService.getCourseChunks(courseId, blobIds.length > 0 ? blobIds : undefined, Math.min(100, Math.max(1, Number(limit) || 15)));
        return {
            status: 'success',
            courseId,
            chunks,
            count: chunks.length,
        };
    }
    async getStats(courseId, req) {
        const userId = req.user?.id || req.user?._id;
        await this.sourceAccess.assertCourseAccess(courseId, userId);
        const sources = await this.courseSourceModel
            .find({ course: new mongoose_2.Types.ObjectId(courseId), status: 'ready' })
            .select('blob')
            .lean();
        const blobIds = sources.map((s) => s.blob?.toString()).filter(Boolean);
        const stats = await this.qdrantService.getEmbeddingStats(courseId, blobIds.length > 0 ? blobIds : undefined);
        return { status: 'success', stats };
    }
    async deleteChunks(courseId, req) {
        const userId = req.user?.id || req.user?._id;
        await this.sourceAccess.assertCourseAccess(courseId, userId, true);
        const success = await this.qdrantService.deleteCoursChunks(courseId);
        return { status: 'success', courseId, deleted: success };
    }
    async globalSearch(query, limit = 10, req) {
        if (!query) {
            return { status: 'error', error: 'query parameter is required' };
        }
        const userId = req.user?.id || req.user?._id;
        const userSources = await this.courseSourceModel
            .find({ addedBy: new mongoose_2.Types.ObjectId(userId), enabled: true, status: 'ready' })
            .select('blob')
            .limit(200)
            .lean();
        const blobIds = Array.from(new Set(userSources.map((s) => s.blob?.toString()).filter(Boolean)));
        if (blobIds.length === 0) {
            return { status: 'success', query, results: [], count: 0 };
        }
        const parsedLimit = Math.min(30, Math.max(1, Number(limit) || 10));
        const results = await this.qdrantService.hybridSearch({
            query,
            blobIds,
            limit: Math.max(parsedLimit * 3, 30),
            rerankTopK: parsedLimit,
        });
        return {
            status: 'success',
            query,
            results,
            count: results.length,
        };
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
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({
        summary: 'Hybrid dense + sparse + reranked search across authorized course sources',
    }),
    __param(0, (0, common_1.Query)('query')),
    __param(1, (0, common_1.Query)('courseId')),
    __param(2, (0, common_1.Query)('limit')),
    __param(3, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object, Object]),
    __metadata("design:returntype", Promise)
], QdrantController.prototype, "searchChunks", null);
__decorate([
    (0, common_1.Get)('/course/:courseId/chunks'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Get indexed chunks for an authorized course' }),
    __param(0, (0, common_1.Param)('courseId')),
    __param(1, (0, common_1.Query)('limit')),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], QdrantController.prototype, "getChunks", null);
__decorate([
    (0, common_1.Get)('/course/:courseId/stats'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Get vector indexing statistics for an authorized course' }),
    __param(0, (0, common_1.Param)('courseId')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], QdrantController.prototype, "getStats", null);
__decorate([
    (0, common_1.Delete)('/course/:courseId/chunks'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Delete legacy course-scoped chunks (course owner only)' }),
    __param(0, (0, common_1.Param)('courseId')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], QdrantController.prototype, "deleteChunks", null);
__decorate([
    (0, common_1.Get)('/global-search'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Search across ALL courses owned by the authenticated user' }),
    __param(0, (0, common_1.Query)('query')),
    __param(1, (0, common_1.Query)('limit')),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], QdrantController.prototype, "globalSearch", null);
exports.QdrantController = QdrantController = QdrantController_1 = __decorate([
    (0, swagger_1.ApiTags)('Vector Search'),
    (0, swagger_1.ApiBearerAuth)('jwt'),
    (0, common_1.Controller)('api/v1/vector'),
    __param(2, (0, mongoose_1.InjectModel)('course_sources')),
    __metadata("design:paramtypes", [qdrant_service_1.QdrantService,
        source_access_service_1.SourceAccessService,
        mongoose_2.Model])
], QdrantController);
//# sourceMappingURL=qdrant.controller.js.map