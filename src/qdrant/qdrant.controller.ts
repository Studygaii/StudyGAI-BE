import { Controller, Get, Post, Delete, Query, Param, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { QdrantService } from './qdrant.service';

@ApiTags('Vector Search')
@Controller('api/v1/vector')
export class QdrantController {
  private readonly logger = new Logger(QdrantController.name);

  constructor(private readonly qdrantService: QdrantService) {}

  @Get('/health')
  @ApiOperation({ summary: 'Check Qdrant database health' })
  async healthCheck() {
    try {
      const isHealthy = await this.qdrantService.health();
      return {
        status: isHealthy ? 'healthy' : 'unhealthy',
        service: 'qdrant',
      };
    } catch (error) {
      return {
        status: 'error',
        service: 'qdrant',
        error: error.message,
      };
    }
  }

  @Post('/search')
  @ApiOperation({
    summary: 'Search for similar PDF chunks based on query',
    description:
      'Searches the vector database for chunks similar to the provided query within a specific course',
  })
  async searchChunks(
    @Query('query') query: string,
    @Query('courseId') courseId: string,
    @Query('limit') limit: number = 5,
  ) {
    if (!query || !courseId) {
      return {
        status: 'error',
        error: 'query and courseId query parameters are required',
      };
    }

    try {
      const results = await this.qdrantService.searchSimilarChunks(
        query,
        courseId,
        limit,
      );
      return {
        status: 'success',
        query,
        courseId,
        results,
        count: results.length,
      };
    } catch (error) {
      this.logger.error(`Search failed: ${error.message}`);
      return {
        status: 'error',
        error: error.message,
      };
    }
  }

  @Get('/course/:courseId/chunks')
  @ApiOperation({
    summary: 'Get all chunks for a course',
    description: 'Retrieves all stored PDF chunks associated with a specific course',
  })
  async getChunks(
    @Param('courseId') courseId: string,
    @Query('limit') limit: number = 10,
  ) {
    try {
      const chunks = await this.qdrantService.getCoursChunks(courseId, limit);
      return {
        status: 'success',
        courseId,
        chunks,
        count: chunks.length,
      };
    } catch (error) {
      this.logger.error(`Get chunks failed: ${error.message}`);
      return {
        status: 'error',
        error: error.message,
      };
    }
  }

  @Get('/course/:courseId/stats')
  @ApiOperation({
    summary: 'Get embedding statistics for a course',
    description: 'Returns metadata about stored embeddings for a course',
  })
  async getStats(@Param('courseId') courseId: string) {
    try {
      const stats = await this.qdrantService.getEmbeddingStats(courseId);
      return {
        status: 'success',
        stats,
      };
    } catch (error) {
      this.logger.error(`Get stats failed: ${error.message}`);
      return {
        status: 'error',
        error: error.message,
      };
    }
  }

  @Delete('/course/:courseId/chunks')
  @ApiOperation({
    summary: 'Delete all chunks for a course',
    description: 'Removes all stored PDF chunks associated with a specific course',
  })
  async deleteChunks(@Param('courseId') courseId: string) {
    try {
      const success = await this.qdrantService.deleteCoursChunks(courseId);
      return {
        status: 'success',
        courseId,
        deleted: success,
      };
    } catch (error) {
      this.logger.error(`Delete chunks failed: ${error.message}`);
      return {
        status: 'error',
        error: error.message,
      };
    }
  }

  @Get('/global-search')
  @ApiOperation({
    summary: 'Global search across all chunks',
    description:
      'Performs a semantic search across all stored chunks in the database',
  })
  async globalSearch(
    @Query('query') query: string,
    @Query('limit') limit: number = 10,
  ) {
    if (!query) {
      return {
        status: 'error',
        error: 'query parameter is required',
      };
    }

    try {
      const results = await this.qdrantService.searchGlobal(query, limit);
      return {
        status: 'success',
        query,
        results,
        count: results.length,
      };
    } catch (error) {
      this.logger.error(`Global search failed: ${error.message}`);
      return {
        status: 'error',
        error: error.message,
      };
    }
  }
}
