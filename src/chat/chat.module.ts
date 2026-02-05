import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatSchema } from '../schemas/chat.schema';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { GroqModule } from '../common/groq.module';
import { PdfModule } from '../pdf/pdf.module';
import { CourseSchema } from '../schemas/course.schema';
import { GroupChatSchema } from '../schemas/groupchat.schema';
import { JwtModule } from '@nestjs/jwt';
import { ChatGateway } from './chat.gateway';
import { GroupChatModule } from './groupchat.module';
import { QdrantModule } from '../qdrant/qdrant.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'chats', schema: ChatSchema },
      { name: 'courses', schema: CourseSchema },
      { name: 'groupchats', schema: GroupChatSchema },
    ]),
    PdfModule,
    GroqModule,
    QdrantModule,
    JwtModule.register({
      secret: process.env.JWTKey || 'your-secret-key',
    }),
    forwardRef(() => GroupChatModule),
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway],
  exports: [ChatService, ChatGateway],
})
export class ChatModule {}
