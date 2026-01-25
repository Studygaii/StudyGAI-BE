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
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiConsumes, ApiBody } from '@nestjs/swagger';

@ApiTags('Upload')
@ApiBearerAuth('jwt')
@Controller('api/v1/upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('doc')
  // @UseGuards(JwtAuthGuard) // TEMP: Disabled for testing embeddings
  @UseInterceptors(FilesInterceptor('files', 10, multerOptions))
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
  @ApiOperation({ summary: 'Upload document(s) and optionally process PDF' })
  @ApiResponse({ status: 201, description: 'Files uploaded' })
  async doc(
    @UploadedFiles() files: Array<Express.Multer.File>,
    @Query('courseId') courseIdQuery: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    // Get courseId from query parameter (preferred) or body
    const courseId = courseIdQuery || body?.courseId || req.body?.courseId;
    
    console.log('[UploadController] doc() called');
    console.log('[UploadController] Files:', files?.length || 0);
    console.log('[UploadController] courseIdQuery:', courseIdQuery);
    console.log('[UploadController] body.courseId:', body?.courseId);
    console.log('[UploadController] Final courseId:', courseId);
    
    return await this.uploadService.uploadDoc(files, courseId);
  }

  @Get('test')
  @UseGuards(JwtAuthGuard)
  test() {
    return { msg: 'Upload Works!' };
  }
}