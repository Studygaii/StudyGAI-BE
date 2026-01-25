import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FlashcardController } from './flashcard.controller';
import { FlashcardService } from './flashcard.service';
import { CourseSchema } from '../schemas/course.schema';
import { GroqModule } from '../common/groq.module';
import { QdrantModule } from '../qdrant/qdrant.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'courses', schema: CourseSchema }, // operate on Course model
    ]),
    GroqModule, // add Groq for flashcard generation
    QdrantModule, // add Qdrant for vector search context
  ],
  providers: [FlashcardService],
  controllers: [FlashcardController],
  exports: [FlashcardService],
})
export class FlashcardModule {}
