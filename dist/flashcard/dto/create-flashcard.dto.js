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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewFlashcardDto = exports.GenerateFlashcardsDto = exports.CreateFlashcardDto = exports.FlashcardItemDto = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
/**
 * Individual flashcard item DTO
 * Represents a single front/back card with spaced-repetition fields
 * Used in both manual creation and AI generation responses
 */
class FlashcardItemDto {
}
exports.FlashcardItemDto = FlashcardItemDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'What is photosynthesis?',
        description: 'Front side of the flashcard (question/prompt)',
    }),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], FlashcardItemDto.prototype, "front", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Process by which plants convert light energy into chemical energy',
        description: 'Back side of the flashcard (answer)',
    }),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], FlashcardItemDto.prototype, "back", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: ['biology', 'chapter-1', 'photosynthesis'],
        description: 'Tags to categorize the card',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], FlashcardItemDto.prototype, "tags", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 2.5,
        description: 'Ease factor for spaced repetition (Anki default: 2.5)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], FlashcardItemDto.prototype, "easeFactor", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 0,
        description: 'Interval between reviews in days',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], FlashcardItemDto.prototype, "interval", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: null,
        description: 'Due date for next review (ISO 8601 format)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDate)(),
    __metadata("design:type", Date)
], FlashcardItemDto.prototype, "dueDate", void 0);
/**
 * DTO for MANUALLY creating flashcards in a course
 * User provides all card details (front, back, tags, etc.)
 *
 * Example use case: Student manually types in flashcards
 * Request body includes: creator, course, and array of cards
 */
class CreateFlashcardDto {
}
exports.CreateFlashcardDto = CreateFlashcardDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'React Hooks Batch 1',
        description: 'Optional title/label for this batch of flashcards',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateFlashcardDto.prototype, "title", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '507f1f77bcf86cd799439011',
        description: 'User ID of the flashcard creator (from JWT token)',
    }),
    (0, class_validator_1.IsMongoId)(),
    __metadata("design:type", String)
], CreateFlashcardDto.prototype, "creator", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '507f1f77bcf86cd799439012',
        description: 'Course ID where flashcards will be stored',
    }),
    (0, class_validator_1.IsMongoId)(),
    __metadata("design:type", String)
], CreateFlashcardDto.prototype, "course", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        type: [FlashcardItemDto],
        description: 'Array of flashcard items to create (you define each card)',
        example: [
            {
                front: 'What is useState?',
                back: 'A React Hook for state management',
                tags: ['hooks', 'react'],
                easeFactor: 2.5,
                interval: 0,
            },
        ],
    }),
    (0, class_validator_1.IsArray)(),
    __metadata("design:type", Array)
], CreateFlashcardDto.prototype, "cards", void 0);
/**
 * DTO for AI-GENERATED flashcards from PDF
 * User only specifies optional topic; AI creates all card details
 *
 * Example use case: "@studyGAI make flashcards on Chapter 3"
 * Request body is minimal: just optional topic
 * AI generates front/back/tags automatically
 */
class GenerateFlashcardsDto {
}
exports.GenerateFlashcardsDto = GenerateFlashcardsDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'Chapter 3: State Management',
        description: 'Optional: specify a topic/chapter to focus AI generation on. If omitted, AI analyzes entire PDF.',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], GenerateFlashcardsDto.prototype, "topic", void 0);
/**
 * DTO for reviewing a flashcard
 * Anki-style ratings: Again (forgot) / Hard / Good / Easy
 */
class ReviewFlashcardDto {
}
exports.ReviewFlashcardDto = ReviewFlashcardDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: '507f1f77bcf86cd799439012',
        description: 'Course ID (optional, kept for compatibility)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsMongoId)(),
    __metadata("design:type", String)
], ReviewFlashcardDto.prototype, "flashcardId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 0,
        description: 'Index of the card in course.flashcards[] array (0-based)',
    }),
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], ReviewFlashcardDto.prototype, "cardIndex", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        enum: ['Again', 'Hard', 'Good', 'Easy'],
        example: 'Good',
        description: 'User rating for spaced repetition algorithm',
    }),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReviewFlashcardDto.prototype, "difficulty", void 0);
//# sourceMappingURL=create-flashcard.dto.js.map