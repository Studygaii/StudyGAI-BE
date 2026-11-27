"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuizModule = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const quiz_controller_1 = require("./quiz.controller");
const quiz_service_1 = require("./quiz.service");
const quiz_schema_1 = require("../schemas/quiz.schema");
const course_schema_1 = require("../schemas/course.schema");
const groq_module_1 = require("../common/groq.module");
const pdf_module_1 = require("../pdf/pdf.module");
const chat_module_1 = require("../chat/chat.module");
const qdrant_module_1 = require("../qdrant/qdrant.module");
const rag_module_1 = require("../rag/rag.module");
let QuizModule = class QuizModule {
};
exports.QuizModule = QuizModule;
exports.QuizModule = QuizModule = __decorate([
    (0, common_1.Module)({
        imports: [
            groq_module_1.GroqModule,
            pdf_module_1.PdfModule,
            chat_module_1.ChatModule,
            qdrant_module_1.QdrantModule,
            rag_module_1.RagModule,
            mongoose_1.MongooseModule.forFeature([
                { name: 'quizzes', schema: quiz_schema_1.QuizSchema },
                { name: 'courses', schema: course_schema_1.CourseSchema },
            ]),
        ],
        controllers: [quiz_controller_1.QuizController],
        providers: [quiz_service_1.QuizService],
    })
], QuizModule);
//# sourceMappingURL=quiz.module.js.map