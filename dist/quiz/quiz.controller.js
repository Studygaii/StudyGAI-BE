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
exports.QuizController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const quiz_service_1 = require("./quiz.service");
const generate_quiz_dto_1 = require("./dto/generate-quiz.dto");
const submit_quiz_dto_1 = require("./dto/submit-quiz.dto");
const source_access_service_1 = require("../rag/source-access.service");
let QuizController = class QuizController {
    constructor(quizService, sourceAccess) {
        this.quizService = quizService;
        this.sourceAccess = sourceAccess;
    }
    async listByCourse(courseId, quizType, req) {
        const userId = req.user?.id || req.user?._id;
        await this.sourceAccess.assertCourseAccess(courseId, userId);
        return this.quizService.listByCourse(courseId, quizType);
    }
    async generate(courseId, body, req) {
        const userId = req.user?.id || req.user?._id;
        await this.sourceAccess.assertCourseAccess(courseId, userId);
        return this.quizService.generateQuiz(courseId, userId, {
            numQuestions: body.numQuestions ?? 8,
            quizType: body.quizType || 'quiz',
            title: body.title,
            groupId: body.groupId,
        });
    }
    async getQuiz(quizId) {
        return this.quizService.getQuiz(quizId);
    }
    async submit(quizId, body, req) {
        const userId = req.user?.id || req.user?._id;
        return this.quizService.submit(quizId, userId, body.answers || []);
    }
    async leaderboard(quizId) {
        return this.quizService.leaderboard(quizId);
    }
};
exports.QuizController = QuizController;
__decorate([
    (0, common_1.Get)('course/:courseId'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'List all quizzes or exams generated for a course' }),
    __param(0, (0, common_1.Param)('courseId')),
    __param(1, (0, common_1.Query)('type')),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], QuizController.prototype, "listByCourse", null);
__decorate([
    (0, common_1.Post)('generate/:courseId'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Generate a quiz or exam from course content' }),
    __param(0, (0, common_1.Param)('courseId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, generate_quiz_dto_1.GenerateQuizDto, Object]),
    __metadata("design:returntype", Promise)
], QuizController.prototype, "generate", null);
__decorate([
    (0, common_1.Get)(':quizId'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Get quiz (without answer key)' }),
    __param(0, (0, common_1.Param)('quizId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], QuizController.prototype, "getQuiz", null);
__decorate([
    (0, common_1.Post)(':quizId/submit'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Submit quiz/exam answers' }),
    (0, swagger_1.ApiBody)({ type: submit_quiz_dto_1.SubmitQuizDto }),
    __param(0, (0, common_1.Param)('quizId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, submit_quiz_dto_1.SubmitQuizDto, Object]),
    __metadata("design:returntype", Promise)
], QuizController.prototype, "submit", null);
__decorate([
    (0, common_1.Get)(':quizId/leaderboard'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Get leaderboard for quiz (group ranking)' }),
    __param(0, (0, common_1.Param)('quizId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], QuizController.prototype, "leaderboard", null);
exports.QuizController = QuizController = __decorate([
    (0, swagger_1.ApiTags)('Quiz'),
    (0, swagger_1.ApiBearerAuth)('jwt'),
    (0, common_1.Controller)('api/v1/quiz'),
    __metadata("design:paramtypes", [quiz_service_1.QuizService,
        source_access_service_1.SourceAccessService])
], QuizController);
//# sourceMappingURL=quiz.controller.js.map