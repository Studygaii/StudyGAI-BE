import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { PdfModule } from '../pdf/pdf.module';
import { QdrantModule } from '../qdrant/qdrant.module';

@Module({
  imports: [PdfModule, QdrantModule],
  controllers: [UploadController],
  providers: [UploadService],
})
export class UploadModule {}
