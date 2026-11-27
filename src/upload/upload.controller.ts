// src/upload/upload.controller.ts
import {
  Controller,
  Post,
  UseGuards,
  Get,
  UseInterceptors,
  UploadedFiles,
  Body,
  Req,
  Query,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { multerOptions } from './multer.options';
import { UploadService } from './upload.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';

@ApiTags('Upload')
@ApiBearerAuth('jwt')
@Controller('api/v1/upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('doc')
  @UseGuards(JwtAuthGuard)
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
        courseId: {
          type: 'string',
          example: '673c5e8f9a1b2c3d4e5f6789',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload document(s) to a course with SHA-256 deduplication and Hybrid RAG indexing',
  })
  @ApiResponse({ status: 201, description: 'Files uploaded and queued/processed' })
  async doc(
    @UploadedFiles() files: Array<Express.Multer.File>,
    @Query('courseId') courseIdQuery: string,
    @Query('sync') syncQuery: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const courseId = courseIdQuery || body?.courseId || req.body?.courseId;
    const userId = req.user?.id || req.user?._id;
    const sync = syncQuery === 'true';

    return await this.uploadService.uploadDoc(files, courseId, userId, { sync });
  }

  @Get('test')
  @UseGuards(JwtAuthGuard)
  test() {
    return { msg: 'Upload Works!' };
  }
}
