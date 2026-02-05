// src/main.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import * as dotenv from 'dotenv';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as fs from 'fs';

async function bootstrap() {
  dotenv.config();
  const logger = new Logger('Bootstrap');
  
  if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
    logger.log('Created uploads directory');
  }
  
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new IoAdapter(app));
  
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
    origin: true, // Allow all origins in development
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Content-Type,Authorization,X-Requested-With',
  });

  const config = new DocumentBuilder()
    .setTitle('StudyGAI EdTech API')
    .setDescription(
      'AI-Powered Study Assistant API with PDF processing and chat capabilities',
    )
    .setVersion('1.0')
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
  
  logger.log('Swagger UI available at /docs');

  const port = process.env.PORT || 4000;
  await app.listen(port);
  logger.log(`SAGE Backend running on http://localhost:${port}`);
  logger.log(`API Documentation: http://localhost:${port}/docs`);
}

bootstrap();