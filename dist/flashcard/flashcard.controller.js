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
exports.FlashcardController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const flashcard_service_1 = require("./flashcard.service");
const swagger_1 = require("@nestjs/swagger");
const create_flashcard_dto_1 = require("./dto/create-flashcard.dto");
let FlashcardController = class FlashcardController {
    constructor(flashcardService) {
        this.flashcardService = flashcardService;
    }
    async create(body, req) {
        const userId = req.user?.id || req.user?._id;
        return await this.flashcardService.create({ ...body, creator: body.creator || userId });
    }
    async list(courseID, req) {
        return await this.flashcardService.list(courseID, req.user?.id);
    }
    async getById(id, req) {
        return await this.flashcardService.getById(id, req.user?.id);
    }
    async update(id, body, req) {
        return await this.flashcardService.update(id, req.user?.id, body);
    }
    async reviewCard(id, body, req) {
        return await this.flashcardService.reviewCard(id, req.user?.id, body.cardIndex, body.difficulty);
    }
    async delete(id, cardIndexOrId, req) {
        return await this.flashcardService.delete(id, req.user?.id, cardIndexOrId);
    }
    async getDue(courseID, userID, req) {
        return await this.flashcardService.getDueForUser(courseID, userID || req.user?.id);
    }
    async generateFromPDF(courseId, body, req) {
        return await this.flashcardService.generateFromPDF(courseId, req.user?.id, body.topic);
    }
};
exports.FlashcardController = FlashcardController;
__decorate([
    (0, common_1.Post)('create'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Create flashcards for a course' }),
    (0, swagger_1.ApiBody)({
        type: create_flashcard_dto_1.CreateFlashcardDto,
        examples: {
            example1: {
                summary: 'React Hooks Batch',
                value: {
                    title: 'React Hooks Batch 1',
                    creator: '507f1f77bcf86cd799439011',
                    course: '507f1f77bcf86cd799439012',
                    cards: [
                        {
                            front: 'What is useState used for?',
                            back: 'useState allows you to add state to functional components.',
                            tags: ['hooks', 'state', 'beginner'],
                            easeFactor: 2.5,
                            interval: 0,
                        },
                        {
                            front: 'Explain useEffect dependency array',
                            back: 'The dependency array tells useEffect when to run the effect.',
                            tags: ['hooks', 'effects', 'intermediate'],
                            easeFactor: 2.5,
                            interval: 0,
                        },
                    ],
                },
            },
        },
    }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Flashcards created' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_flashcard_dto_1.CreateFlashcardDto, Object]),
    __metadata("design:returntype", Promise)
], FlashcardController.prototype, "create", null);
__decorate([
    (0, common_1.Get)('list/:courseID'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'List all flashcards for a course' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Flashcards retrieved' }),
    __param(0, (0, common_1.Param)('courseID')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], FlashcardController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Get flashcards for a course' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Flashcards retrieved' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], FlashcardController.prototype, "getById", null);
__decorate([
    (0, common_1.Put)(':id'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Update flashcards for a course (replace entire array)' }),
    (0, swagger_1.ApiBody)({
        type: create_flashcard_dto_1.CreateFlashcardDto,
        examples: {
            example1: {
                summary: 'Replace all flashcards',
                value: {
                    title: 'Updated Batch',
                    creator: '507f1f77bcf86cd799439011',
                    course: '507f1f77bcf86cd799439012',
                    cards: [
                        {
                            front: 'Updated question',
                            back: 'Updated answer',
                            tags: ['updated'],
                            easeFactor: 2.5,
                            interval: 0,
                        },
                    ],
                },
            },
        },
    }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Flashcards updated' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, create_flashcard_dto_1.CreateFlashcardDto, Object]),
    __metadata("design:returntype", Promise)
], FlashcardController.prototype, "update", null);
__decorate([
    (0, common_1.Post)(':id/review'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Review a flashcard (Anki-style rating)' }),
    (0, swagger_1.ApiBody)({
        type: create_flashcard_dto_1.ReviewFlashcardDto,
        examples: {
            again: {
                summary: 'Card forgotten (1 day interval)',
                value: {
                    cardIndex: 0,
                    difficulty: 'Again',
                },
            },
            hard: {
                summary: 'Card difficult (slower interval growth)',
                value: {
                    cardIndex: 0,
                    difficulty: 'Hard',
                },
            },
            good: {
                summary: 'Card correct (normal interval growth)',
                value: {
                    cardIndex: 0,
                    difficulty: 'Good',
                },
            },
            easy: {
                summary: 'Card very easy (fast interval growth)',
                value: {
                    cardIndex: 0,
                    difficulty: 'Easy',
                },
            },
        },
    }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Card reviewed and scheduled' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, create_flashcard_dto_1.ReviewFlashcardDto, Object]),
    __metadata("design:returntype", Promise)
], FlashcardController.prototype, "reviewCard", null);
__decorate([
    (0, common_1.Delete)(':id/:cardIndexOrId'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Delete a flashcard by index or ID' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Flashcard deleted' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Param)('cardIndexOrId')),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], FlashcardController.prototype, "delete", null);
__decorate([
    (0, common_1.Get)('due/:courseID/:userID'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Get due flashcards for study (spaced repetition)' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Due flashcards returned' }),
    __param(0, (0, common_1.Param)('courseID')),
    __param(1, (0, common_1.Param)('userID')),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], FlashcardController.prototype, "getDue", null);
__decorate([
    (0, common_1.Post)(':courseId/generate-from-pdf'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Generate flashcards from course PDF using AI' }),
    (0, swagger_1.ApiBody)({
        type: create_flashcard_dto_1.GenerateFlashcardsDto,
        examples: {
            example1: {
                summary: 'Generate flashcards for entire PDF',
                value: {},
            },
            example2: {
                summary: 'Generate flashcards for specific topic',
                value: {
                    topic: 'Chapter 3: State Management',
                },
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Flashcards generated and saved',
        schema: {
            example: {
                message: 'Flashcards generated and saved successfully',
                count: 12,
                courseId: '507f1f77bcf86cd799439012',
                flashcards: [
                    {
                        front: 'What is state in React?',
                        back: 'State is data that a component manages...',
                        tags: ['state', 'ai-generated'],
                        easeFactor: 2.5,
                        interval: 0,
                    },
                ],
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 400,
        description: 'No PDF content found or generation failed',
    }),
    __param(0, (0, common_1.Param)('courseId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, create_flashcard_dto_1.GenerateFlashcardsDto, Object]),
    __metadata("design:returntype", Promise)
], FlashcardController.prototype, "generateFromPDF", null);
exports.FlashcardController = FlashcardController = __decorate([
    (0, swagger_1.ApiTags)('Flashcards'),
    (0, swagger_1.ApiBearerAuth)('jwt'),
    (0, common_1.Controller)('api/v1/flashcards'),
    __metadata("design:paramtypes", [flashcard_service_1.FlashcardService])
], FlashcardController);
//# sourceMappingURL=flashcard.controller.js.map