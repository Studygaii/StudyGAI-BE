// src/pdf/pdf.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PdfController } from './pdf.controller';
import { PdfService } from './pdf.service';
import { CourseSchema } from '../schemas/course.schema';
import { DoclingModule } from '../docling/docling.module';
import { QdrantModule } from '../qdrant/qdrant.module';
import { CacheModule } from '../cache/cache.module';
import { RagModule } from '../rag/rag.module';

@Module({
  imports: [
    DoclingModule,
    QdrantModule,
    CacheModule,
    RagModule,
    MongooseModule.forFeature([
      { name: 'courses', schema: CourseSchema },
    ]),
  ],
  controllers: [PdfController],
  providers: [PdfService],
  exports: [PdfService], 
})
export class PdfModule {}