"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RagModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const mongoose_1 = require("@nestjs/mongoose");
const source_blob_schema_1 = require("../schemas/source-blob.schema");
const course_source_schema_1 = require("../schemas/course-source.schema");
const parent_chunk_schema_1 = require("../schemas/parent-chunk.schema");
const course_schema_1 = require("../schemas/course.schema");
const groupchat_schema_1 = require("../schemas/groupchat.schema");
const user_mastery_schema_1 = require("../schemas/user-mastery.schema");
const concept_graph_schema_1 = require("../schemas/concept-graph.schema");
const study_artifact_schema_1 = require("../schemas/study-artifact.schema");
const qdrant_module_1 = require("../qdrant/qdrant.module");
const groq_module_1 = require("../common/groq.module");
const chunker_service_1 = require("./chunker.service");
const ingestion_processor_1 = require("./ingestion.processor");
const sources_service_1 = require("./sources.service");
const sources_controller_1 = require("./sources.controller");
const rag_orchestrator_service_1 = require("./rag-orchestrator.service");
const mastery_service_1 = require("./mastery.service");
const concept_graph_service_1 = require("./concept-graph.service");
const studio_service_1 = require("./studio.service");
const studio_controller_1 = require("./studio.controller");
const vector_tiering_service_1 = require("./vector-tiering.service");
let RagModule = class RagModule {
};
exports.RagModule = RagModule;
exports.RagModule = RagModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule,
            qdrant_module_1.QdrantModule,
            groq_module_1.GroqModule,
            mongoose_1.MongooseModule.forFeature([
                { name: 'source_blobs', schema: source_blob_schema_1.SourceBlobSchema },
                { name: 'course_sources', schema: course_source_schema_1.CourseSourceSchema },
                { name: 'parent_chunks', schema: parent_chunk_schema_1.ParentChunkSchema },
                { name: 'courses', schema: course_schema_1.CourseSchema },
                { name: 'groupchats', schema: groupchat_schema_1.GroupChatSchema },
                { name: 'user_masteries', schema: user_mastery_schema_1.UserMasterySchema },
                { name: 'concept_graphs', schema: concept_graph_schema_1.ConceptGraphSchema },
                { name: 'study_artifacts', schema: study_artifact_schema_1.StudyArtifactSchema },
            ]),
        ],
        controllers: [sources_controller_1.SourcesController, studio_controller_1.StudioController],
        providers: [
            chunker_service_1.ChunkerService,
            ingestion_processor_1.IngestionProcessor,
            sources_service_1.SourcesService,
            mastery_service_1.MasteryService,
            concept_graph_service_1.ConceptGraphService,
            studio_service_1.StudioService,
            vector_tiering_service_1.VectorTieringService,
            rag_orchestrator_service_1.RagOrchestratorService,
        ],
        exports: [
            chunker_service_1.ChunkerService,
            ingestion_processor_1.IngestionProcessor,
            sources_service_1.SourcesService,
            mastery_service_1.MasteryService,
            concept_graph_service_1.ConceptGraphService,
            studio_service_1.StudioService,
            vector_tiering_service_1.VectorTieringService,
            rag_orchestrator_service_1.RagOrchestratorService,
        ],
    })
], RagModule);
//# sourceMappingURL=rag.module.js.map