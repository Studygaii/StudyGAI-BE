import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Param,
  Logger,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { QdrantService } from './qdrant.service';
import { SourceAccessService } from '../rag/source-access.service';
import { CourseSourceDocument } from '../schemas/course-source.schema';

@ApiTags('Vector Search')
@ApiBearerAuth('jwt')
@Controller('api/v1/vector')
export class QdrantController {
  private readonly logger = new Logger(QdrantController.name);

  constructor(
    private readonly qdrantService: QdrantService,
    private readonly sourceAccess: SourceAccessService,
    @InjectModel('course_sources')
    private readonly courseSourceModel: Model<CourseSourceDocument>,
  ) {}

  @Get('/health')
  @ApiOperation({ summary: 'Check Qdrant database health' })
  async healthCheck() {
    try {
      const isHealthy = await this.qdrantService.health();
      return {
        status: isHealthy ? 'healthy' : 'unhealthy',
        service: 'qdrant',
        collection: this.qdrantService.getDefaultCollection(),
      };
    } catch (error: any) {
      return {
        status: 'error',
        service: 'qdrant',
        error: error.message,
      };
    }
  }

  @Post('/search')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Hybrid dense + sparse + reranked search across authorized course sources',
  })
  async searchChunks(
    @Query('query') query: string,
    @Query('courseId') courseId: string,
    @Query('limit') limit = 8,
    @Req() req: any,
  ) {
    if (!query || !courseId) {
      return {
        status: 'error',
        error: 'query and courseId query parameters are required',
      };
    }

    const userId = req.user?.id || req.user?._id;
    await this.sourceAccess.assertCourseAccess(courseId, userId);

    const activeSources = await this.courseSourceModel
      .find({ course: new Types.ObjectId(courseId), enabled: true, status: 'ready' })
      .select('blob')
      .lean();
    const blobIds = activeSources.map((s: any) => s.blob?.toString()).filter(Boolean);

    const parsedLimit = Math.min(30, Math.max(1, Number(limit) || 8));
    const results = await this.qdrantService.hybridSearch({
      query,
      blobIds: blobIds.length > 0 ? blobIds : undefined,
      courseId,
      limit: Math.max(parsedLimit * 3, 24),
      rerankTopK: parsedLimit,
    });

    return {
      status: 'success',
      query,
      courseId,
      results,
      count: results.length,
    };
  }

  @Get('/course/:courseId/chunks')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get indexed chunks for an authorized course' })
  async getChunks(
    @Param('courseId') courseId: string,
    @Query('limit') limit = 15,
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.user?._id;
    await this.sourceAccess.assertCourseAccess(courseId, userId);

    const sources = await this.courseSourceModel
      .find({ course: new Types.ObjectId(courseId), status: 'ready' })
      .select('blob')
      .lean();
    const blobIds = sources.map((s: any) => s.blob?.toString()).filter(Boolean);

    const chunks = await this.qdrantService.getCourseChunks(
      courseId,
      blobIds.length > 0 ? blobIds : undefined,
      Math.min(100, Math.max(1, Number(limit) || 15)),
    );
    return {
      status: 'success',
      courseId,
      chunks,
      count: chunks.length,
    };
  }

  @Get('/course/:courseId/stats')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get vector indexing statistics for an authorized course' })
  async getStats(@Param('courseId') courseId: string, @Req() req: any) {
    const userId = req.user?.id || req.user?._id;
    await this.sourceAccess.assertCourseAccess(courseId, userId);

    const sources = await this.courseSourceModel
      .find({ course: new Types.ObjectId(courseId), status: 'ready' })
      .select('blob')
      .lean();
    const blobIds = sources.map((s: any) => s.blob?.toString()).filter(Boolean);

    const stats = await this.qdrantService.getEmbeddingStats(
      courseId,
      blobIds.length > 0 ? blobIds : undefined,
    );
    return { status: 'success', stats };
  }

  @Delete('/course/:courseId/chunks')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Delete legacy course-scoped chunks (course owner only)' })
  async deleteChunks(@Param('courseId') courseId: string, @Req() req: any) {
    const userId = req.user?.id || req.user?._id;
    await this.sourceAccess.assertCourseAccess(courseId, userId, true);

    const success = await this.qdrantService.deleteCoursChunks(courseId);
    return { status: 'success', courseId, deleted: success };
  }

  @Get('/global-search')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Search across ALL courses owned by the authenticated user' })
  async globalSearch(
    @Query('query') query: string,
    @Query('limit') limit = 10,
    @Req() req: any,
  ) {
    if (!query) {
      return { status: 'error', error: 'query parameter is required' };
    }

    const userId = req.user?.id || req.user?._id;
    const userSources = await this.courseSourceModel
      .find({ addedBy: new Types.ObjectId(userId), enabled: true, status: 'ready' })
      .select('blob')
      .limit(200)
      .lean();
    const blobIds = Array.from(
      new Set(userSources.map((s: any) => s.blob?.toString()).filter(Boolean)),
    );

    if (blobIds.length === 0) {
      return { status: 'success', query, results: [], count: 0 };
    }

    const parsedLimit = Math.min(30, Math.max(1, Number(limit) || 10));
    const results = await this.qdrantService.hybridSearch({
      query,
      blobIds,
      limit: Math.max(parsedLimit * 3, 30),
      rerankTopK: parsedLimit,
    });

    return {
      status: 'success',
      query,
      results,
      count: results.length,
    };
  }
}
