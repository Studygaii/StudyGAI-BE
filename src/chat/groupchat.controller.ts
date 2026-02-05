import { Controller, Get, Post, Delete, Put, Body, Req, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GroupChatService } from './groupchat.service';
import { ChatService } from './chat.service';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { CreateGroupChatDto, AddMemberDto, RemoveMemberDto, SendGroupMessageDto } from './dto/create-groupchat.dto';

@ApiTags('Group Chat')
@ApiBearerAuth('jwt')
@Controller('api/v1/groupchat')
export class GroupChatController {
  constructor(
    private readonly groupChatService: GroupChatService,
    private readonly chatService: ChatService,
  ) {}

  @Post('create')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create a new group chat' })
  async create(@Body() body: CreateGroupChatDto) {
    return await this.groupChatService.create(body);
  }

  @Get('list/:courseID')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List all group chats in a course' })
  async list(@Param('courseID') courseID: string, @Req() req: any) {
    return await this.groupChatService.list(courseID, req.user?.id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get group chat details' })
  async getById(@Param('id') id: string, @Req() req: any) {
    return await this.groupChatService.getById(id, req.user?.id);
  }

  @Post('add-member')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Add member to group chat' })
  async addMember(@Body() body: AddMemberDto) {
    return await this.groupChatService.addMember(body);
  }

  @Post('remove-member')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Remove member from group chat' })
  async removeMember(@Body() body: RemoveMemberDto) {
    return await this.groupChatService.removeMember(body);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update group chat' })
  async update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return await this.groupChatService.updateGroupChat(id, req.user?.id, body);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Delete group chat' })
  async delete(@Param('id') id: string, @Req() req: any) {
    return await this.groupChatService.deleteGroupChat(id, req.user?.id);
  }

  @Post(':id/send-message')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Send message to group chat. Use @studygai in message to trigger AI response.' })
  @ApiBody({ schema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } })
  async sendMessage(
    @Param('id') groupChatId: string,
    @Body() body: { message: string },
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.user?._id;
    const { message } = body;

    const result = await this.groupChatService.getById(groupChatId, userId);
    if ((result as any).status === 404 || (result as any).status === 403) {
      return result;
    }

    const gc = (result as any).groupChat;
    const courseId = gc?.course?._id?.toString() || gc?.course?.toString();

    await this.groupChatService.addMessage(groupChatId, {
      role: 'user',
      content: message,
      sender: userId,
      senderName: req.user?.username || 'User',
      date: new Date(),
    });

    const hasMention = /@studygai/i.test(message);
    if (hasMention && courseId) {
      const query = message.replace(/@studygai\s*/gi, '').trim() || message;
      const messages = [{ role: 'user' as const, content: query }];
      const response = await this.chatService.sendWithContext(messages, courseId);
      const aiContent = response?.choices?.[0]?.message?.content || response?.message || 'No response';

      await this.groupChatService.addMessage(groupChatId, {
        role: 'assistant',
        content: aiContent,
        senderName: 'StudyGAI',
        date: new Date(),
        isAI: true,
      });

      return {
        message: 'Message sent and StudyGAI responded',
        userMessage: message,
        aiResponse: aiContent,
      };
    }

    return { message: 'Message sent successfully' };
  }
}
