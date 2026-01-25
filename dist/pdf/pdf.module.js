"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PdfModule = void 0;
// src/pdf/pdf.module.ts
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const pdf_controller_1 = require("./pdf.controller");
const pdf_service_1 = require("./pdf.service");
const course_schema_1 = require("../schemas/course.schema");
const docling_module_1 = require("../docling/docling.module");
const qdrant_module_1 = require("../qdrant/qdrant.module");
const cache_module_1 = require("../cache/cache.module");
//import { CourseSchema } from '../courses/schemas/course.schema';
let PdfModule = class PdfModule {
};
exports.PdfModule = PdfModule;
exports.PdfModule = PdfModule = __decorate([
    (0, common_1.Module)({
        imports: [
            docling_module_1.DoclingModule,
            qdrant_module_1.QdrantModule,
            cache_module_1.CacheModule,
            mongoose_1.MongooseModule.forFeature([
                { name: 'courses', schema: course_schema_1.CourseSchema },
            ]),
        ],
        controllers: [pdf_controller_1.PdfController],
        providers: [pdf_service_1.PdfService],
        exports: [pdf_service_1.PdfService],
    })
], PdfModule);
//# sourceMappingURL=pdf.module.js.map