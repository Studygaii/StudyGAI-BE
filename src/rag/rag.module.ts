import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { SourceBlobSchema } from '../schemas/source-blob.schema';
import { CourseSourceSchema } from '../schemas/course-source.schema';
import { ParentChunkSchema } from '../schemas/parent-chunk.schema';
import { CourseSchema } from '../schemas/course.schema';
import { GroupChatSchema } from '../schemas/groupchat.schema';
import { UserMasterySchema } from '../schemas/user-mastery.schema';
import { ConceptGraphSchema } from '../schemas/concept-graph.schema';
import { StudyArtifactSchema } from '../schemas/study-artifact.schema';
import { QdrantModule } from '../qdrant/qdrant.module';
import { GroqModule } from '../common/groq.module';
import { ChunkerService } from './chunker.service';
import { IngestionProcessor } from './ingestion.processor';
import { SourcesService } from './sources.service';
import { SourcesController } from './sources.controller';
import { RagOrchestratorService } from './rag-orchestrator.service';
import { MasteryService } from './mastery.service';
import { ConceptGraphService } from './concept-graph.service';
import { StudioService } from './studio.service';
import { StudioController } from './studio.controller';
import { VectorTieringService } from './vector-tiering.service';

@Module({
  imports: [
    ConfigModule,
    QdrantModule,
    GroqModule,
    MongooseModule.forFeature([
      { name: 'source_blobs', schema: SourceBlobSchema },
      { name: 'course_sources', schema: CourseSourceSchema },
      { name: 'parent_chunks', schema: ParentChunkSchema },
      { name: 'courses', schema: CourseSchema },
      { name: 'groupchats', schema: GroupChatSchema },
      { name: 'user_masteries', schema: UserMasterySchema },
      { name: 'concept_graphs', schema: ConceptGraphSchema },
      { name: 'study_artifacts', schema: StudyArtifactSchema },
    ]),
  ],
  controllers: [SourcesController, StudioController],
  providers: [
    ChunkerService,
    IngestionProcessor,
    SourcesService,
    MasteryService,
    ConceptGraphService,
    StudioService,
    VectorTieringService,
    RagOrchestratorService,
  ],
  exports: [
    ChunkerService,
    IngestionProcessor,
    SourcesService,
    MasteryService,
    ConceptGraphService,
    StudioService,
    VectorTieringService,
    RagOrchestratorService,
  ],
})
export class RagModule {}
