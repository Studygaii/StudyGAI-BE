import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SourceAccessService } from './source-access.service';
import { MasteryService } from './mastery.service';
import { ConceptGraphService } from './concept-graph.service';
import { StudioService } from './studio.service';
import {
  GenerateAudioOverviewDto,
  GenerateConceptGraphDto,
  GenerateExamPredictorDto,
} from './dto/studio.dto';
import { StudyArtifactType } from '../schemas/study-artifact.schema';

@ApiTags('Study Studio & Adaptive Intelligence (Phase 3)')
@ApiBearerAuth('jwt')
@UseGuards(JwtAuthGuard)
@Controller('api/v1/studio')
export class StudioController {
  constructor(
    private readonly sourceAccess: SourceAccessService,
    private readonly masteryService: MasteryService,
    private readonly conceptGraphService: ConceptGraphService,
    private readonly studioService: StudioService,
  ) {}

  @Get('course/:courseId/mastery')
  @ApiOperation({
    summary: 'Get authenticated learner concept mastery profile for a course notebook',
  })
  async getMastery(@Param('courseId') courseId: string, @Req() req: any) {
    const userId = req.user?.id || req.user?._id;
    await this.sourceAccess.assertCourseAccess(courseId, userId);
    const profile = await this.masteryService.getLearnerProfile(userId, courseId);
    return { success: true, data: profile };
  }

  @Get('course/:courseId/concept-graph')
  @ApiOperation({
    summary: 'Get persisted Concept Knowledge Graph (enriched with live user mastery scores)',
  })
  async getConceptGraph(@Param('courseId') courseId: string, @Req() req: any) {
    const userId = req.user?.id || req.user?._id;
    await this.sourceAccess.assertCourseAccess(courseId, userId);
    const graph = await this.conceptGraphService.getGraph(courseId, userId);
    return { success: true, data: graph };
  }

  @Post('course/:courseId/concept-graph/generate')
  @ApiOperation({
    summary: 'Generate or refresh GraphRAG Concept Knowledge Graph & Interactive Mind Map',
  })
  async generateConceptGraph(
    @Param('courseId') courseId: string,
    @Body() dto: GenerateConceptGraphDto,
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.user?._id;
    await this.sourceAccess.assertCourseAccess(courseId, userId);
    const graph = await this.conceptGraphService.generateGraph(courseId, userId, dto);
    return { success: true, data: graph };
  }

  @Post('course/:courseId/audio-overview')
  @ApiOperation({
    summary: 'Generate a 2-host NotebookLM-style Audio Overview podcast script grounded in active sources',
  })
  async generateAudioOverview(
    @Param('courseId') courseId: string,
    @Body() dto: GenerateAudioOverviewDto,
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.user?._id;
    await this.sourceAccess.assertCourseAccess(courseId, userId);
    return this.studioService.generateAudioOverview(courseId, userId, dto);
  }

  @Post('course/:courseId/exam-predictor')
  @ApiOperation({
    summary: 'Generate a Mastery-Weighted High-Yield Exam Forecast across active notebook sources',
  })
  async generateExamPredictor(
    @Param('courseId') courseId: string,
    @Body() dto: GenerateExamPredictorDto,
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.user?._id;
    await this.sourceAccess.assertCourseAccess(courseId, userId);
    return this.studioService.generateExamPredictor(courseId, userId, dto);
  }

  @Get('course/:courseId/artifacts')
  @ApiOperation({
    summary: 'List saved Study Studio artifacts (audio_overview, exam_predictor, study_guide)',
  })
  async listArtifacts(
    @Param('courseId') courseId: string,
    @Query('type') type: StudyArtifactType,
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.user?._id;
    await this.sourceAccess.assertCourseAccess(courseId, userId);
    return this.studioService.listArtifacts(courseId, type);
  }
}
