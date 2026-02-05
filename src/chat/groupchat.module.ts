import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GroupChatController } from './groupchat.controller';
import { GroupChatService } from './groupchat.service';
import { GroupChatSchema } from '../schemas/groupchat.schema';
import { ChatModule } from './chat.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'groupchats', schema: GroupChatSchema },
    ]),
    forwardRef(() => ChatModule),
  ],
  providers: [GroupChatService],
  controllers: [GroupChatController],
  exports: [GroupChatService],
})
export class GroupChatModule {}
