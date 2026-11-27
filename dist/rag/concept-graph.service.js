"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var ConceptGraphService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConceptGraphService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const crypto = __importStar(require("crypto"));
const llm_service_1 = require("../common/llm.service");
const sources_service_1 = require("./sources.service");
const mastery_service_1 = require("./mastery.service");
/**
 * Lightweight GraphRAG Knowledge Graph Service.
 *
 * 1. Extracts structured concept nodes & prerequisite/relational edges across active sources.
 * 2. Overlays each user's live Mastery Score onto graph nodes for interactive Mind Maps.
 * 3. Performs 1-hop GraphRAG query expansion inside RagOrchestratorService so multi-hop
 *    questions automatically pull prerequisite definitions and related applications.
 */
let ConceptGraphService = ConceptGraphService_1 = class ConceptGraphService {
    constructor(graphModel, llm, sourcesService, masteryService) {
        this.graphModel = graphModel;
        this.llm = llm;
        this.sourcesService = sourcesService;
        this.masteryService = masteryService;
        this.logger = new common_1.Logger(ConceptGraphService_1.name);
    }
    async getGraph(courseId, userId) {
        const graph = await this.graphModel
            .findOne({ course: new mongoose_2.Types.ObjectId(courseId) })
            .lean();
        if (!graph) {
            return {
                courseId,
                exists: false,
                nodes: [],
                edges: [],
            };
        }
        const enrichedNodes = await this.overlayMastery(graph.nodes || [], userId, courseId);
        return {
            courseId,
            exists: true,
            sourceSignature: graph.sourceSignature,
            nodes: enrichedNodes,
            edges: graph.edges || [],
            updatedAt: graph.updatedAt,
        };
    }
    async generateGraph(courseId, userId, options = {}) {
        const loaded = await this.sourcesService.getEnabledSourcesContent(courseId, options.sourceIds, 60000);
        if (loaded.sources.length === 0 || !loaded.combinedMarkdown.trim()) {
            return {
                courseId,
                exists: false,
                nodes: [],
                edges: [],
                message: 'No active sources available to build concept map',
            };
        }
        const signature = crypto
            .createHash('sha256')
            .update(loaded.sources.map((s) => s.blobId).sort().join('|'))
            .digest('hex');
        if (!options.force) {
            const cached = await this.graphModel
                .findOne({ course: new mongoose_2.Types.ObjectId(courseId), sourceSignature: signature })
                .lean();
            if (cached && cached.nodes?.length > 0) {
                const enrichedNodes = await this.overlayMastery(cached.nodes, userId, courseId);
                return {
                    courseId,
                    exists: true,
                    cached: true,
                    sourceSignature: signature,
                    nodes: enrichedNodes,
                    edges: cached.edges || [],
                };
            }
        }
        let extracted = await this.extractGraphWithLlm(loaded.combinedMarkdown, loaded.sources);
        if (!extracted || extracted.nodes.length === 0) {
            extracted = this.buildFallbackGraphFromToc(loaded.sources);
        }
        const saved = await this.graphModel
            .findOneAndUpdate({ course: new mongoose_2.Types.ObjectId(courseId) }, {
            $set: {
                course: new mongoose_2.Types.ObjectId(courseId),
                sourceSignature: signature,
                nodes: extracted.nodes,
                edges: extracted.edges,
            },
        }, { upsert: true, new: true })
            .lean();
        const enrichedNodes = await this.overlayMastery(saved?.nodes || [], userId, courseId);
        return {
            courseId,
            exists: true,
            cached: false,
            sourceSignature: signature,
            nodes: enrichedNodes,
            edges: saved?.edges || [],
        };
    }
    /**
     * 1-Hop GraphRAG Query Expansion:
     * Finds concepts mentioned in `query` inside the course's ConceptGraph and gathers
     * directly connected prerequisite / extension nodes to boost cross-document recall.
     */
    async expandQueryWithGraph(courseId, query) {
        const empty = {
            matchedConcepts: [],
            relatedConcepts: [],
            expandedQuery: query,
        };
        if (!mongoose_2.Types.ObjectId.isValid(courseId) || !query?.trim())
            return empty;
        const graph = await this.graphModel
            .findOne({ course: new mongoose_2.Types.ObjectId(courseId) })
            .select('nodes edges')
            .lean();
        if (!graph || !graph.nodes?.length)
            return empty;
        const qLower = query.toLowerCase();
        const matchedIds = new Set();
        const matchedLabels = [];
        const nodeById = new Map();
        for (const node of graph.nodes) {
            nodeById.set(node.id, node);
            const labelLower = (node.label || '').toLowerCase();
            if (labelLower.length >= 3 && qLower.includes(labelLower)) {
                matchedIds.add(node.id);
                matchedLabels.push(node.label);
            }
        }
        if (matchedIds.size === 0)
            return empty;
        const relatedLabels = [];
        const seenRelated = new Set();
        for (const edge of graph.edges || []) {
            let neighborId = null;
            if (matchedIds.has(edge.from) && !matchedIds.has(edge.to)) {
                neighborId = edge.to;
            }
            else if (matchedIds.has(edge.to) && !matchedIds.has(edge.from)) {
                neighborId = edge.from;
            }
            if (neighborId) {
                const neighbor = nodeById.get(neighborId);
                if (neighbor && !seenRelated.has(neighbor.label)) {
                    seenRelated.add(neighbor.label);
                    relatedLabels.push(neighbor.label);
                }
            }
            if (relatedLabels.length >= 4)
                break;
        }
        if (relatedLabels.length === 0) {
            return { matchedConcepts: matchedLabels, relatedConcepts: [], expandedQuery: query };
        }
        return {
            matchedConcepts: matchedLabels,
            relatedConcepts: relatedLabels,
            expandedQuery: `${query} (related concepts: ${relatedLabels.join(', ')})`,
        };
    }
    /** Pure-function JSON extractor exposed for unit tests */
    parseGraphJson(raw) {
        if (!raw)
            return null;
        const cleaned = raw.replace(/```(?:json)?\n?/gi, '').replace(/```/g, '').trim();
        const startIdx = cleaned.indexOf('{');
        if (startIdx === -1)
            return null;
        let depth = 0;
        let jsonStr = '';
        for (let i = startIdx; i < cleaned.length; i++) {
            if (cleaned[i] === '{')
                depth++;
            else if (cleaned[i] === '}')
                depth--;
            if (depth === 0) {
                jsonStr = cleaned.slice(startIdx, i + 1);
                break;
            }
        }
        if (!jsonStr)
            return null;
        try {
            const parsed = JSON.parse(jsonStr);
            if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0)
                return null;
            const validCategories = new Set(['core', 'formula', 'definition', 'application', 'person']);
            const validRelations = new Set([
                'prerequisite_of',
                'part_of',
                'extends',
                'contrasts_with',
                'applies_to',
            ]);
            const nodes = [];
            const validIds = new Set();
            for (const n of parsed.nodes.slice(0, 20)) {
                const label = String(n.label || '').trim();
                if (!label)
                    continue;
                const id = String(n.id || '')
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9_-]/g, '_') || this.masteryService.slugifyConcept(label);
                if (!id || validIds.has(id))
                    continue;
                validIds.add(id);
                nodes.push({
                    id,
                    label,
                    category: validCategories.has(n.category) ? n.category : 'core',
                    summary: String(n.summary || '').trim().slice(0, 260),
                    importance: Math.min(5, Math.max(1, Number(n.importance) || 3)),
                    sourceTitle: String(n.sourceTitle || '').trim(),
                    pageHint: Math.max(1, Number(n.pageHint) || 1),
                });
            }
            const edges = [];
            for (const e of Array.isArray(parsed.edges) ? parsed.edges.slice(0, 35) : []) {
                const from = String(e.from || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
                const to = String(e.to || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
                if (!from || !to || from === to || !validIds.has(from) || !validIds.has(to))
                    continue;
                edges.push({
                    from,
                    to,
                    relation: validRelations.has(e.relation) ? e.relation : 'extends',
                    label: String(e.label || e.relation || 'relates to').trim().slice(0, 40),
                });
            }
            return { nodes, edges };
        }
        catch {
            return null;
        }
    }
    async extractGraphWithLlm(combinedMarkdown, sources) {
        try {
            const capped = combinedMarkdown.slice(0, 32000);
            const sourceNames = sources.map((s) => s.title).join(', ');
            const prompt = `Extract a Concept Knowledge Graph (for an interactive Mind Map & prerequisite navigator) from the study materials below.

Sources: ${sourceNames}

Rules:
- Extract 10 to 16 key concepts (nodes) covering core topics, key formulas, definitions, and applications.
- Extract 10 to 24 directional relationships (edges) showing prerequisite_of, part_of, extends, contrasts_with, or applies_to.
- Return ONLY valid JSON with no markdown code fences:
{
  "nodes": [
    {
      "id": "chain_rule",
      "label": "Chain Rule",
      "category": "formula",
      "summary": "Computes derivative of composite functions f(g(x)).",
      "importance": 5,
      "sourceTitle": "calc101.pdf",
      "pageHint": 1
    }
  ],
  "edges": [
    { "from": "derivatives", "to": "chain_rule", "relation": "prerequisite_of", "label": "prerequisite for" }
  ]
}

Study Material:
${capped}`;
            const completion = await this.llm.complete([
                {
                    role: 'system',
                    content: 'You are a knowledge-graph architect for an academic learning platform. Output ONLY valid JSON.',
                },
                { role: 'user', content: prompt },
            ], { temperature: 0.25, maxTokens: 2500 });
            return this.parseGraphJson(completion.content);
        }
        catch (err) {
            this.logger.warn(`LLM concept graph extraction fallback (${err.message})`);
            return null;
        }
    }
    /** Deterministic TOC-based fallback graph when LLM is unavailable */
    buildFallbackGraphFromToc(sources) {
        const nodes = [];
        const edges = [];
        const rootId = 'course_root';
        nodes.push({
            id: rootId,
            label: sources[0]?.title || 'Course Overview',
            category: 'core',
            summary: `Covers ${sources.length} source(s) in this notebook.`,
            importance: 5,
            sourceTitle: sources[0]?.title || '',
            pageHint: 1,
        });
        let prevId = rootId;
        for (const src of sources) {
            for (const entry of (src.toc || []).slice(0, 8)) {
                const id = `n_${nodes.length}_${this.masteryService.slugifyConcept(entry.title).slice(0, 20)}`;
                nodes.push({
                    id,
                    label: entry.title,
                    category: entry.level <= 1 ? 'core' : 'definition',
                    summary: `Section from ${src.title} (p.${entry.page || 1}).`,
                    importance: entry.level <= 1 ? 4 : 3,
                    sourceTitle: src.title,
                    pageHint: entry.page || 1,
                });
                edges.push({
                    from: entry.level <= 1 ? rootId : prevId,
                    to: id,
                    relation: 'part_of',
                    label: 'includes',
                });
                if (entry.level <= 1)
                    prevId = id;
                if (nodes.length >= 16)
                    break;
            }
        }
        return { nodes, edges };
    }
    async overlayMastery(nodes, userId, courseId) {
        const profile = await this.masteryService.getLearnerProfile(userId, courseId);
        const byKey = new Map(profile.allConcepts.map((c) => [c.conceptKey, c]));
        return nodes.map((n) => {
            const slug = this.masteryService.slugifyConcept(n.label);
            let match = byKey.get(slug);
            if (!match) {
                // Fuzzy substring match against tracked learner concepts
                for (const c of profile.allConcepts) {
                    if (slug.includes(c.conceptKey) || c.conceptKey.includes(slug)) {
                        match = c;
                        break;
                    }
                }
            }
            return {
                ...n,
                masteryScore: match ? match.masteryScore : null,
                masteryStatus: match ? match.status : 'untracked',
            };
        });
    }
};
exports.ConceptGraphService = ConceptGraphService;
exports.ConceptGraphService = ConceptGraphService = ConceptGraphService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)('concept_graphs')),
    __metadata("design:paramtypes", [mongoose_2.Model,
        llm_service_1.LlmService,
        sources_service_1.SourcesService,
        mastery_service_1.MasteryService])
], ConceptGraphService);
//# sourceMappingURL=concept-graph.service.js.map