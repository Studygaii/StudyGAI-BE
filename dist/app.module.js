"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const mongoose_1 = require("@nestjs/mongoose");
const config_1 = require("@nestjs/config");
const auth_module_1 = require("./auth/auth.module");
const chat_module_1 = require("./chat/chat.module");
const course_module_1 = require("./course/course.module");
const upload_module_1 = require("./upload/upload.module");
const groq_module_1 = require("./common/groq.module");
const user_schema_1 = require("./schemas/user.schema");
const course_schema_1 = require("./schemas/course.schema");
const chat_schema_1 = require("./schemas/chat.schema");
const source_blob_schema_1 = require("./schemas/source-blob.schema");
const course_source_schema_1 = require("./schemas/course-source.schema");
const parent_chunk_schema_1 = require("./schemas/parent-chunk.schema");
const user_mastery_schema_1 = require("./schemas/user-mastery.schema");
const concept_graph_schema_1 = require("./schemas/concept-graph.schema");
const study_artifact_schema_1 = require("./schemas/study-artifact.schema");
const pdf_module_1 = require("./pdf/pdf.module");
const app_controller_1 = require("./app.controller");
const flashcard_module_1 = require("./flashcard/flashcard.module");
const groupchat_schema_1 = require("./schemas/groupchat.schema");
const quiz_schema_1 = require("./schemas/quiz.schema");
const quiz_module_1 = require("./quiz/quiz.module");
const cache_module_1 = require("./cache/cache.module");
const qdrant_module_1 = require("./qdrant/qdrant.module");
const storage_module_1 = require("./storage/storage.module");
const rag_module_1 = require("./rag/rag.module");
const ops_module_1 = require("./ops/ops.module");
const metrics_interceptor_1 = require("./ops/metrics.interceptor");
const rate_limit_middleware_1 = require("./ops/rate-limit.middleware");
let AppModule = class AppModule {
    configure(consumer) {
        consumer.apply(rate_limit_middleware_1.RateLimitMiddleware).forRoutes('*');
    }
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({ isGlobal: true }),
            cache_module_1.CacheModule,
            storage_module_1.StorageModule,
            ops_module_1.OpsModule,
            mongoose_1.MongooseModule.forRoot(process.env.mongoURI || process.env.localURI || ''),
            mongoose_1.MongooseModule.forFeature([
                { name: 'users', schema: user_schema_1.UserSchema },
                { name: 'courses', schema: course_schema_1.CourseSchema },
                { name: 'chats', schema: chat_schema_1.ChatSchema },
                { name: 'groupchats', schema: groupchat_schema_1.GroupChatSchema },
                { name: 'quizzes', schema: quiz_schema_1.QuizSchema },
                { name: 'source_blobs', schema: source_blob_schema_1.SourceBlobSchema },
                { name: 'course_sources', schema: course_source_schema_1.CourseSourceSchema },
                { name: 'parent_chunks', schema: parent_chunk_schema_1.ParentChunkSchema },
                { name: 'user_masteries', schema: user_mastery_schema_1.UserMasterySchema },
                { name: 'concept_graphs', schema: concept_graph_schema_1.ConceptGraphSchema },
                { name: 'study_artifacts', schema: study_artifact_schema_1.StudyArtifactSchema },
            ]),
            auth_module_1.AuthModule,
            qdrant_module_1.QdrantModule,
            rag_module_1.RagModule,
            chat_module_1.ChatModule,
            course_module_1.CourseModule,
            upload_module_1.UploadModule,
            groq_module_1.GroqModule,
            pdf_module_1.PdfModule,
            flashcard_module_1.FlashcardModule,
            quiz_module_1.QuizModule,
        ],
        controllers: [app_controller_1.AppController],
        providers: [
            {
                provide: core_1.APP_INTERCEPTOR,
                useClass: metrics_interceptor_1.MetricsInterceptor,
            },
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map