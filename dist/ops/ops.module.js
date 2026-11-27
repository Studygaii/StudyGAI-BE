"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpsModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const metrics_service_1 = require("./metrics.service");
const metrics_interceptor_1 = require("./metrics.interceptor");
const rate_limit_middleware_1 = require("./rate-limit.middleware");
const ops_controller_1 = require("./ops.controller");
const qdrant_module_1 = require("../qdrant/qdrant.module");
const rag_module_1 = require("../rag/rag.module");
let OpsModule = class OpsModule {
};
exports.OpsModule = OpsModule;
exports.OpsModule = OpsModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule,
            (0, common_1.forwardRef)(() => qdrant_module_1.QdrantModule),
            (0, common_1.forwardRef)(() => rag_module_1.RagModule),
        ],
        controllers: [ops_controller_1.OpsController],
        providers: [metrics_service_1.MetricsService, metrics_interceptor_1.MetricsInterceptor, rate_limit_middleware_1.RateLimitMiddleware],
        exports: [metrics_service_1.MetricsService, metrics_interceptor_1.MetricsInterceptor, rate_limit_middleware_1.RateLimitMiddleware],
    })
], OpsModule);
//# sourceMappingURL=ops.module.js.map