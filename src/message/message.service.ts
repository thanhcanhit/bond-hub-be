import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserMessageDto } from './dtos/user-message.dto';
import { GroupMessageDto } from './dtos/group-message.dto';
import { CreateReactionDto } from './dtos/create-reaction.dto';
import { MessageReaction } from './dtos/MessageReaction.dto';

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

  async recallMessage(messageId: string) {
    return this.prisma.message.update({
      where: {
        id: messageId,
      },
      data: {
        recalled: true,
      },
    });
  }

  async readMessage(messageId: string, readerId: string) {
    return this.prisma.message.update({
      where: {
        id: messageId,
      },
      data: {
        readBy: {
          push: readerId,
        },
      },
    });
  }

  async unreadMessage(messageId: string, readerId: string) {
    // First get the current message to access its readBy array
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { readBy: true },
    });

    // Filter out the readerId from the readBy array
    const updatedReadBy = new Set(message.readBy);
    updatedReadBy.delete(readerId);

    // Update the message with the filtered array
    return this.prisma.message.update({
      where: {
        id: messageId,
      },
      data: {
        readBy: {
          set: Array.from(updatedReadBy),
        },
      },
    });
  }

  async addReaction(reaction: CreateReactionDto) {
    const messageReactions = await this.prisma.message.findUnique({
      where: {
        id: reaction.messageId,
      },
      select: {
        reactions: true,
      },
    });

    const existsReaction = messageReactions.reactions.find(
      (r: MessageReaction) => r.userId === reaction.userId,
    );

    if (existsReaction) {
      return this.prisma.message.update({
        where: {
          id: reaction.messageId,
        },
        data: {
          reactions: {
            set: messageReactions.reactions.map((r: MessageReaction) =>
              r.userId === reaction.userId
                ? {
                    ...r,
                    count: r.count + 1,
                  }
                : r,
            ),
          },
        },
      });
    }

    return this.prisma.message.update({
      where: {
        id: reaction.messageId,
      },
      data: {
        reactions: {
          push: {
            userId: reaction.userId,
            reaction: reaction.reaction,
            count: 1,
          },
        },
      },
    });
  }

  async removeReaction(messageId: string, userId: string) {
    // First get the current message to access its reactions array
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { reactions: true },
    });

    // Filter out the reactionId from the reactions array
    const updatedReactions = message.reactions.filter(
      (r: MessageReaction) => r.userId !== userId,
    );

    return this.prisma.message.update({
      where: {
        id: messageId,
      },
      data: {
        reactions: {
          set: updatedReactions,
        },
      },
    });
  }

  async deleteMessageSelfSide(messageId: string, userId: string) {
    return this.prisma.message.update({
      where: {
        id: messageId,
      },
      data: {
        deletedBy: {
          push: userId,
        },
      },
    });
  }

  async findMessagesInGroup(groupId: string, searchText: string, page: number) {
    const limit = PAGE_SIZE;
    const offset = page - 1 * limit;
    return this.prisma.message.findMany({
      where: {
        groupId,
        content: {
          path: ['text'],
          string_contains: searchText,
        },
      },
      skip: offset,
      take: limit,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
  async findMessagesInUser(
    userIdA: string,
    userIdB: string,
    searchText: string,
    page: number,
  ) {
    const limit = PAGE_SIZE;
    const offset = page - 1 * limit;
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
        content: {
          path: ['text'],
          string_contains: searchText,
        },
      },
      skip: offset,
      take: limit,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
