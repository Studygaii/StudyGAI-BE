// src/main.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import * as dotenv from 'dotenv';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as fs from 'fs';
import { RedisIoAdapter } from './common/redis-io.adapter';

async function bootstrap() {
  dotenv.config();
  const logger = new Logger('Bootstrap');

  if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
    logger.log('Created uploads directory');
  }

  const app = await NestFactory.create(AppModule);

  // Graceful SIGTERM/SIGINT hooks for zero-downtime Kubernetes rolling deployments
  app.enableShutdownHooks();

  // Horizontal Multi-Replica Socket.IO Redis Adapter (with automatic single-node fallback)
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis(process.env.REDIS_URL);
  app.useWebSocketAdapter(redisIoAdapter);

  // Configure payload size limits for file uploads
  app.use(require('express').json({ limit: '50mb' }));
  app.use(require('express').urlencoded({ limit: '50mb', extended: true }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Content-Type,Authorization,X-Requested-With,X-Request-Id,X-Ops-Token',
  });

  const config = new DocumentBuilder()
    .setTitle('StudyGAI EdTech API (NotebookLM+ 100M-Scale RAG)')
    .setDescription(
      'Multi-source Hybrid RAG, GraphRAG Concept Maps, Mastery-Aware Adaptive Tutoring, 2-Host Audio Overviews & Real-Time Study Groups',
    )
    .setVersion('2.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'jwt',
        description: 'Enter JWT token',
      },
      'jwt',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('/docs', app, document, {
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
