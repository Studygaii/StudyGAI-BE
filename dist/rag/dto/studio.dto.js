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
exports.GenerateExamPredictorDto = exports.GenerateAudioOverviewDto = exports.GenerateConceptGraphDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
class GenerateConceptGraphDto {
}
exports.GenerateConceptGraphDto = GenerateConceptGraphDto;
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, default: false }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], GenerateConceptGraphDto.prototype, "force", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, type: [String] }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], GenerateConceptGraphDto.prototype, "sourceIds", void 0);
class GenerateAudioOverviewDto {
}
exports.GenerateAudioOverviewDto = GenerateAudioOverviewDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        required: false,
        enum: ['deep_dive', 'brief', 'debate', 'exam_cram'],
        default: 'deep_dive',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['deep_dive', 'brief', 'debate', 'exam_cram']),
    __metadata("design:type", String)
], GenerateAudioOverviewDto.prototype, "style", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, example: 'Chain Rule and Backpropagation' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], GenerateAudioOverviewDto.prototype, "focusTopic", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, type: [String] }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], GenerateAudioOverviewDto.prototype, "sourceIds", void 0);
class GenerateExamPredictorDto {
}
exports.GenerateExamPredictorDto = GenerateExamPredictorDto;
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, type: [String] }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], GenerateExamPredictorDto.prototype, "sourceIds", void 0);
//# sourceMappingURL=studio.dto.js.map