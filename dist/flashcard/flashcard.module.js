"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlashcardModule = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const flashcard_controller_1 = require("./flashcard.controller");
const flashcard_service_1 = require("./flashcard.service");
const course_schema_1 = require("../schemas/course.schema");
const groq_module_1 = require("../common/groq.module");
const qdrant_module_1 = require("../qdrant/qdrant.module");
let FlashcardModule = class FlashcardModule {
};
exports.FlashcardModule = FlashcardModule;
exports.FlashcardModule = FlashcardModule = __decorate([
    (0, common_1.Module)({
        imports: [
            mongoose_1.MongooseModule.forFeature([
                { name: 'courses', schema: course_schema_1.CourseSchema }, // operate on Course model
            ]),
            groq_module_1.GroqModule, // add Groq for flashcard generation
            qdrant_module_1.QdrantModule, // add Qdrant for vector search context
        ],
        providers: [flashcard_service_1.FlashcardService],
        controllers: [flashcard_controller_1.FlashcardController],
        exports: [flashcard_service_1.FlashcardService],
    })
], FlashcardModule);
//# sourceMappingURL=flashcard.module.js.map