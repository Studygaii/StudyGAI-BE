// src/pdf/pdf.controller.ts
import { Controller, Post, Get, Body, Param, UseGuards, Req, UseInterceptors, UploadedFile } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PdfService } from './pdf.service';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { ProcessPdfDto } from './dto/process-pdf.dto';
import { SavePdfContentDto } from './dto/save-pdf-content.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { multerOptions } from '../upload/multer.options';
import { SourceAccessService } from '../rag/source-access.service';

@ApiTags('PDF')
@ApiBearerAuth('jwt')
@Controller('api/v1/pdf')
export class PdfController {
  constructor(
    private readonly pdfService: PdfService,
    private readonly sourceAccess: SourceAccessService,
  ) {}

  @Get('test')
  @UseGuards(JwtAuthGuard)
  test() {
    return { msg: 'PDF Service Works!' };
  }

  @Post('process/:courseId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Process PDF for a course' })
  @ApiResponse({ status: 200, description: 'PDF processed successfully' })
  async processPdf(
    @Param('courseId') courseId: string,
    @Body() body: ProcessPdfDto,
    @Req() req: any,
  ) {
    await this.sourceAccess.assertCourseAccess(courseId, req.user?.id || req.user?._id);
    return await this.pdfService.processFileForCourse(courseId, body.filePath);
  }

  @Post('process/:courseId/upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', multerOptions))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({ summary: 'Upload and process PDF for a course' })
  @ApiResponse({ status: 200, description: 'PDF uploaded and processed successfully' })
  async processPdfUpload(
    @Param('courseId') courseId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    if (!file) {
      return { status: 400, error: 'No file uploaded' };
    }
    await this.sourceAccess.assertCourseAccess(courseId, req.user?.id || req.user?._id);
    return await this.pdfService.processFileForCourse(courseId, file.path);
  }

  @Get('content/:courseId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get PDF content for a course' })
  @ApiResponse({ status: 200, description: 'PDF content retrieved' })
  async getContent(@Param('courseId') courseId: string, @Req() req: any) {
    await this.sourceAccess.assertCourseAccess(courseId, req.user?.id || req.user?._id);
    try {
      const content = await this.pdfService.getPdfContent(courseId);
      if (!content) {
        return { status: 404, error: 'No PDF content found for this course' };
      }
      return {
        message: 'success',
        courseId,
        contentLength: content.length,
        preview: content.substring(0, 500) + '...', // Preview of content
      };
    } catch (error) {
      return { status: 500, error: error.message };
    }
  }

  @Post('extract')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Extract text from PDF file' })
  @ApiResponse({ status: 200, description: 'Text extracted successfully' })
  async extractText(@Body() body: ProcessPdfDto, @Req() req: any) {
    try {
      const text = await this.pdfService.extractTextFromPDF(body.filePath);
      return {
        message: 'Text extracted successfully',
        textLength: text.length,
        preview: text.substring(0, 500) + '...',
      };
    } catch (error) {
      return { status: 500, error: error.message };
    }
  }

  @Post('save-content')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Save extracted PDF content to course' })
  @ApiResponse({ status: 200, description: 'Content saved successfully' })
  async saveContent(
    @Body() body: SavePdfContentDto,
    @Req() req: any,
  ) {
    await this.sourceAccess.assertCourseAccess(body.courseId, req.user?.id || req.user?._id);
    return await this.pdfService.savePdfContent(body.courseId, body.pdfText);
  }
}