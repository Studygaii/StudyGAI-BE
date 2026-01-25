import { Module } from '@nestjs/common';
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
import { PdfModule } from './pdf/pdf.module';
import { AppController } from './app.controller';
import { FlashcardModule } from './flashcard/flashcard.module';
import { GroupChatSchema } from './schemas/groupchat.schema';
import { QuizSchema } from './schemas/quiz.schema';
import { QuizModule } from './quiz/quiz.module';
import { CacheModule } from './cache/cache.module';
import { QdrantModule } from './qdrant/qdrant.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CacheModule,
    MongooseModule.forRoot(process.env.mongoURI || process.env.localURI || ''),
    MongooseModule.forFeature([
      { name: 'users', schema: UserSchema },
      { name: 'courses', schema: CourseSchema },
      { name: 'chats', schema: ChatSchema },
      { name: 'groupchats', schema: GroupChatSchema },
      { name: 'quizzes', schema: QuizSchema },
    ]),
    AuthModule,
    ChatModule,
    CourseModule,
    UploadModule,
    GroqModule,
    PdfModule,
    FlashcardModule,
    QuizModule,
    QdrantModule,
  ],
  controllers: [AppController],
})
export class AppModule { }
