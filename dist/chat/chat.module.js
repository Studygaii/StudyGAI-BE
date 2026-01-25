"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatModule = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const chat_schema_1 = require("../schemas/chat.schema");
const chat_controller_1 = require("./chat.controller");
const chat_service_1 = require("./chat.service");
const groq_module_1 = require("../common/groq.module");
const pdf_module_1 = require("../pdf/pdf.module");
const course_schema_1 = require("../schemas/course.schema");
const groupchat_schema_1 = require("../schemas/groupchat.schema");
const jwt_1 = require("@nestjs/jwt");
const chat_gateway_1 = require("./chat.gateway");
const groupchat_module_1 = require("./groupchat.module");
const qdrant_module_1 = require("../qdrant/qdrant.module");
let ChatModule = class ChatModule {
};
exports.ChatModule = ChatModule;
exports.ChatModule = ChatModule = __decorate([
    (0, common_1.Module)({
        imports: [
            mongoose_1.MongooseModule.forFeature([
                { name: 'chats', schema: chat_schema_1.ChatSchema },
                { name: 'courses', schema: course_schema_1.CourseSchema },
                { name: 'groupchats', schema: groupchat_schema_1.GroupChatSchema },
            ]),
            pdf_module_1.PdfModule,
            groq_module_1.GroqModule,
            qdrant_module_1.QdrantModule,
            jwt_1.JwtModule.register({
                secret: process.env.JWTKey || 'your-secret-key',
            }),
            groupchat_module_1.GroupChatModule,
        ],
        controllers: [chat_controller_1.ChatController],
        providers: [chat_service_1.ChatService, chat_gateway_1.ChatGateway],
        exports: [chat_service_1.ChatService, chat_gateway_1.ChatGateway],
    })
], ChatModule);
//# sourceMappingURL=chat.module.js.map