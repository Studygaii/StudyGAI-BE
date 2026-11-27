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
exports.ToggleSourceDto = exports.PresignUploadDto = exports.IngestNoteDto = exports.IngestUrlDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
class IngestUrlDto {
}
exports.IngestUrlDto = IngestUrlDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'https://en.wikipedia.org/wiki/Chain_rule' }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsUrl)({ require_protocol: true }),
    __metadata("design:type", String)
], IngestUrlDto.prototype, "url", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Chain Rule Reference', required: false }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], IngestUrlDto.prototype, "title", void 0);
class IngestNoteDto {
}
exports.IngestNoteDto = IngestNoteDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Lecture 4 Personal Notes' }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], IngestNoteDto.prototype, "title", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Key formula: d/dx[f(g(x))] = f\'(g(x)) * g\'(x)' }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], IngestNoteDto.prototype, "content", void 0);
class PresignUploadDto {
}
exports.PresignUploadDto = PresignUploadDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'calculus_chapter3.pdf' }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PresignUploadDto.prototype, "fileName", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'application/pdf' }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PresignUploadDto.prototype, "mimeType", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'a3b1...64-char-hex-sha256' }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PresignUploadDto.prototype, "sha256", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 1048576, required: false }),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PresignUploadDto.prototype, "byteSize", void 0);
class ToggleSourceDto {
}
exports.ToggleSourceDto = ToggleSourceDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: true }),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ToggleSourceDto.prototype, "enabled", void 0);
//# sourceMappingURL=ingest-source.dto.js.map