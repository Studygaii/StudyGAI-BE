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
exports.ConceptGraphSchema = exports.ConceptGraph = void 0;
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
/**
 * Lightweight GraphRAG Knowledge Graph per Course Notebook.
 * Powers both interactive Mind Maps in Study Studio AND multi-hop prerequisite
 * query expansion inside RagOrchestratorService.
 */
let ConceptGraph = class ConceptGraph {
};
exports.ConceptGraph = ConceptGraph;
__decorate([
    (0, mongoose_1.Prop)({ type: mongoose_2.Types.ObjectId, ref: 'courses', required: true, unique: true, index: true }),
    __metadata("design:type", mongoose_2.Types.ObjectId)
], ConceptGraph.prototype, "course", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, default: '' }),
    __metadata("design:type", String)
], ConceptGraph.prototype, "sourceSignature", void 0);
__decorate([
    (0, mongoose_1.Prop)({
        type: [
            {
                id: { type: String, required: true },
                label: { type: String, required: true },
                category: {
                    type: String,
                    enum: ['core', 'formula', 'definition', 'application', 'person'],
                    default: 'core',
                },
                summary: { type: String, default: '' },
                importance: { type: Number, default: 3 },
                sourceTitle: { type: String, default: '' },
                pageHint: { type: Number, default: 1 },
            },
        ],
        default: [],
    }),
    __metadata("design:type", Array)
], ConceptGraph.prototype, "nodes", void 0);
__decorate([
    (0, mongoose_1.Prop)({
        type: [
            {
                from: { type: String, required: true },
                to: { type: String, required: true },
                relation: {
                    type: String,
                    enum: ['prerequisite_of', 'part_of', 'extends', 'contrasts_with', 'applies_to'],
                    default: 'extends',
                },
                label: { type: String, default: '' },
            },
        ],
        default: [],
    }),
    __metadata("design:type", Array)
], ConceptGraph.prototype, "edges", void 0);
exports.ConceptGraph = ConceptGraph = __decorate([
    (0, mongoose_1.Schema)({ timestamps: true, collection: 'concept_graphs' })
], ConceptGraph);
exports.ConceptGraphSchema = mongoose_1.SchemaFactory.createForClass(ConceptGraph);
//# sourceMappingURL=concept-graph.schema.js.map