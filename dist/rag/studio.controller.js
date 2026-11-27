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
Object.defineProperty(exports, "__esModule", { value: true });
exports.StudioController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const source_access_service_1 = require("./source-access.service");
const mastery_service_1 = require("./mastery.service");
const concept_graph_service_1 = require("./concept-graph.service");
const studio_service_1 = require("./studio.service");
const studio_dto_1 = require("./dto/studio.dto");
let StudioController = class StudioController {
    constructor(sourceAccess, masteryService, conceptGraphService, studioService) {
        this.sourceAccess = sourceAccess;
        this.masteryService = masteryService;
        this.conceptGraphService = conceptGraphService;
        this.studioService = studioService;
    }
    async getMastery(courseId, req) {
        const userId = req.user?.id || req.user?._id;
        await this.sourceAccess.assertCourseAccess(courseId, userId);
        const profile = await this.masteryService.getLearnerProfile(userId, courseId);
        return { success: true, data: profile };
    }
    async getConceptGraph(courseId, req) {
        const userId = req.user?.id || req.user?._id;
        await this.sourceAccess.assertCourseAccess(courseId, userId);
        const graph = await this.conceptGraphService.getGraph(courseId, userId);
        return { success: true, data: graph };
    }
    async generateConceptGraph(courseId, dto, req) {
        const userId = req.user?.id || req.user?._id;
        await this.sourceAccess.assertCourseAccess(courseId, userId);
        const graph = await this.conceptGraphService.generateGraph(courseId, userId, dto);
        return { success: true, data: graph };
    }
    async generateAudioOverview(courseId, dto, req) {
        const userId = req.user?.id || req.user?._id;
        await this.sourceAccess.assertCourseAccess(courseId, userId);
        return this.studioService.generateAudioOverview(courseId, userId, dto);
    }
    async generateExamPredictor(courseId, dto, req) {
        const userId = req.user?.id || req.user?._id;
        await this.sourceAccess.assertCourseAccess(courseId, userId);
        return this.studioService.generateExamPredictor(courseId, userId, dto);
    }
    async listArtifacts(courseId, type, req) {
        const userId = req.user?.id || req.user?._id;
        await this.sourceAccess.assertCourseAccess(courseId, userId);
        return this.studioService.listArtifacts(courseId, type);
    }
};
exports.StudioController = StudioController;
__decorate([
    (0, common_1.Get)('course/:courseId/mastery'),
    (0, swagger_1.ApiOperation)({
        summary: 'Get authenticated learner concept mastery profile for a course notebook',
    }),
    __param(0, (0, common_1.Param)('courseId')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], StudioController.prototype, "getMastery", null);
__decorate([
    (0, common_1.Get)('course/:courseId/concept-graph'),
    (0, swagger_1.ApiOperation)({
        summary: 'Get persisted Concept Knowledge Graph (enriched with live user mastery scores)',
    }),
    __param(0, (0, common_1.Param)('courseId')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], StudioController.prototype, "getConceptGraph", null);
__decorate([
    (0, common_1.Post)('course/:courseId/concept-graph/generate'),
    (0, swagger_1.ApiOperation)({
        summary: 'Generate or refresh GraphRAG Concept Knowledge Graph & Interactive Mind Map',
    }),
    __param(0, (0, common_1.Param)('courseId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, studio_dto_1.GenerateConceptGraphDto, Object]),
    __metadata("design:returntype", Promise)
], StudioController.prototype, "generateConceptGraph", null);
__decorate([
    (0, common_1.Post)('course/:courseId/audio-overview'),
    (0, swagger_1.ApiOperation)({
        summary: 'Generate a 2-host NotebookLM-style Audio Overview podcast script grounded in active sources',
    }),
    __param(0, (0, common_1.Param)('courseId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, studio_dto_1.GenerateAudioOverviewDto, Object]),
    __metadata("design:returntype", Promise)
], StudioController.prototype, "generateAudioOverview", null);
__decorate([
    (0, common_1.Post)('course/:courseId/exam-predictor'),
    (0, swagger_1.ApiOperation)({
        summary: 'Generate a Mastery-Weighted High-Yield Exam Forecast across active notebook sources',
    }),
    __param(0, (0, common_1.Param)('courseId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, studio_dto_1.GenerateExamPredictorDto, Object]),
    __metadata("design:returntype", Promise)
], StudioController.prototype, "generateExamPredictor", null);
__decorate([
    (0, common_1.Get)('course/:courseId/artifacts'),
    (0, swagger_1.ApiOperation)({
        summary: 'List saved Study Studio artifacts (audio_overview, exam_predictor, study_guide)',
    }),
    __param(0, (0, common_1.Param)('courseId')),
    __param(1, (0, common_1.Query)('type')),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], StudioController.prototype, "listArtifacts", null);
exports.StudioController = StudioController = __decorate([
    (0, swagger_1.ApiTags)('Study Studio & Adaptive Intelligence (Phase 3)'),
    (0, swagger_1.ApiBearerAuth)('jwt'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Controller)('api/v1/studio'),
    __metadata("design:paramtypes", [source_access_service_1.SourceAccessService,
        mastery_service_1.MasteryService,
        concept_graph_service_1.ConceptGraphService,
        studio_service_1.StudioService])
], StudioController);
//# sourceMappingURL=studio.controller.js.map