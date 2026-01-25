import { IsString, IsArray, IsOptional, IsMongoId, IsNumber, IsDate } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Individual flashcard item DTO
 * Represents a single front/back card with spaced-repetition fields
 * Used in both manual creation and AI generation responses
 */
export class FlashcardItemDto {
  @ApiProperty({
    example: 'What is photosynthesis?',
    description: 'Front side of the flashcard (question/prompt)',
  })
  @IsString()
  front: string;

  @ApiProperty({
    example: 'Process by which plants convert light energy into chemical energy',
    description: 'Back side of the flashcard (answer)',
  })
  @IsString()
  back: string;

  @ApiPropertyOptional({
    example: ['biology', 'chapter-1', 'photosynthesis'],
    description: 'Tags to categorize the card',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    example: 2.5,
    description: 'Ease factor for spaced repetition (Anki default: 2.5)',
  })
  @IsOptional()
  @IsNumber()
  easeFactor?: number;

  @ApiPropertyOptional({
    example: 0,
    description: 'Interval between reviews in days',
  })
  @IsOptional()
  @IsNumber()
  interval?: number;

  @ApiPropertyOptional({
    example: null,
    description: 'Due date for next review (ISO 8601 format)',
  })
  @IsOptional()
  @IsDate()
  dueDate?: Date;
}

/**
 * DTO for MANUALLY creating flashcards in a course
 * User provides all card details (front, back, tags, etc.)
 *
 * Example use case: Student manually types in flashcards
 * Request body includes: creator, course, and array of cards
 */
export class CreateFlashcardDto {
  @ApiProperty({
    example: 'React Hooks Batch 1',
    description: 'Optional title/label for this batch of flashcards',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'User ID of the flashcard creator (from JWT token)',
  })
  @IsMongoId()
  creator: string;

  @ApiProperty({
    example: '507f1f77bcf86cd799439012',
    description: 'Course ID where flashcards will be stored',
  })
  @IsMongoId()
  course: string;

  @ApiProperty({
    type: [FlashcardItemDto],
    description: 'Array of flashcard items to create (you define each card)',
    example: [
      {
        front: 'What is useState?',
        back: 'A React Hook for state management',
        tags: ['hooks', 'react'],
        easeFactor: 2.5,
        interval: 0,
      },
    ],
  })
  @IsArray()
  cards: FlashcardItemDto[];
}

/**
 * DTO for AI-GENERATED flashcards from PDF
 * User only specifies optional topic; AI creates all card details
 *
 * Example use case: "@studyGAI make flashcards on Chapter 3"
 * Request body is minimal: just optional topic
 * AI generates front/back/tags automatically
 */
export class GenerateFlashcardsDto {
  @ApiPropertyOptional({
    example: 'Chapter 3: State Management',
    description: 'Optional: specify a topic/chapter to focus AI generation on. If omitted, AI analyzes entire PDF.',
  })
  @IsOptional()
  @IsString()
  topic?: string;
}

/**
 * DTO for reviewing a flashcard
 * Anki-style ratings: Again (forgot) / Hard / Good / Easy
 */
export class ReviewFlashcardDto {
  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439012',
    description: 'Course ID (optional, kept for compatibility)',
  })
  @IsOptional()
  @IsMongoId()
  flashcardId?: string;

  @ApiProperty({
    example: 0,
    description: 'Index of the card in course.flashcards[] array (0-based)',
  })
  @IsNumber()
  cardIndex: number;

  @ApiProperty({
    enum: ['Again', 'Hard', 'Good', 'Easy'],
    example: 'Good',
    description: 'User rating for spaced repetition algorithm',
  })
  @IsString()
  difficulty: 'Again' | 'Hard' | 'Good' | 'Easy';
}
