// src/chat/chat.controller.ts
import { Controller, Get, Post, Delete, Body, Req, Param, UseGuards, Res } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatService } from './chat.service';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { CreateChatDto } from './dto/create-chat.dto';
import { SendMessagesWithCourseDto } from './dto/send-messages-with-course.dto';
import { RagOrchestratorService } from '../rag/rag-orchestrator.service';

@ApiTags('Chat')
@ApiBearerAuth('jwt')
@Controller('api/v1/chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly ragOrchestrator: RagOrchestratorService,
  ) {}

  @Get('test')
  @UseGuards(JwtAuthGuard)
  test() {
    return { msg: 'Chat Works!' };
  }

  @Get('list/:courseID')
  @UseGuards(JwtAuthGuard)
  async list(@Param('courseID') courseID: string, @Req() req: any) {
    return await this.chatService.list(courseID, req.user?.id);
  }

  @Post('new')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create new chat' })
  @ApiResponse({ status: 201, description: 'Chat created' })
  async create(@Body() body: CreateChatDto, @Req() req: any) {
    const userId = req.user?.id || req.user?._id;
    return await this.chatService.create({ ...body, creator: body.creator || userId });
  }

  @Delete('delete/:id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Delete a chat' })
  @ApiResponse({ status: 200, description: 'Chat deleted' })
  async remove(@Param('id') id: string, @Req() req: any) {
    return await this.chatService.remove(id, req.user?.id);
  }

  @Post('send')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Send messages with Hybrid RAG grounding, selective sources, and inline citations',
  })
  @ApiResponse({ status: 200, description: 'Grounded AI response with verified citations returned' })
  async send(@Body() body: SendMessagesWithCourseDto, @Req() req: any) {
    const userId = req.user?.id || req.user?._id;
    return await this.chatService.send(body.messages, body.courseId, {
      userId,
      sourceIds: body.sourceIds,
      mode: body.mode,
    });
  }

  @Post('send-stream')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Stream grounded RAG response over SSE with citation metadata',
  })
  @ApiResponse({ status: 200, description: 'Streaming response started' })
  async sendStream(
    @Body() body: SendMessagesWithCourseDto,
    @Req() req: any,
    @Res() res: Response,
  ) {
    try {
      const userId = req.user?.id || req.user?._id;
      const ragStream = await this.chatService.sendStream(body.messages, body.courseId, {
        userId,
        sourceIds: body.sourceIds,
        mode: body.mode,
      });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Send retrieval strategy, adaptive/graph signals & candidate citations upfront
      res.write(
        `data: ${JSON.stringify({
          type: 'meta',
          strategy: ragStream.strategy,
          rewrittenQuery: ragStream.rewrittenQuery,
          sourcesSearched: ragStream.sourcesSearched,
          graphExpandedConcepts: ragStream.graphExpandedConcepts,
          adaptiveMastery: ragStream.adaptiveMastery,
          citations: ragStream.citations,
        })}\n\n`,
      );

      let fullContent = '';
      for await (const delta of ragStream.stream) {
        if (delta) {
          fullContent += delta;
          res.write(`data: ${JSON.stringify({ type: 'token', content: delta })}\n\n`);
        }
      }

      // Send final verified citations marking which [n] indices appeared in the generated answer
      const verifiedCitations = this.ragOrchestrator.markCitedReferences(
        fullContent,
        ragStream.citations,
      );
      res.write(
        `data: ${JSON.stringify({ type: 'citations', citations: verifiedCitations })}\n\n`,
      );

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(error?.status || 500).json({ error: error.message });
      } else {
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
        res.end();
      }
    }
  }

  @Get('with-course/:chatId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get chat with course info' })
  async getChatWithCourse(@Param('chatId') chatId: string, @Req() req: any) {
    return await this.chatService.getChatWithCourse(chatId, req.user?.id);
  }
}
