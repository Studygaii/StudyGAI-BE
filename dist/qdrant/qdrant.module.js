"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QdrantModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const mongoose_1 = require("@nestjs/mongoose");
const qdrant_service_1 = require("./qdrant.service");
const qdrant_controller_1 = require("./qdrant.controller");
const sparse_encoder_service_1 = require("../rag/sparse-encoder.service");
const source_access_service_1 = require("../rag/source-access.service");
const course_schema_1 = require("../schemas/course.schema");
const groupchat_schema_1 = require("../schemas/groupchat.schema");
const course_source_schema_1 = require("../schemas/course-source.schema");
let QdrantModule = class QdrantModule {
};
exports.QdrantModule = QdrantModule;
exports.QdrantModule = QdrantModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule,
            mongoose_1.MongooseModule.forFeature([
                { name: 'courses', schema: course_schema_1.CourseSchema },
                { name: 'groupchats', schema: groupchat_schema_1.GroupChatSchema },
                { name: 'course_sources', schema: course_source_schema_1.CourseSourceSchema },
            ]),
        ],
        providers: [qdrant_service_1.QdrantService, sparse_encoder_service_1.SparseEncoderService, source_access_service_1.SourceAccessService],
        controllers: [qdrant_controller_1.QdrantController],
        exports: [qdrant_service_1.QdrantService, sparse_encoder_service_1.SparseEncoderService, source_access_service_1.SourceAccessService],
    })
], QdrantModule);
//# sourceMappingURL=qdrant.module.js.map