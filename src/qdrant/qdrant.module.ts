import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { QdrantService } from './qdrant.service';
import { QdrantController } from './qdrant.controller';
import { SparseEncoderService } from '../rag/sparse-encoder.service';
import { SourceAccessService } from '../rag/source-access.service';
import { CourseSchema } from '../schemas/course.schema';
import { GroupChatSchema } from '../schemas/groupchat.schema';
import { CourseSourceSchema } from '../schemas/course-source.schema';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: 'courses', schema: CourseSchema },
      { name: 'groupchats', schema: GroupChatSchema },
      { name: 'course_sources', schema: CourseSourceSchema },
    ]),
  ],
  providers: [QdrantService, SparseEncoderService, SourceAccessService],
  controllers: [QdrantController],
  exports: [QdrantService, SparseEncoderService, SourceAccessService],
})
export class QdrantModule {}
