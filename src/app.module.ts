import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { CourseModule } from './course/course.module';
import { UploadModule } from './upload/upload.module';
import { GroqModule } from './common/groq.module';
import { UserSchema } from './schemas/user.schema';
import { CourseSchema } from './schemas/course.schema';
import { ChatSchema } from './schemas/chat.schema';
import { SourceBlobSchema } from './schemas/source-blob.schema';
import { CourseSourceSchema } from './schemas/course-source.schema';
import { ParentChunkSchema } from './schemas/parent-chunk.schema';
import { UserMasterySchema } from './schemas/user-mastery.schema';
import { ConceptGraphSchema } from './schemas/concept-graph.schema';
import { StudyArtifactSchema } from './schemas/study-artifact.schema';
import { PdfModule } from './pdf/pdf.module';
import { AppController } from './app.controller';
import { FlashcardModule } from './flashcard/flashcard.module';
import { GroupChatSchema } from './schemas/groupchat.schema';
import { QuizSchema } from './schemas/quiz.schema';
import { QuizModule } from './quiz/quiz.module';
import { CacheModule } from './cache/cache.module';
import { QdrantModule } from './qdrant/qdrant.module';
import { StorageModule } from './storage/storage.module';
import { RagModule } from './rag/rag.module';
import { OpsModule } from './ops/ops.module';
import { MetricsInterceptor } from './ops/metrics.interceptor';
import { RateLimitMiddleware } from './ops/rate-limit.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CacheModule,
    StorageModule,
    OpsModule,
    MongooseModule.forRoot(process.env.mongoURI || process.env.localURI || ''),
    MongooseModule.forFeature([
      { name: 'users', schema: UserSchema },
      { name: 'courses', schema: CourseSchema },
      { name: 'chats', schema: ChatSchema },
      { name: 'groupchats', schema: GroupChatSchema },
      { name: 'quizzes', schema: QuizSchema },
      { name: 'source_blobs', schema: SourceBlobSchema },
      { name: 'course_sources', schema: CourseSourceSchema },
      { name: 'parent_chunks', schema: ParentChunkSchema },
      { name: 'user_masteries', schema: UserMasterySchema },
      { name: 'concept_graphs', schema: ConceptGraphSchema },
      { name: 'study_artifacts', schema: StudyArtifactSchema },
    ]),
    AuthModule,
    QdrantModule,
    RagModule,
    ChatModule,
    CourseModule,
    UploadModule,
    GroqModule,
    PdfModule,
    FlashcardModule,
    QuizModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RateLimitMiddleware).forRoutes('*');
  }
}
