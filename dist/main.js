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
Object.defineProperty(exports, "__esModule", { value: true });
// src/main.ts
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const dotenv = __importStar(require("dotenv"));
const app_module_1 = require("./app.module");
const swagger_1 = require("@nestjs/swagger");
const fs = __importStar(require("fs"));
const redis_io_adapter_1 = require("./common/redis-io.adapter");
async function bootstrap() {
    dotenv.config();
    const logger = new common_1.Logger('Bootstrap');
    if (!fs.existsSync('./uploads')) {
        fs.mkdirSync('./uploads');
        logger.log('Created uploads directory');
    }
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    // Graceful SIGTERM/SIGINT hooks for zero-downtime Kubernetes rolling deployments
    app.enableShutdownHooks();
    // Horizontal Multi-Replica Socket.IO Redis Adapter (with automatic single-node fallback)
    const redisIoAdapter = new redis_io_adapter_1.RedisIoAdapter(app);
    await redisIoAdapter.connectToRedis(process.env.REDIS_URL);
    app.useWebSocketAdapter(redisIoAdapter);
    // Configure payload size limits for file uploads
    app.use(require('express').json({ limit: '50mb' }));
    app.use(require('express').urlencoded({ limit: '50mb', extended: true }));
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
    }));
    app.enableCors({
        origin: true,
        methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
        credentials: true,
        allowedHeaders: 'Content-Type,Authorization,X-Requested-With,X-Request-Id,X-Ops-Token',
    });
    const config = new swagger_1.DocumentBuilder()
        .setTitle('StudyGAI EdTech API (NotebookLM+ 100M-Scale RAG)')
        .setDescription('Multi-source Hybrid RAG, GraphRAG Concept Maps, Mastery-Aware Adaptive Tutoring, 2-Host Audio Overviews & Real-Time Study Groups')
        .setVersion('2.0')
        .addBearerAuth({
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'jwt',
        description: 'Enter JWT token',
    }, 'jwt')
        .build();
    const document = swagger_1.SwaggerModule.createDocument(app, config);
    swagger_1.SwaggerModule.setup('/docs', app, document, {
        customSiteTitle: 'StudyGAI API Documentation',
        swaggerOptions: {
            persistAuthorization: true,
        },
    });
    logger.log('Swagger UI available at /docs | Metrics at /metrics | Probes at /healthz & /readyz');
    const port = process.env.PORT || 4000;
    await app.listen(port);
    logger.log(`StudyGAI Backend running on http://localhost:${port}`);
}
bootstrap();
//# sourceMappingURL=main.js.map