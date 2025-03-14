import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserMessageDto } from './dtos/user-message.dto';
import { GroupMessageDto } from './dtos/group-message.dto';

@Injectable()
export class MessageService {
  constructor(private readonly prisma: PrismaService) {}

  async createUserMessage(message: UserMessageDto) {
    return this.prisma.message.create({
      data: {
        ...message,
        content: {
          text: message.content.text,
          media: message.content.media || [],
        },
        messageType: 'USER',
      },
    });
  }
  async createGroupMessage(message: GroupMessageDto) {
    return this.prisma.message.create({
      data: {
        ...message,
        content: {
          text: message.content.text,
          media: message.content.media || [],
        },
        messageType: 'GROUP',
      },
    });
  }
}
