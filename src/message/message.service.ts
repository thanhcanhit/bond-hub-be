import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
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

    return this.prisma.message.create({
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

    return this.prisma.message.create({
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

    return createdMessage;
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
    // Calculate pagination
    const skip = (page - 1) * limit;

    // Get direct conversations (1-on-1 messages)
    const directConversations = await this.prisma.$queryRaw<any[]>`
      WITH direct_conversations AS (
        SELECT
          CASE
            WHEN m.sender_id = ${userId}::uuid THEN m.receiver_id
            ELSE m.sender_id
          END as conversation_user_id,
          MAX(m.created_at) as last_message_time
        FROM messages m
        WHERE
          (m.sender_id = ${userId}::uuid OR m.receiver_id = ${userId}::uuid)
          AND m.message_type = 'USER'
          AND NOT ${userId}::uuid = ANY(m.deleted_by)
        GROUP BY conversation_user_id
      ),
      last_messages AS (
        SELECT DISTINCT ON (conversation_id)
          id,
          CASE
            WHEN m.sender_id = ${userId}::uuid THEN m.receiver_id
            ELSE m.sender_id
          END as conversation_id,
          m.content,
          m.sender_id,
          m.created_at,
          m.is_recalled,
          m.read_by
        FROM messages m
        JOIN direct_conversations dc ON
          (dc.conversation_user_id = m.receiver_id AND m.sender_id = ${userId}::uuid) OR
          (dc.conversation_user_id = m.sender_id AND m.receiver_id = ${userId}::uuid)
        WHERE NOT ${userId}::uuid = ANY(m.deleted_by)
        ORDER BY conversation_id, m.created_at DESC
      ),
      unread_counts AS (
        SELECT
          CASE
            WHEN m.sender_id = ${userId}::uuid THEN m.receiver_id
            ELSE m.sender_id
          END as conversation_id,
          COUNT(*) as unread_count
        FROM messages m
        WHERE
          m.receiver_id = ${userId}::uuid AND
          NOT ${userId}::uuid = ANY(m.read_by) AND
          NOT ${userId}::uuid = ANY(m.deleted_by)
        GROUP BY conversation_id
      )
      SELECT
        u.user_id as id,
        'USER' as type,
        ui.full_name as "fullName",
        ui.profile_picture_url as "profilePictureUrl",
        ui.status_message as "statusMessage",
        ui.last_seen as "lastSeen",
        lm.id as "lastMessageId",
        lm.content as "lastMessageContent",
        lm.sender_id as "lastMessageSenderId",
        lm.created_at as "lastMessageCreatedAt",
        lm.is_recalled as "lastMessageRecalled",
        CASE WHEN ${userId}::uuid = ANY(lm.read_by) THEN true ELSE false END as "isLastMessageRead",
        COALESCE(uc.unread_count, 0) as "unreadCount",
        lm.created_at as "updatedAt"
      FROM direct_conversations dc
      JOIN users u ON u.user_id = dc.conversation_user_id
      LEFT JOIN user_infors ui ON ui.info_id = u.info_id
      LEFT JOIN last_messages lm ON lm.conversation_id = dc.conversation_user_id
      LEFT JOIN unread_counts uc ON uc.conversation_id = dc.conversation_user_id
      ORDER BY lm.created_at DESC
      LIMIT ${limit} OFFSET ${skip}
    `;

    // Get group conversations
    const groupConversations = await this.prisma.$queryRaw<any[]>`
      WITH user_groups AS (
        SELECT gm.group_id
        FROM group_members gm
        WHERE gm.user_id = ${userId}::uuid
      ),
      last_group_messages AS (
        SELECT DISTINCT ON (m.group_id)
          m.id,
          m.group_id,
          m.content,
          m.sender_id,
          m.created_at,
          m.is_recalled,
          m.read_by
        FROM messages m
        JOIN user_groups ug ON m.group_id = ug.group_id
        WHERE NOT ${userId}::uuid = ANY(m.deleted_by)
        ORDER BY m.group_id, m.created_at DESC
      ),
      unread_group_counts AS (
        SELECT
          m.group_id,
          COUNT(*) as unread_count
        FROM messages m
        JOIN user_groups ug ON m.group_id = ug.group_id
        WHERE
          NOT ${userId}::uuid = ANY(m.read_by) AND
          NOT ${userId}::uuid = ANY(m.deleted_by)
        GROUP BY m.group_id
      )
      SELECT
        g.group_id as id,
        'GROUP' as type,
        g.group_name as name,
        g.avatar_url as "avatarUrl",
        lgm.id as "lastMessageId",
        lgm.content as "lastMessageContent",
        lgm.sender_id as "lastMessageSenderId",
        lgm.created_at as "lastMessageCreatedAt",
        lgm.is_recalled as "lastMessageRecalled",
        CASE WHEN ${userId}::uuid = ANY(lgm.read_by) THEN true ELSE false END as "isLastMessageRead",
        COALESCE(ugc.unread_count, 0) as "unreadCount",
        lgm.created_at as "updatedAt"
      FROM groups g
      JOIN user_groups ug ON g.group_id = ug.group_id
      LEFT JOIN last_group_messages lgm ON lgm.group_id = g.group_id
      LEFT JOIN unread_group_counts ugc ON ugc.group_id = g.group_id
      ORDER BY lgm.created_at DESC
      LIMIT ${limit} OFFSET ${skip}
    `;

    // Get sender names for last messages
    const senderIds = [
      ...directConversations.map((c) => c.lastMessageSenderId),
      ...groupConversations.map((c) => c.lastMessageSenderId),
    ].filter((id) => id); // Filter out null/undefined

    const uniqueSenderIds = [...new Set(senderIds)];

    const senders =
      uniqueSenderIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: uniqueSenderIds } },
            select: {
              id: true,
              userInfo: {
                select: {
                  fullName: true,
                },
              },
            },
          })
        : [];

    // Create a map of sender IDs to names
    const senderMap = new Map();
    senders.forEach((sender) => {
      senderMap.set(sender.id, sender.userInfo?.fullName || 'Unknown User');
    });

    // Transform direct conversations to DTO format
    const directConversationItems = directConversations.map((conv) => {
      const lastMessage = conv.lastMessageId
        ? {
            id: conv.lastMessageId,
            content: conv.lastMessageContent,
            senderId: conv.lastMessageSenderId,
            senderName:
              senderMap.get(conv.lastMessageSenderId) || 'Unknown User',
            createdAt: conv.lastMessageCreatedAt,
            recalled: conv.lastMessageRecalled,
            isRead: conv.isLastMessageRead,
          }
        : undefined;

      return {
        id: conv.id,
        type: 'USER',
        user: {
          id: conv.id,
          fullName: conv.fullName,
          profilePictureUrl: conv.profilePictureUrl,
          statusMessage: conv.statusMessage,
          lastSeen: conv.lastSeen,
        },
        lastMessage,
        unreadCount: parseInt(conv.unreadCount) || 0,
        updatedAt: conv.updatedAt,
      };
    });

    // Transform group conversations to DTO format
    const groupConversationItems = groupConversations.map((conv) => {
      const lastMessage = conv.lastMessageId
        ? {
            id: conv.lastMessageId,
            content: conv.lastMessageContent,
            senderId: conv.lastMessageSenderId,
            senderName:
              senderMap.get(conv.lastMessageSenderId) || 'Unknown User',
            createdAt: conv.lastMessageCreatedAt,
            recalled: conv.lastMessageRecalled,
            isRead: conv.isLastMessageRead,
          }
        : undefined;

      return {
        id: conv.id,
        type: 'GROUP',
        group: {
          id: conv.id,
          name: conv.name,
          avatarUrl: conv.avatarUrl,
        },
        lastMessage,
        unreadCount: parseInt(conv.unreadCount) || 0,
        updatedAt: conv.updatedAt,
      };
    });

    // Combine and sort all conversations by last message time (descending)
    const allConversations = [
      ...directConversationItems,
      ...groupConversationItems,
    ].sort((a, b) => {
      const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return dateB - dateA;
    });

    // Get total count of conversations
    const totalDirectCount = await this.prisma.$queryRaw<[{ count: string }]>`
      SELECT COUNT(DISTINCT
        CASE
          WHEN m.sender_id = ${userId}::uuid THEN m.receiver_id
          ELSE m.sender_id
        END
      ) as count
      FROM messages m
      WHERE
        (m.sender_id = ${userId}::uuid OR m.receiver_id = ${userId}::uuid)
        AND m.message_type = 'USER'
        AND NOT ${userId}::uuid = ANY(m.deleted_by)
    `;

    const totalGroupCount = await this.prisma.$queryRaw<[{ count: string }]>`
      SELECT COUNT(DISTINCT gm.group_id) as count
      FROM group_members gm
      WHERE gm.user_id = ${userId}::uuid
    `;

    const totalCount =
      parseInt(totalDirectCount[0]?.count || '0') +
      parseInt(totalGroupCount[0]?.count || '0');

    return {
      conversations: allConversations as ConversationItemDto[],
      totalCount,
    };
  }

  async forwardMessage(forwardData: ForwardMessageDto, userId: string) {
    // Get the original message
    const originalMessage = await this.prisma.message.findUnique({
      where: { id: forwardData.messageId },
    });

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
