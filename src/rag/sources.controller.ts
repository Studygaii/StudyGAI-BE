import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { multerOptions } from '../upload/multer.options';
import { SourcesService } from './sources.service';
import {
  IngestNoteDto,
  IngestUrlDto,
  PresignUploadDto,
  ToggleSourceDto,
} from './dto/ingest-source.dto';

@ApiTags('Notebook Sources (RAG v2)')
@ApiBearerAuth('jwt')
@UseGuards(JwtAuthGuard)
@Controller('api/v1/sources')
export class SourcesController {
  constructor(private readonly sourcesService: SourcesService) {}

  @Post('course/:courseId/upload')
  @UseInterceptors(FilesInterceptor('files', 20, multerOptions))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload up to 20 files to a course notebook with SHA-256 deduplication & async hybrid indexing',
  })
  async uploadFiles(
    @Param('courseId') courseId: string,
    @UploadedFiles() files: Array<Express.Multer.File>,
    @Query('sync') sync: string,
    @Query('mode') mode: 'auto' | 'accurate',
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.user?._id;
    return this.sourcesService.ingestUploadedFiles(courseId, userId, files, {
      sync: sync === 'true',
      mode: mode === 'accurate' ? 'accurate' : 'auto',
    });
  }

  @Post('course/:courseId/presign')
  @ApiOperation({
    summary: 'Get a direct-to-S3/R2/MinIO presigned upload URL (or instant 0ms dedup hit)',
  })
  async presignUpload(
    @Param('courseId') courseId: string,
    @Body() dto: PresignUploadDto,
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.user?._id;
    return this.sourcesService.createPresignedUpload(courseId, userId, dto);
  }

  @Post(':sourceId/confirm')
  @ApiOperation({ summary: 'Confirm direct S3 upload completed and start async RAG indexing' })
  async confirmUpload(@Param('sourceId') sourceId: string, @Req() req: any) {
    const userId = req.user?.id || req.user?._id;
    return this.sourcesService.confirmPresignedUpload(sourceId, userId);
  }

  @Post('course/:courseId/url')
  @ApiOperation({ summary: 'Ingest a public Web page or YouTube lecture URL into a course notebook' })
  async ingestUrl(
    @Param('courseId') courseId: string,
    @Body() dto: IngestUrlDto,
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.user?._id;
    return this.sourcesService.ingestUrl(courseId, userId, dto);
  }

  @Post('course/:courseId/note')
  @ApiOperation({ summary: 'Ingest pasted study notes into a course notebook' })
  async ingestNote(
    @Param('courseId') courseId: string,
    @Body() dto: IngestNoteDto,
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.user?._id;
    return this.sourcesService.ingestNote(courseId, userId, dto);
  }

  @Get('course/:courseId')
  @ApiOperation({ summary: 'List all sources in a course notebook with ingestion status & TOC' })
  async listSources(@Param('courseId') courseId: string, @Req() req: any) {
    const userId = req.user?.id || req.user?._id;
    return this.sourcesService.listCourseSources(courseId, userId);
  }

  @Patch(':sourceId/toggle')
  @ApiOperation({ summary: 'Toggle a source ON/OFF for RAG chat and study tools (NotebookLM checkbox)' })
  async toggleSource(
    @Param('sourceId') sourceId: string,
    @Body() dto: ToggleSourceDto,
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.user?._id;
    return this.sourcesService.toggleSource(sourceId, userId, dto.enabled);
  }

  @Get(':sourceId/passage/:parentIndex')
  @ApiOperation({ summary: 'Inspect exact cited parent passage for click-to-highlight citation UI' })
  async getPassage(
    @Param('sourceId') sourceId: string,
    @Param('parentIndex') parentIndex: string,
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.user?._id;
    return this.sourcesService.getPassage(sourceId, Number(parentIndex) || 0, userId);
  }

  @Delete(':sourceId')
  @ApiOperation({ summary: 'Remove source from course (purges shared blob & vectors only if refCount reaches 0)' })
  async deleteSource(@Param('sourceId') sourceId: string, @Req() req: any) {
    const userId = req.user?.id || req.user?._id;
    return this.sourcesService.deleteSource(sourceId, userId);
  }
}
