import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserMessageDto } from './dtos/user-message.dto';
import { GroupMessageDto } from './dtos/group-message.dto';

const PAGE_SIZE = 30;

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

  async getGroupMessages(groupId: string, page: number) {
    const limit = PAGE_SIZE;
    const offset = (page - 1) * limit;

    return this.prisma.message.findMany({
      where: {
        groupId,
      },
      include: {
        sender: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      skip: offset,
      take: limit,
    });
  }

  async getUserMessages(userIdA: string, userIdB: string, page: number) {
    const limit = PAGE_SIZE;
    const offset = (page - 1) * limit;
    return this.prisma.message.findMany({
      where: {
        OR: [
          {
            senderId: userIdA,
            receiverId: userIdB,
          },
          {
            senderId: userIdB,
            receiverId: userIdA,
          },
        ],
      },
      orderBy: {
        createdAt: 'desc',
      },
      skip: offset,
      take: limit,
    });
  }
}
