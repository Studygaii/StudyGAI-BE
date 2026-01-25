import { Module } from '@nestjs/common';
import { QdrantService } from './qdrant.service';
import { QdrantController } from './qdrant.controller';

@Module({
  providers: [QdrantService],
  controllers: [QdrantController],
  exports: [QdrantService],
})
export class QdrantModule {}
