import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserMessageDto } from './dtos/user-message.dto';
import { GroupMessageDto } from './dtos/group-message.dto';
import { CreateReactionDto } from './dtos/create-reaction.dto';
import { MessageReaction } from './dtos/message-reaction.dto';
import { MediaType } from './dtos/base-message.dto';
import {
  MediaItem,
  MessageContent,
  PrismaMessage,
} from './interfaces/message.interface';
import { InputJsonValue } from './interfaces/prisma-json.interface';
import {
  MessageMediaProcessingResult,
  MessageMediaUploadDto,
} from './dtos/message-media.dto';
import { StorageService } from 'src/storage/storage.service';
import { v4 as uuidv4 } from 'uuid';
import { ForwardMessageDto } from './dtos/forward-message.dto';
import {
  ConversationItemDto,
  ConversationListResponseDto,
} from './dtos/conversation-list.dto';
import { MessageGateway } from './message.gateway';
import { EventService } from '../event/event.service';

const PAGE_SIZE = 30;

/**
 * Helper function to convert any object to Prisma-compatible JSON
 * This is needed because Prisma requires JSON to be in a specific format
 */
function toPrismaJson<T>(data: T): InputJsonValue {
  return JSON.parse(JSON.stringify(data)) as InputJsonValue;
}

@Injectable()
export class MessageService {
  private readonly MESSAGE_MEDIA_BUCKET = 'messages-media';

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    @Inject(forwardRef(() => MessageGateway))
    private readonly messageGateway?: MessageGateway,
    private readonly eventService?: EventService,
  ) {}

  async createUserMessage(message: UserMessageDto, userId: string) {
    // Validation: ensure the sender is the authenticated user
    if (message.senderId && message.senderId !== userId) {
      throw new ForbiddenException('You can only send messages as yourself');
    }

    // Prevent self-messaging
    if (message.receiverId === userId) {
      throw new ForbiddenException('You cannot send messages to yourself');
    }

    // Convert media items to JSON-compatible format
    const mediaItems =
      message.content.media?.map((item) => ({
        url: item.url,
        type: item.type,
        thumbnailUrl: item.thumbnailUrl,
        metadata: item.metadata || {},
      })) || [];

    const savedMessage = await this.prisma.message.create({
      data: {
        senderId: userId,
        receiverId: message.receiverId,
        repliedTo: message.repliedTo,
        content: toPrismaJson({
          text: message.content.text || '',
          media: mediaItems,
        }),
        messageType: 'USER',
      },
    });

    // Thông báo qua WebSocket nếu có gateway
    if (this.messageGateway) {
      this.messageGateway.notifyNewUserMessage(savedMessage);
    }

    // Phát sự kiện tin nhắn đã được tạo
    if (this.eventService) {
      this.eventService.emitMessageCreated(savedMessage);
    }

    return savedMessage;
  }

  /**
   * Create a user message with media attachments
   * @param message Message data
   * @param files Array of files to upload
   * @param userId User ID of the sender
   * @returns Created message with media
   */
  async createUserMessageWithMedia(
    message: UserMessageDto,
    files: Express.Multer.File[],
    userId: string,
  ) {
    // Validation: ensure the sender is the authenticated user
    if (message.senderId && message.senderId !== userId) {
      throw new ForbiddenException('You can only send messages as yourself');
    }

    // Prevent self-messaging
    if (message.receiverId === userId) {
      throw new ForbiddenException('You cannot send messages to yourself');
    }

    // If no files, use regular message creation
    if (!files || files.length === 0) {
      return this.createUserMessage(message, userId);
    }

    // Create folder path for media storage
    const now = new Date();
    const dateFolder = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // For direct messages, create a consistent folder name regardless of who is sender/receiver
    const participants = [userId, message.receiverId].sort().join('-');
    const folderPath = `direct/${participants}/${dateFolder}`;

    // Upload files to storage service
    const uploadResults = await this.storageService.uploadFiles(
      files,
      this.MESSAGE_MEDIA_BUCKET,
      folderPath,
    );

    // Process uploaded files and create media items
    const uploadedMediaItems: MediaItem[] = uploadResults.map((file) => {
      // Determine media type from file
      const mediaType = this.getMediaTypeFromMimeType(file.mimeType);

      // Create structured media item
      return {
        url: file.url,
        type: mediaType,
        fileId: file.id,
        fileName: file.originalName,
        thumbnailUrl:
          mediaType === MediaType.IMAGE || mediaType === MediaType.VIDEO
            ? file.url
            : undefined,
        metadata: {
          size: file.size,
          sizeFormatted: file.sizeFormatted,
          mimeType: file.mimeType,
          width: file.metadata?.width,
          height: file.metadata?.height,
          extension: file.extension,
          uploadedAt: new Date().toISOString(),
          path: file.path,
          bucketName: this.MESSAGE_MEDIA_BUCKET,
        },
      };
    });

    // Convert existing media items from the message (if any)
    const existingMediaItems =
      message.content.media?.map((item) => ({
        url: item.url,
        type: item.type,
        thumbnailUrl: item.thumbnailUrl,
        metadata: item.metadata || {},
      })) || [];

    // Combine all media items
    const allMediaItems = [...existingMediaItems, ...uploadedMediaItems];

    // Create the message with all media items
    const createdMessage = await this.prisma.message.create({
      data: {
        senderId: userId,
        receiverId: message.receiverId,
        repliedTo: message.repliedTo,
        content: toPrismaJson({
          text: message.content.text || '',
          media: allMediaItems,
        }),
        messageType: 'USER',
      },
    });

    // Thông báo qua WebSocket nếu có gateway
    if (this.messageGateway) {
      this.messageGateway.notifyNewUserMessage(createdMessage);
    }

    // Phát sự kiện tin nhắn đã được tạo
    if (this.eventService) {
      this.eventService.emitMessageCreated(createdMessage);
    }

    return createdMessage;
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

    // Convert media items to JSON-compatible format
    const mediaItems =
      message.content.media?.map((item) => ({
        url: item.url,
        type: item.type,
        thumbnailUrl: item.thumbnailUrl,
        metadata: item.metadata || {},
      })) || [];

    const savedMessage = await this.prisma.message.create({
      data: {
        senderId: userId,
        groupId: message.groupId,
        repliedTo: message.repliedTo,
        content: toPrismaJson({
          text: message.content.text || '',
          media: mediaItems,
        }),
        messageType: 'GROUP',
      },
    });

    // Thông báo qua WebSocket nếu có gateway
    if (this.messageGateway) {
      this.messageGateway.notifyNewGroupMessage(savedMessage);
    }

    // Phát sự kiện tin nhắn đã được tạo
    if (this.eventService) {
      this.eventService.emitMessageCreated(savedMessage);
    }

    return savedMessage;
  }

  /**
   * Create a group message with media attachments
   * @param message Message data
   * @param files Array of files to upload
   * @param userId User ID of the sender
   * @returns Created message with media
   */
  async createGroupMessageWithMedia(
    message: GroupMessageDto,
    files: Express.Multer.File[],
    userId: string,
  ) {
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

    // If no files, use regular message creation
    if (!files || files.length === 0) {
      return this.createGroupMessage(message, userId);
    }

    // Create folder path for media storage
    const now = new Date();
    const dateFolder = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const folderPath = `groups/${message.groupId}/${dateFolder}`;

    // Upload files to storage service
    const uploadResults = await this.storageService.uploadFiles(
      files,
      this.MESSAGE_MEDIA_BUCKET,
      folderPath,
    );

    // Process uploaded files and create media items
    const uploadedMediaItems: MediaItem[] = uploadResults.map((file) => {
      // Determine media type from file
      const mediaType = this.getMediaTypeFromMimeType(file.mimeType);

      // Create structured media item
      return {
        url: file.url,
        type: mediaType,
        fileId: file.id,
        fileName: file.originalName,
        thumbnailUrl:
          mediaType === MediaType.IMAGE || mediaType === MediaType.VIDEO
            ? file.url
            : undefined,
        metadata: {
          size: file.size,
          sizeFormatted: file.sizeFormatted,
          mimeType: file.mimeType,
          width: file.metadata?.width,
          height: file.metadata?.height,
          extension: file.extension,
          uploadedAt: new Date().toISOString(),
          path: file.path,
          bucketName: this.MESSAGE_MEDIA_BUCKET,
        },
      };
    });

    // Convert existing media items from the message (if any)
    const existingMediaItems =
      message.content.media?.map((item) => ({
        url: item.url,
        type: item.type,
        thumbnailUrl: item.thumbnailUrl,
        metadata: item.metadata || {},
      })) || [];

    // Combine all media items
    const allMediaItems = [...existingMediaItems, ...uploadedMediaItems];

    // Create the message with all media items
    const createdMessage = await this.prisma.message.create({
      data: {
        senderId: userId,
        groupId: message.groupId,
        repliedTo: message.repliedTo,
        content: toPrismaJson({
          text: message.content.text || '',
          media: allMediaItems,
        }),
        messageType: 'GROUP',
      },
    });

    // Thông báo qua WebSocket nếu có gateway
    if (this.messageGateway) {
      this.messageGateway.notifyNewGroupMessage(createdMessage);
    }

    // Phát sự kiện tin nhắn đã được tạo
    if (this.eventService) {
      this.eventService.emitMessageCreated(createdMessage);
    }

    return createdMessage;
  }

  /**
   * Lấy danh sách các nhóm mà người dùng là thành viên
   * @param userId ID của người dùng
   * @returns Danh sách ID của các nhóm
   */
  async getUserGroups(userId: string): Promise<string[]> {
    const userGroups = await this.prisma.groupMember.findMany({
      where: { userId },
      select: { groupId: true },
    });

    return userGroups.map((group) => group.groupId);
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

  /**
   * Find a message by its ID
   * @param messageId Message ID
   * @returns Message or null if not found
   */
  async findMessageById(messageId: string) {
    return this.prisma.message.findUnique({
      where: { id: messageId },
    });
  }

  async recallMessage(messageId: string, userId: string) {
    // Check if the user is the sender of the message
    const message = await this.findMessageById(messageId);

    if (!message) {
      throw new ForbiddenException('Message not found');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only recall your own messages');
    }

    const updatedMessage = await this.prisma.message.update({
      where: {
        id: messageId,
      },
      data: {
        recalled: true,
      },
    });

    // Thông báo qua WebSocket nếu có gateway
    if (this.messageGateway) {
      this.messageGateway.notifyMessageRecalled(updatedMessage, userId);
    }

    // Phát sự kiện tin nhắn đã được thu hồi
    if (this.eventService) {
      this.eventService.emitMessageRecalled(messageId, userId);
    }

    return updatedMessage;
  }

  async readMessage(messageId: string, readerId: string) {
    // Verify the message exists and user has access to it
    const message = await this.findMessageById(messageId);

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

    const updatedMessage = await this.prisma.message.update({
      where: {
        id: messageId,
      },
      data: {
        readBy: {
          push: readerId,
        },
      },
    });

    // Thông báo qua WebSocket nếu có gateway
    if (this.messageGateway) {
      this.messageGateway.notifyMessageRead(updatedMessage, readerId);
    }

    // Phát sự kiện tin nhắn đã được đọc
    if (this.eventService) {
      this.eventService.emitMessageRead(messageId, readerId);
    }

    return updatedMessage;
  }

  async unreadMessage(messageId: string, readerId: string) {
    // Verify the message exists and user has access to it
    const message = await this.findMessageById(messageId);

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
    const updatedMessage = await this.prisma.message.update({
      where: {
        id: messageId,
      },
      data: {
        readBy: {
          set: Array.from(updatedReadBy),
        },
      },
    });

    // Thông báo qua WebSocket nếu có gateway
    if (this.messageGateway) {
      this.messageGateway.notifyMessageRead(updatedMessage, readerId);
    }

    // Phát sự kiện tin nhắn đã được đọc
    if (this.eventService) {
      this.eventService.emitMessageRead(messageId, readerId);
    }

    return updatedMessage;
  }

  async addReaction(reaction: CreateReactionDto, userId: string) {
    // Set the user ID in the reaction object
    reaction.userId = userId;

    // Verify the message exists and user has access to it
    const message = await this.findMessageById(reaction.messageId);

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
      const updatedMessage = await this.prisma.message.update({
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

      // Thông báo qua WebSocket nếu có gateway
      if (this.messageGateway) {
        this.messageGateway.notifyMessageReactionUpdated(
          updatedMessage,
          userId,
        );
      }

      return updatedMessage;
    }

    const updatedMessage = await this.prisma.message.update({
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

    // Thông báo qua WebSocket nếu có gateway
    if (this.messageGateway) {
      this.messageGateway.notifyMessageReactionUpdated(updatedMessage, userId);
    }

    return updatedMessage;
  }

  async removeReaction(messageId: string, userId: string) {
    // Verify the message exists and user has access to it
    const message = await this.findMessageById(messageId);

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

    const updatedMessage = await this.prisma.message.update({
      where: {
        id: messageId,
      },
      data: {
        reactions: {
          set: updatedReactions,
        },
      },
    });

    // Thông báo qua WebSocket nếu có gateway
    if (this.messageGateway) {
      this.messageGateway.notifyMessageReactionUpdated(updatedMessage, userId);
    }

    return updatedMessage;
  }

  async deleteMessageSelfSide(messageId: string, userId: string) {
    // Verify the message exists and user has access to it
    const message = await this.findMessageById(messageId);

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

    const updatedMessage = await this.prisma.message.update({
      where: {
        id: messageId,
      },
      data: {
        deletedBy: {
          push: userId,
        },
      },
    });

    // Thông báo qua WebSocket nếu có gateway
    if (this.messageGateway) {
      this.messageGateway.notifyMessageDeleted(updatedMessage, userId);
    }

    return updatedMessage;
  }

  async findMessagesInGroup(
    requestUserId: string,
    groupId: string,
    searchText: string,
    page: number,
  ) {
    const isMember = await this.prisma.groupMember.findFirst({
      where: {
        groupId,
        userId: requestUserId,
      },
    });

    if (!isMember) {
      throw new ForbiddenException('You are not a member of this group');
    }

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

  /**
   * Upload media files for a message
   * @param files Array of files to upload
   * @param messageData Message data including sender, receiver/group info
   * @param userId User ID of the uploader
   * @returns Information about the uploaded media and message
   */
  async uploadMessageMedia(
    files: Express.Multer.File[],
    messageData: MessageMediaUploadDto,
    userId: string,
  ): Promise<MessageMediaProcessingResult> {
    try {
      // Validate user permissions
      if (messageData.senderId && messageData.senderId !== userId) {
        throw new ForbiddenException(
          'You can only upload media for your own messages',
        );
      }

      // For group messages, check if user is a member
      if (messageData.groupId) {
        const isMember = await this.prisma.groupMember.findFirst({
          where: {
            groupId: messageData.groupId,
            userId,
          },
        });

        if (!isMember) {
          throw new ForbiddenException('You are not a member of this group');
        }
      }

      // For direct messages, prevent self-messaging
      if (messageData.receiverId === userId) {
        throw new ForbiddenException('You cannot send messages to yourself');
      }

      // Create folder path based on conversation type and IDs
      // Format: /{conversation_type}/{conversation_id}/{year}/{month}/{day}
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const dateFolder = `${year}/${month}/${day}`;

      let folderPath = '';
      if (messageData.groupId) {
        folderPath = `groups/${messageData.groupId}/${dateFolder}`;
      } else if (messageData.receiverId) {
        // For direct messages, create a consistent folder name regardless of who is sender/receiver
        const participants = [userId, messageData.receiverId].sort().join('-');
        folderPath = `direct/${participants}/${dateFolder}`;
      } else {
        throw new BadRequestException(
          'Either groupId or receiverId must be provided',
        );
      }

      // Upload files to storage service
      const uploadResults = await this.storageService.uploadFiles(
        files,
        this.MESSAGE_MEDIA_BUCKET,
        folderPath,
      );

      // Process uploaded files based on media type
      const mediaItems: MediaItem[] = uploadResults.map((file) => {
        // Determine media type from file if not specified
        const mediaType =
          messageData.mediaType || this.getMediaTypeFromMimeType(file.mimeType);

        // Create structured media item with proper typing
        const mediaItem: MediaItem = {
          url: file.url,
          type: mediaType,
          fileId: file.id,
          fileName: file.originalName,
          thumbnailUrl:
            mediaType === MediaType.IMAGE || mediaType === MediaType.VIDEO
              ? file.url
              : undefined,
          metadata: {
            size: file.size,
            sizeFormatted: file.sizeFormatted,
            mimeType: file.mimeType,
            width: file.metadata?.width,
            height: file.metadata?.height,
            extension: file.extension,
            uploadedAt: new Date().toISOString(),
            path: file.path,
            bucketName: this.MESSAGE_MEDIA_BUCKET,
          },
        };

        return mediaItem;
      });

      // Create or update the message with the media
      // Use Prisma's return type
      let message: PrismaMessage;
      if (messageData.messageId) {
        // Update existing message
        const existingMessage = await this.prisma.message.findUnique({
          where: { id: messageData.messageId },
          select: { content: true },
        });

        if (!existingMessage) {
          throw new NotFoundException('Message not found');
        }

        // Get existing content
        const content = existingMessage.content as MessageContent;
        const existingMedia = content.media || [];

        // Update message with new media
        message = await this.prisma.message.update({
          where: { id: messageData.messageId },
          data: {
            content: toPrismaJson({
              text: messageData.text || content.text || '',
              media: [...existingMedia, ...mediaItems],
            }),
          },
        });
      } else {
        // Create new message with media
        const messageContent = toPrismaJson({
          text: messageData.text || '',
          media: mediaItems,
        });

        if (messageData.groupId) {
          // Create group message
          message = await this.prisma.message.create({
            data: {
              senderId: userId,
              groupId: messageData.groupId,
              content: messageContent,
              messageType: 'GROUP',
            },
          });
        } else if (messageData.receiverId) {
          // Create direct message
          message = await this.prisma.message.create({
            data: {
              senderId: userId,
              receiverId: messageData.receiverId,
              content: messageContent,
              messageType: 'USER',
            },
          });
        }
      }

      // Thông báo qua WebSocket nếu có gateway và tin nhắn được tạo mới
      if (this.messageGateway && !messageData.messageId) {
        if (messageData.groupId) {
          this.messageGateway.notifyMessageWithMedia(message);
        } else if (messageData.receiverId) {
          this.messageGateway.notifyMessageWithMedia(message);
        }
      }

      return {
        messageId: message.id,
        mediaItems,
        success: true,
      };
    } catch (error) {
      return {
        messageId: messageData.messageId || uuidv4(),
        mediaItems: [],
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get media type from file mimetype
   * @param mimeType The MIME type of the file
   * @returns The corresponding MediaType enum value
   */
  getMediaTypeFromMimeType(mimeType: string): MediaType {
    if (mimeType.startsWith('image/')) {
      return MediaType.IMAGE;
    } else if (mimeType.startsWith('video/')) {
      return MediaType.VIDEO;
    } else if (mimeType.startsWith('audio/')) {
      return MediaType.AUDIO;
    } else if (
      mimeType.includes('pdf') ||
      mimeType.includes('document') ||
      mimeType.includes('sheet') ||
      mimeType.includes('presentation')
    ) {
      return MediaType.DOCUMENT;
    } else {
      return MediaType.OTHER;
    }
  }

  /**
   * Get conversation list for a user
   * @param userId User ID
   * @param page Page number (optional, default: 1)
   * @param limit Number of conversations per page (optional, default: 20)
   * @returns List of conversations with last messages
   */
  async getConversationList(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<ConversationListResponseDto> {
    console.log('Getting conversation list for user:', userId);
    // Calculate pagination
    const skip = (page - 1) * limit;

    // Lấy danh sách tin nhắn trực tiếp (1-1)
    console.log('Fetching direct messages for user:', userId);
    const directMessages = await this.prisma.message.findMany({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
        messageType: 'USER',
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        sender: {
          include: {
            userInfo: true,
          },
        },
        receiver: {
          include: {
            userInfo: true,
          },
        },
      },
    });

    console.log(`Found ${directMessages.length} direct messages`);
    // In ra chi tiết các tin nhắn để kiểm tra
    directMessages.forEach((msg, index) => {
      console.log(`Message ${index + 1}:`, {
        id: msg.id,
        senderId: msg.senderId,
        receiverId: msg.receiverId,
        content: msg.content,
        messageType: msg.messageType,
        deletedBy: msg.deletedBy,
        readBy: msg.readBy,
        deletedByType: typeof msg.deletedBy,
        readByType: typeof msg.readBy,
        isDeletedByArray: Array.isArray(msg.deletedBy),
        isReadByArray: Array.isArray(msg.readBy),
      });
    });

    // Lấy danh sách nhóm mà người dùng tham gia
    console.log('Fetching user groups...');
    const userGroups = await this.prisma.groupMember.findMany({
      where: {
        userId,
      },
      include: {
        group: true,
      },
    });

    console.log(`Found ${userGroups.length} user groups`);

    // Lấy tin nhắn nhóm
    console.log('Fetching group messages...');
    const groupIds = userGroups.map((member) => member.groupId);
    const groupMessages = await this.prisma.message.findMany({
      where: {
        groupId: {
          in: groupIds,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        sender: {
          include: {
            userInfo: true,
          },
        },
        group: true,
      },
    });

    console.log(`Found ${groupMessages.length} group messages`);

    // Tạo danh sách cuộc trò chuyện trực tiếp
    const directConversationMap = new Map();

    for (const message of directMessages) {
      // Xác định ID của người đối thoại
      const partnerId =
        message.senderId === userId ? message.receiverId : message.senderId;

      console.log('Processing conversation with partner:', partnerId);

      // Nếu chưa có cuộc trò chuyện với người này, tạo mới
      if (!directConversationMap.has(partnerId)) {
        // Lấy thông tin người dùng đối thoại
        const partner = await this.prisma.user.findUnique({
          where: { id: partnerId },
          include: { userInfo: true },
        });
        const partnerInfo = partner?.userInfo;

        directConversationMap.set(partnerId, {
          id: partnerId,
          type: 'USER',
          user: {
            id: partnerId,
            fullName: partnerInfo?.fullName || 'Unknown User',
            profilePictureUrl: partnerInfo?.profilePictureUrl,
            statusMessage: partnerInfo?.statusMessage,
            lastSeen: partnerInfo?.lastSeen,
          },
          lastMessage: {
            id: message.id,
            content: message.content,
            senderId: message.senderId,
            senderName: await this.getSenderName(message.senderId),
            createdAt: message.createdAt,
            recalled: message.recalled,
            isRead:
              (Array.isArray(message.readBy) &&
                message.readBy.includes(userId)) ||
              false,
          },
          unreadCount:
            message.receiverId === userId &&
            !(Array.isArray(message.readBy) && message.readBy.includes(userId))
              ? 1
              : 0,
          updatedAt: message.createdAt,
        });
      }
    }

    // Tạo danh sách cuộc trò chuyện nhóm
    const groupConversationMap = new Map();

    // Đầu tiên, thêm tất cả các nhóm mà người dùng tham gia vào map
    // Điều này đảm bảo rằng tất cả các nhóm đều được hiển thị, kể cả khi chưa có tin nhắn
    for (const groupMember of userGroups) {
      const group = groupMember.group;
      if (!group) continue;

      // Thêm nhóm vào map nếu chưa có
      if (!groupConversationMap.has(group.id)) {
        groupConversationMap.set(group.id, {
          id: group.id,
          type: 'GROUP',
          group: {
            id: group.id,
            name: group.name || 'Unknown Group',
            avatarUrl: group.avatarUrl,
          },
          // Không có tin nhắn cuối cùng
          lastMessage: null,
          unreadCount: 0,
          // Sử dụng ngày tạo nhóm làm thời gian cập nhật nếu không có tin nhắn
          updatedAt: group.createdAt,
        });
      }
    }

    // Sau đó, cập nhật thông tin tin nhắn cuối cùng cho các nhóm có tin nhắn
    for (const message of groupMessages) {
      if (!message.groupId) continue;

      // Lấy thông tin cuộc trò chuyện nhóm từ map
      const conversation = groupConversationMap.get(message.groupId);

      // Nếu đây là tin nhắn đầu tiên được xử lý cho nhóm này hoặc tin nhắn này mới hơn
      if (
        !conversation.lastMessage ||
        new Date(message.createdAt) >
          new Date(conversation.lastMessage.createdAt)
      ) {
        // Cập nhật thông tin tin nhắn cuối cùng
        conversation.lastMessage = {
          id: message.id,
          content: message.content,
          senderId: message.senderId,
          senderName: await this.getSenderName(message.senderId),
          createdAt: message.createdAt,
          recalled: message.recalled,
          isRead:
            (Array.isArray(message.readBy) &&
              message.readBy.includes(userId)) ||
            false,
        };

        // Cập nhật thời gian cập nhật cuộc trò chuyện
        conversation.updatedAt = message.createdAt;

        // Cập nhật số tin nhắn chưa đọc
        if (
          !(Array.isArray(message.readBy) && message.readBy.includes(userId))
        ) {
          conversation.unreadCount += 1;
        }
      }
    }

    // Kết hợp và sắp xếp tất cả các cuộc trò chuyện theo thời gian tin nhắn cuối cùng
    const directConversations = Array.from(directConversationMap.values());
    const groupConversations = Array.from(groupConversationMap.values());

    console.log(`Created ${directConversations.length} direct conversations`);
    console.log(`Created ${groupConversations.length} group conversations`);

    // In ra chi tiết các cuộc trò chuyện để kiểm tra
    console.log(
      'Direct conversation map keys:',
      Array.from(directConversationMap.keys()),
    );
    directConversations.forEach((conv, index) => {
      console.log(`Direct conversation ${index + 1}:`, {
        id: conv.id,
        type: conv.type,
        user: conv.user,
        lastMessage: {
          id: conv.lastMessage?.id,
          content: conv.lastMessage?.content,
          senderId: conv.lastMessage?.senderId,
        },
      });
    });

    // In ra chi tiết các cuộc trò chuyện nhóm để kiểm tra
    groupConversations.forEach((conv, index) => {
      console.log(`Group conversation ${index + 1}:`, {
        id: conv.id,
        type: conv.type,
        group: conv.group,
        lastMessage: conv.lastMessage
          ? {
              id: conv.lastMessage?.id,
              content: conv.lastMessage?.content,
              senderId: conv.lastMessage?.senderId,
            }
          : 'No messages',
        updatedAt: conv.updatedAt,
      });
    });

    const allConversations = [
      ...directConversations,
      ...groupConversations,
    ].sort((a, b) => {
      const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return dateB - dateA;
    });

    // Phân trang
    const paginatedConversations = allConversations.slice(skip, skip + limit);

    console.log(
      `Returning ${paginatedConversations.length} conversations out of ${allConversations.length} total`,
    );

    return {
      conversations: paginatedConversations as ConversationItemDto[],
      totalCount: allConversations.length,
    };
  }

  /**
   * Helper method to get user name from user ID
   * @param userId User ID
   * @returns User name or 'Unknown User' if not found
   */
  private async getSenderName(userId: string): Promise<string> {
    if (!userId) return 'Unknown User';

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { userInfo: true },
    });

    return user?.userInfo?.fullName || 'Unknown User';
  }

  async forwardMessage(forwardData: ForwardMessageDto, userId: string) {
    // Get the original message
    const originalMessage = await this.findMessageById(forwardData.messageId);

    if (!originalMessage) {
      throw new NotFoundException('Original message not found');
    }

    const results = [];

    // Process each target
    for (const target of forwardData.targets) {
      try {
        let newMessage: PrismaMessage;

        if (target.userId) {
          // Prevent self-forwarding
          if (target.userId === userId) {
            continue;
          }

          // Forward as user message
          newMessage = await this.prisma.message.create({
            data: {
              senderId: userId,
              receiverId: target.userId,
              content: originalMessage.content,
              messageType: 'USER',
              forwardedFrom: originalMessage.id,
            },
          });

          // Thông báo qua WebSocket nếu có gateway
          if (this.messageGateway) {
            this.messageGateway.notifyNewUserMessage(newMessage);
          }

          results.push({
            type: 'user',
            message: newMessage,
            success: true,
          });
        } else if (target.groupId) {
          // Check if user is member of the group
          const isMember = await this.prisma.groupMember.findFirst({
            where: {
              groupId: target.groupId,
              userId,
            },
          });

          if (!isMember) {
            results.push({
              type: 'group',
              groupId: target.groupId,
              success: false,
              error: 'Not a member of the group',
            });
            continue;
          }

          // Forward as group message
          newMessage = await this.prisma.message.create({
            data: {
              senderId: userId,
              groupId: target.groupId,
              content: originalMessage.content,
              messageType: 'GROUP',
              forwardedFrom: originalMessage.id,
            },
          });

          // Thông báo qua WebSocket nếu có gateway
          if (this.messageGateway) {
            this.messageGateway.notifyNewGroupMessage(newMessage);
          }

          results.push({
            type: 'group',
            message: newMessage,
            success: true,
          });
        }
      } catch (error) {
        results.push({
          type: target.userId ? 'user' : 'group',
          targetId: target.userId || target.groupId,
          success: false,
          error: error.message,
        });
      }
    }

    return results;
  }
}
