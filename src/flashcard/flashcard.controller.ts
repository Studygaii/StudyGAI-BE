import { Controller, Get, Post, Delete, Put, Body, Req, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FlashcardService } from './flashcard.service';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody, ApiResponse } from '@nestjs/swagger';
import { CreateFlashcardDto, ReviewFlashcardDto, GenerateFlashcardsDto } from './dto/create-flashcard.dto';

@ApiTags('Flashcards')
@ApiBearerAuth('jwt')
@Controller('api/v1/flashcards')
export class FlashcardController {
  constructor(private readonly flashcardService: FlashcardService) {}

  @Post('create')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create flashcards for a course' })
  @ApiBody({
    type: CreateFlashcardDto,
    examples: {
      example1: {
        summary: 'React Hooks Batch',
        value: {
          title: 'React Hooks Batch 1',
          creator: '507f1f77bcf86cd799439011',
          course: '507f1f77bcf86cd799439012',
          cards: [
            {
              front: 'What is useState used for?',
              back: 'useState allows you to add state to functional components.',
              tags: ['hooks', 'state', 'beginner'],
              easeFactor: 2.5,
              interval: 0,
            },
            {
              front: 'Explain useEffect dependency array',
              back: 'The dependency array tells useEffect when to run the effect.',
              tags: ['hooks', 'effects', 'intermediate'],
              easeFactor: 2.5,
              interval: 0,
            },
          ],
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Flashcards created' })
  async create(@Body() body: CreateFlashcardDto, @Req() req: any) {
    const userId = req.user?.id || req.user?._id;
    return await this.flashcardService.create({ ...body, creator: body.creator || userId });
  }

  @Get('list/:courseID')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List all flashcards for a course' })
  @ApiResponse({ status: 200, description: 'Flashcards retrieved' })
  async list(@Param('courseID') courseID: string, @Req() req: any) {
    return await this.flashcardService.list(courseID, req.user?.id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get flashcards for a course' })
  @ApiResponse({ status: 200, description: 'Flashcards retrieved' })
  async getById(@Param('id') id: string, @Req() req: any) {
    return await this.flashcardService.getById(id, req.user?.id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update flashcards for a course (replace entire array)' })
  @ApiBody({
    type: CreateFlashcardDto,
    examples: {
      example1: {
        summary: 'Replace all flashcards',
        value: {
          title: 'Updated Batch',
          creator: '507f1f77bcf86cd799439011',
          course: '507f1f77bcf86cd799439012',
          cards: [
            {
              front: 'Updated question',
              back: 'Updated answer',
              tags: ['updated'],
              easeFactor: 2.5,
              interval: 0,
            },
          ],
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Flashcards updated' })
  async update(@Param('id') id: string, @Body() body: CreateFlashcardDto, @Req() req: any) {
    return await this.flashcardService.update(id, req.user?.id, body);
  }

  @Post(':id/review')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Review a flashcard (Anki-style rating)' })
  @ApiBody({
    type: ReviewFlashcardDto,
    examples: {
      again: {
        summary: 'Card forgotten (1 day interval)',
        value: {
          cardIndex: 0,
          difficulty: 'Again',
        },
      },
      hard: {
        summary: 'Card difficult (slower interval growth)',
        value: {
          cardIndex: 0,
          difficulty: 'Hard',
        },
      },
      good: {
        summary: 'Card correct (normal interval growth)',
        value: {
          cardIndex: 0,
          difficulty: 'Good',
        },
      },
      easy: {
        summary: 'Card very easy (fast interval growth)',
        value: {
          cardIndex: 0,
          difficulty: 'Easy',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Card reviewed and scheduled' })
  async reviewCard(
    @Param('id') id: string,
    @Body() body: ReviewFlashcardDto,
    @Req() req: any,
  ) {
    return await this.flashcardService.reviewCard(id, req.user?.id, body.cardIndex, body.difficulty);
  }

  @Delete(':id/:cardIndexOrId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Delete a flashcard by index or ID' })
  @ApiResponse({ status: 200, description: 'Flashcard deleted' })
  async delete(@Param('id') id: string, @Param('cardIndexOrId') cardIndexOrId: any, @Req() req: any) {
    return await this.flashcardService.delete(id, req.user?.id, cardIndexOrId);
  }

  @Get('due/:courseID/:userID')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get due flashcards for study (spaced repetition)' })
  @ApiResponse({ status: 200, description: 'Due flashcards returned' })
  async getDue(
    @Param('courseID') courseID: string,
    @Param('userID') userID: string,
    @Req() req: any,
  ) {
    return await this.flashcardService.getDueForUser(courseID, userID || req.user?.id);
  }

  @Post(':courseId/generate-from-pdf')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Generate flashcards from course PDF using AI' })
  @ApiBody({
    type: GenerateFlashcardsDto,
    examples: {
      example1: {
        summary: 'Generate flashcards for entire PDF',
        value: {},
      },
      example2: {
        summary: 'Generate flashcards for specific topic',
        value: {
          topic: 'Chapter 3: State Management',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Flashcards generated and saved',
    schema: {
      example: {
        message: 'Flashcards generated and saved successfully',
        count: 12,
        courseId: '507f1f77bcf86cd799439012',
        flashcards: [
          {
            front: 'What is state in React?',
            back: 'State is data that a component manages...',
            tags: ['state', 'ai-generated'],
            easeFactor: 2.5,
            interval: 0,
          },
        ],
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'No PDF content found or generation failed',
  })
  async generateFromPDF(
    @Param('courseId') courseId: string,
    @Body() body: GenerateFlashcardsDto,
    @Req() req: any,
  ) {
    return await this.flashcardService.generateFromPDF(courseId, req.user?.id, body.topic);
  }
}
