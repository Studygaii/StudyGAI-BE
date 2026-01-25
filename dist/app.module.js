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
const pdf_module_1 = require("./pdf/pdf.module");
const app_controller_1 = require("./app.controller");
const flashcard_module_1 = require("./flashcard/flashcard.module");
const groupchat_schema_1 = require("./schemas/groupchat.schema");
const quiz_schema_1 = require("./schemas/quiz.schema");
const quiz_module_1 = require("./quiz/quiz.module");
const cache_module_1 = require("./cache/cache.module");
const qdrant_module_1 = require("./qdrant/qdrant.module");
const embeddings_module_1 = require("./embeddings/embeddings.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({ isGlobal: true }),
            cache_module_1.CacheModule,
            embeddings_module_1.EmbeddingsModule,
            mongoose_1.MongooseModule.forRoot(process.env.mongoURI || process.env.localURI || ''),
            mongoose_1.MongooseModule.forFeature([
                { name: 'users', schema: user_schema_1.UserSchema },
                { name: 'courses', schema: course_schema_1.CourseSchema },
                { name: 'chats', schema: chat_schema_1.ChatSchema },
                { name: 'groupchats', schema: groupchat_schema_1.GroupChatSchema },
                { name: 'quizzes', schema: quiz_schema_1.QuizSchema },
            ]),
            auth_module_1.AuthModule,
            chat_module_1.ChatModule,
            course_module_1.CourseModule,
            upload_module_1.UploadModule,
            groq_module_1.GroqModule,
            pdf_module_1.PdfModule,
            flashcard_module_1.FlashcardModule,
            quiz_module_1.QuizModule,
            qdrant_module_1.QdrantModule,
        ],
        controllers: [app_controller_1.AppController],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map