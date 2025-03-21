import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserMessageDto } from './dtos/user-message.dto';
import { GroupMessageDto } from './dtos/group-message.dto';
import { CreateReactionDto } from './dtos/create-reaction.dto';
import { MessageReaction } from './dtos/MessageReaction.dto';

const PAGE_SIZE = 30;

@Injectable()
export class MessageService {
  constructor(private readonly prisma: PrismaService) {}

  async createUserMessage(message: UserMessageDto, userId: string) {
    // Validation: ensure the sender is the authenticated user
    if (message.senderId && message.senderId !== userId) {
      throw new ForbiddenException('You can only send messages as yourself');
    }

    // Prevent self-messaging
    if (message.receiverId === userId) {
      throw new ForbiddenException('You cannot send messages to yourself');
    }

    return this.prisma.message.create({
      data: {
        ...message,
        senderId: userId, // Ensure the sender is the authenticated user
        content: {
          text: message.content.text,
          media: message.content.media || [],
        },
        messageType: 'USER',
      },
    });
  }

  async createGroupMessage(message: GroupMessageDto, userId: string) {
    // Validation: ensure the sender is the authenticated user
    if (message.senderId && message.senderId !== userId) {
      throw new ForbiddenException('You can only send messages as yourself');
    }

    // Check if user is a member of the group
    const isMember = await this.prisma.groupMember.findFirst({
      where: {
        groupId: message.groupId,
        userId,
      },
    });

    if (!isMember) {
      throw new ForbiddenException('You are not a member of this group');
    }

    return this.prisma.message.create({
      data: {
        ...message,
        senderId: userId, // Ensure the sender is the authenticated user
        content: {
          text: message.content.text,
          media: message.content.media || [],
        },
        messageType: 'GROUP',
      },
    });
  }

  async getGroupMessages(requestUserId: string, groupId: string, page: number) {
    const limit = PAGE_SIZE;
    const offset = (page - 1) * limit;

    const isMember = await this.prisma.groupMember.findFirst({
      where: {
        groupId,
        userId: requestUserId,
      },
    });

    if (!isMember) {
      throw new ForbiddenException('You are not a member of this group');
    }

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
    // Prevent retrieving self-messages
    if (userIdA === userIdB) {
      throw new ForbiddenException('Cannot retrieve messages with yourself');
    }

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

  async recallMessage(messageId: string, userId: string) {
    // Check if the user is the sender of the message
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new ForbiddenException('Message not found');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only recall your own messages');
    }

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
    // Verify the message exists and user has access to it
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new ForbiddenException('Message not found');
    }

    // For user messages, check if user is sender or receiver
    if (
      message.messageType === 'USER' &&
      message.senderId !== readerId &&
      message.receiverId !== readerId
    ) {
      throw new ForbiddenException('You do not have access to this message');
    }

