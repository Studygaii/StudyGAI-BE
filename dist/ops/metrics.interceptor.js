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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsInterceptor = void 0;
const common_1 = require("@nestjs/common");
const operators_1 = require("rxjs/operators");
const crypto = __importStar(require("crypto"));
const metrics_service_1 = require("./metrics.service");
/**
 * Attaches a correlation `X-Request-Id` header to every response and records
 * Prometheus request count & latency histograms automatically.
 */
let MetricsInterceptor = class MetricsInterceptor {
    constructor(metrics) {
        this.metrics = metrics;
    }
    intercept(context, next) {
        if (context.getType() !== 'http') {
            return next.handle();
        }
        const http = context.switchToHttp();
        const req = http.getRequest();
        const res = http.getResponse();
        const requestId = req.headers?.['x-request-id'] || crypto.randomUUID();
        res.setHeader('X-Request-Id', requestId);
        const start = Date.now();
        const method = req.method || 'GET';
        const rawRoute = req.route?.path || req.baseUrl || req.path || 'unknown';
        // Collapse ObjectIds/UUIDs to prevent high-cardinality Prometheus label explosion
        const route = String(rawRoute)
            .replace(/[0-9a-f]{24}/gi, ':id')
            .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':uuid');
        const record = (statusCode) => {
            if (route === '/metrics' || route === '/healthz')
                return;
            const durationMs = Date.now() - start;
            this.metrics.incCounter('studygai_http_requests_total', {
                method,
                route,
                status: String(statusCode),
            });
            this.metrics.observeHistogram('studygai_http_request_duration_ms', durationMs, {
                method,
                route,
            });
        };
        return next.handle().pipe((0, operators_1.tap)({
            next: () => record(res.statusCode || 200),
            error: (err) => record(err?.status || err?.getStatus?.() || 500),
        }));
    }
};
exports.MetricsInterceptor = MetricsInterceptor;
exports.MetricsInterceptor = MetricsInterceptor = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [metrics_service_1.MetricsService])
], MetricsInterceptor);
//# sourceMappingURL=metrics.interceptor.js.map