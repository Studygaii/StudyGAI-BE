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
exports.MetricsService = void 0;
const common_1 = require("@nestjs/common");
const DEFAULT_LATENCY_BUCKETS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
/**
 * Zero-dependency Prometheus OpenMetrics 0.0.4 Metrics Registry for StudyGAI.
 *
 * Tracks HTTP latency, RAG retrieval strategy/latency/citations, cache hit ratio,
 * ingestion queue outcomes, Hot/Cold vector tiering events, rate-limit rejections,
 * and Node.js memory footprint.
 */
let MetricsService = class MetricsService {
    constructor() {
        this.counters = new Map();
        this.histograms = new Map();
        this.startedAtMs = Date.now();
        this.registerCounter('studygai_http_requests_total', 'Total HTTP requests processed by StudyGAI API');
        this.registerHistogram('studygai_http_request_duration_ms', 'HTTP request latency in milliseconds', DEFAULT_LATENCY_BUCKETS);
        this.registerCounter('studygai_rag_queries_total', 'Total RAG queries handled by strategy, mode, and provider');
        this.registerHistogram('studygai_rag_latency_ms', 'End-to-end RAG orchestration latency in milliseconds', [50, 150, 300, 600, 1200, 2500, 5000, 10000, 20000]);
        this.registerCounter('studygai_rag_citations_total', 'Total evidence citations generated and verified');
        this.registerCounter('studygai_rag_cache_events_total', 'Cache hit/miss counters across RAG layers');
        this.registerCounter('studygai_ingestion_jobs_total', 'Document/URL/YouTube ingestion outcomes');
        this.registerCounter('studygai_vector_tiering_events_total', 'Hot/Cold Qdrant vector archival & rehydration events');
        this.registerCounter('studygai_rate_limit_blocked_total', 'Requests rejected by distributed rate limiter');
    }
    registerCounter(name, help) {
        if (!this.counters.has(name)) {
            this.counters.set(name, { help, values: new Map() });
        }
    }
    registerHistogram(name, help, buckets = DEFAULT_LATENCY_BUCKETS) {
        if (!this.histograms.has(name)) {
            this.histograms.set(name, { help, buckets: [...buckets].sort((a, b) => a - b), values: new Map() });
        }
    }
    incCounter(name, labels = {}, delta = 1) {
        const entry = this.counters.get(name);
        if (!entry)
            return;
        const key = this.serializeLabels(labels);
        entry.values.set(key, (entry.values.get(key) || 0) + delta);
    }
    observeHistogram(name, value, labels = {}) {
        const entry = this.histograms.get(name);
        if (!entry || !Number.isFinite(value))
            return;
        const key = this.serializeLabels(labels);
        let state = entry.values.get(key);
        if (!state) {
            state = {
                buckets: entry.buckets,
                counts: new Array(entry.buckets.length).fill(0),
                sum: 0,
                count: 0,
            };
            entry.values.set(key, state);
        }
        state.sum += value;
        state.count += 1;
        for (let i = 0; i < state.buckets.length; i++) {
            if (value <= state.buckets[i]) {
                state.counts[i] += 1;
            }
        }
    }
    /** Render Prometheus text exposition format (version 0.0.4) */
    renderPrometheus() {
        const lines = [];
        // Process runtime gauges
        const mem = process.memoryUsage();
        const uptimeSec = Math.floor((Date.now() - this.startedAtMs) / 1000);
        lines.push('# HELP studygai_process_uptime_seconds Process uptime in seconds');
        lines.push('# TYPE studygai_process_uptime_seconds gauge');
        lines.push(`studygai_process_uptime_seconds ${uptimeSec}`);
        lines.push('# HELP studygai_process_memory_rss_bytes Resident set size memory in bytes');
        lines.push('# TYPE studygai_process_memory_rss_bytes gauge');
        lines.push(`studygai_process_memory_rss_bytes ${mem.rss}`);
        lines.push('# HELP studygai_process_heap_used_bytes V8 heap used in bytes');
        lines.push('# TYPE studygai_process_heap_used_bytes gauge');
        lines.push(`studygai_process_heap_used_bytes ${mem.heapUsed}`);
        // Counters
        for (const [name, entry] of this.counters.entries()) {
            lines.push(`# HELP ${name} ${entry.help}`);
            lines.push(`# TYPE ${name} counter`);
            if (entry.values.size === 0) {
                lines.push(`${name} 0`);
            }
            else {
                for (const [labelStr, val] of entry.values.entries()) {
                    lines.push(`${name}${labelStr} ${val}`);
                }
            }
        }
        // Histograms
        for (const [name, entry] of this.histograms.entries()) {
            lines.push(`# HELP ${name} ${entry.help}`);
            lines.push(`# TYPE ${name} histogram`);
            for (const [labelStr, state] of entry.values.entries()) {
                for (let i = 0; i < state.buckets.length; i++) {
                    const leLabels = this.appendLabel(labelStr, 'le', String(state.buckets[i]));
                    lines.push(`${name}_bucket${leLabels} ${state.counts[i]}`);
                }
                const infLabels = this.appendLabel(labelStr, 'le', '+Inf');
                lines.push(`${name}_bucket${infLabels} ${state.count}`);
                lines.push(`${name}_sum${labelStr} ${Number(state.sum.toFixed(3))}`);
                lines.push(`${name}_count${labelStr} ${state.count}`);
            }
        }
        return lines.join('\n') + '\n';
    }
    serializeLabels(labels) {
        const keys = Object.keys(labels).sort();
        if (keys.length === 0)
            return '';
        const inner = keys
            .map((k) => `${k}="${String(labels[k]).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
            .join(',');
        return `{${inner}}`;
    }
    appendLabel(existingSerialized, key, value) {
        const pair = `${key}="${value}"`;
        if (!existingSerialized)
            return `{${pair}}`;
        return `${existingSerialized.slice(0, -1)},${pair}}`;
    }
};
exports.MetricsService = MetricsService;
exports.MetricsService = MetricsService = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], MetricsService);
//# sourceMappingURL=metrics.service.js.map