    // For group messages, check if user is a member of the group
    if (message.messageType === 'GROUP') {
      const isMember = await this.prisma.groupMember.findFirst({
        where: {
          groupId: message.groupId,
          userId: readerId,
        },
      });

      if (!isMember) {
        throw new ForbiddenException('You are not a member of this group');
      }
    }

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
    // Verify the message exists and user has access to it
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new ForbiddenException('Message not found');
    }

    // For user messages, check if user is sender or receiver
    if (
      message.messageType === 'USER' &&
      message.senderId !== readerId &&
      message.receiverId !== readerId
    ) {
      throw new ForbiddenException('You do not have access to this message');
    }

    // For group messages, check if user is a member of the group
    if (message.messageType === 'GROUP') {
      const isMember = await this.prisma.groupMember.findFirst({
        where: {
          groupId: message.groupId,
          userId: readerId,
        },
      });

      if (!isMember) {
        throw new ForbiddenException('You are not a member of this group');
      }
    }

    // First get the current message to access its readBy array
    const messageData = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { readBy: true },
    });

    // Ensure readBy is an array before creating a Set
    const readBy = Array.isArray(messageData.readBy) ? messageData.readBy : [];
    const updatedReadBy = new Set(readBy as string[]);
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

  async addReaction(reaction: CreateReactionDto, userId: string) {
    // Set the user ID in the reaction object
    reaction.userId = userId;

    // Verify the message exists and user has access to it
    const message = await this.prisma.message.findUnique({
      where: { id: reaction.messageId },
    });

    if (!message) {
      throw new ForbiddenException('Message not found');
    }

    // For user messages, check if user is sender or receiver
    if (
      message.messageType === 'USER' &&
      message.senderId !== userId &&
      message.receiverId !== userId
    ) {
      throw new ForbiddenException('You do not have access to this message');
    }

    // For group messages, check if user is a member of the group
    if (message.messageType === 'GROUP') {
      const isMember = await this.prisma.groupMember.findFirst({
        where: {
          groupId: message.groupId,
          userId,
        },
      });

      if (!isMember) {
        throw new ForbiddenException('You are not a member of this group');
      }
    }

    const messageReactions = await this.prisma.message.findUnique({
      where: {
        id: reaction.messageId,
      },
      select: {
        reactions: true,
      },
    });

    // Ensure reactions is an array
    const reactions = Array.isArray(messageReactions.reactions)
      ? messageReactions.reactions
      : [];

    const existsReaction = reactions.find(
      (r: MessageReaction) => r.userId === userId,
    );

    if (existsReaction) {
      return this.prisma.message.update({
        where: {
          id: reaction.messageId,
        },
        data: {
          reactions: {
            set: reactions.map((r: MessageReaction) =>
              r.userId === userId
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
            userId,
            reaction: reaction.reaction,
            count: 1,
          },
        },
      },
    });
  }

  async removeReaction(messageId: string, userId: string) {
    // Verify the message exists and user has access to it
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new ForbiddenException('Message not found');
    }

    // For user messages, check if user is sender or receiver
    if (
      message.messageType === 'USER' &&
      message.senderId !== userId &&
      message.receiverId !== userId
    ) {
      throw new ForbiddenException('You do not have access to this message');
    }

    // For group messages, check if user is a member of the group
    if (message.messageType === 'GROUP') {
      const isMember = await this.prisma.groupMember.findFirst({
        where: {
          groupId: message.groupId,
          userId,
        },
      });

      if (!isMember) {
        throw new ForbiddenException('You are not a member of this group');
      }
    }

    // First get the current message to access its reactions array
    const messageData = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { reactions: true },
    });

    // Ensure reactions is an array
    const reactions = Array.isArray(messageData.reactions)
      ? messageData.reactions
      : [];

    // Filter out the reaction from this user
    const updatedReactions = reactions.filter(
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
    // Verify the message exists and user has access to it
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new ForbiddenException('Message not found');
    }

    // For user messages, check if user is sender or receiver
    if (
      message.messageType === 'USER' &&
      message.senderId !== userId &&
      message.receiverId !== userId
    ) {
      throw new ForbiddenException('You do not have access to this message');
    }

    // For group messages, check if user is a member of the group
    if (message.messageType === 'GROUP') {
      const isMember = await this.prisma.groupMember.findFirst({
        where: {
          groupId: message.groupId,
          userId,
        },
      });

      if (!isMember) {
        throw new ForbiddenException('You are not a member of this group');
      }
    }

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
    const offset = (page - 1) * limit;
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
    // Prevent searching self-messages
    if (userIdA === userIdB) {
      throw new ForbiddenException('Cannot search messages with yourself');
    }

    const limit = PAGE_SIZE;
    const offset = (page - 1) * limit;
    return this.prisma.message.findMany({
      where: {
        AND: [
          {
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
          {
            content: {
              path: ['text'],
              string_contains: searchText,
            },
          },
        ],
        messageType: 'USER',
      },
      include: {
        sender: true,
      },
      skip: offset,
      take: limit,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
