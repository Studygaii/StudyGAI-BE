import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { QuizService } from './quiz.service';
import { GenerateQuizDto } from './dto/generate-quiz.dto';
import { SubmitQuizDto } from './dto/submit-quiz.dto';
import { SourceAccessService } from '../rag/source-access.service';
import { QuizType } from '../schemas/quiz.schema';

@ApiTags('Quiz')
@ApiBearerAuth('jwt')
@Controller('api/v1/quiz')
export class QuizController {
  constructor(
    private readonly quizService: QuizService,
    private readonly sourceAccess: SourceAccessService,
  ) {}

  @Get('course/:courseId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List all quizzes or exams generated for a course' })
  async listByCourse(
    @Param('courseId') courseId: string,
    @Query('type') quizType: QuizType,
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.user?._id;
    await this.sourceAccess.assertCourseAccess(courseId, userId);
    return this.quizService.listByCourse(courseId, quizType);
  }

  @Post('generate/:courseId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Generate a quiz or exam from course content' })
  async generate(
    @Param('courseId') courseId: string,
    @Body() body: GenerateQuizDto,
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.user?._id;
    await this.sourceAccess.assertCourseAccess(courseId, userId);
    return this.quizService.generateQuiz(courseId, userId, {
      numQuestions: body.numQuestions ?? 8,
      quizType: body.quizType || 'quiz',
      title: body.title,
      groupId: body.groupId,
    });
  }

  @Get(':quizId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get quiz (without answer key)' })
  async getQuiz(@Param('quizId') quizId: string) {
    return this.quizService.getQuiz(quizId);
  }

  @Post(':quizId/submit')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Submit quiz/exam answers' })
  @ApiBody({ type: SubmitQuizDto })
  async submit(
    @Param('quizId') quizId: string,
    @Body() body: SubmitQuizDto,
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.user?._id;
    return this.quizService.submit(quizId, userId, body.answers || []);
  }

  @Get(':quizId/leaderboard')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get leaderboard for quiz (group ranking)' })
  async leaderboard(@Param('quizId') quizId: string) {
    return this.quizService.leaderboard(quizId);
  }
}
