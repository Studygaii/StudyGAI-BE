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
exports.SendMessagesWithCourseDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const send_messages_dto_1 = require("./send-messages.dto");
class SendMessagesWithCourseDto extends send_messages_dto_1.SendMessagesDto {
}
exports.SendMessagesWithCourseDto = SendMessagesWithCourseDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: '507f1f77bcf86cd799439011', required: false }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SendMessagesWithCourseDto.prototype, "courseId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Optional subset of CourseSource IDs to ground the answer in (NotebookLM checkboxes)',
        example: ['673c5e8f9a1b2c3d4e5f6789'],
        required: false,
        type: [String],
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], SendMessagesWithCourseDto.prototype, "sourceIds", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Grounding mode: default, tutor (Socratic hints), summary (synthesis), or strict',
        enum: ['default', 'tutor', 'summary', 'strict'],
        required: false,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['default', 'tutor', 'summary', 'strict']),
    __metadata("design:type", String)
], SendMessagesWithCourseDto.prototype, "mode", void 0);
//# sourceMappingURL=send-messages-with-course.dto.js.map