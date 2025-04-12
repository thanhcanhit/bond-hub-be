import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger, OnModuleDestroy, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { MessageService } from './message.service';
import { UserMessageDto } from './dtos/user-message.dto';
import { GroupMessageDto } from './dtos/group-message.dto';
import { CreateReactionDto } from './dtos/create-reaction.dto';

import { WsJwtGuard } from '../auth/guards/ws-jwt.guard';

@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/message',
  pingInterval: 10000, // 10 seconds
  pingTimeout: 15000, // 15 seconds
})
export class MessageGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MessageGateway.name);
  private userSockets: Map<string, Set<Socket>> = new Map();
  private socketToUser: Map<string, string> = new Map();
  private lastActivity: Map<string, number> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly messageService: MessageService,
  ) {}

  private async getUserFromSocket(client: Socket): Promise<string | null> {
    try {
      const token = client.handshake.auth.token;
      if (!token) return null;

      const decoded = this.jwtService.verify(token);
      return decoded.sub;
    } catch (error) {
      console.error('Error verifying token:', error);
      return null;
    }
  }

  private addUserSocket(userId: string, socket: Socket) {
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId).add(socket);
    this.socketToUser.set(socket.id, userId);
    this.lastActivity.set(socket.id, Date.now());
    this.logger.debug(`User ${userId} connected with socket ${socket.id}`);
  }

  private removeUserSocket(userId: string, socket: Socket) {
    const userSockets = this.userSockets.get(userId);
    if (userSockets) {
      userSockets.delete(socket);
      if (userSockets.size === 0) {
        this.userSockets.delete(userId);
      }
    }
    this.socketToUser.delete(socket.id);
    this.lastActivity.delete(socket.id);
    this.logger.debug(`Socket ${socket.id} for user ${userId} removed`);
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      this.logger.log('WebSocket Gateway cleanup interval cleared');
    }
  }

  afterInit(_server: Server) {
    this.logger.log('WebSocket Gateway initialized');

    // Setup cleanup interval to run every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveSockets();
    }, 60000); // 1 minute
  }

  async handleConnection(client: Socket) {
    const userId = await this.getUserFromSocket(client);
    if (!userId) {
      client.disconnect();
      return;
    }

    this.addUserSocket(userId, client);

    // Join user's personal room
    client.join(`user:${userId}`);

    // Join all group rooms the user is a member of
    const userGroups = await this.prisma.groupMember.findMany({
      where: { userId },
      select: { groupId: true },
    });

    userGroups.forEach((group) => {
      client.join(`group:${group.groupId}`);
    });

    // Emit user online status
    this.server.emit('userStatus', {
      userId,
      status: 'online',
      timestamp: new Date(),
    });
  }

  private cleanupInactiveSockets() {
    const now = Date.now();
    const inactivityThreshold = 2 * 60 * 1000; // 2 minutes

    this.logger.debug(
      `Running socket cleanup, checking ${this.lastActivity.size} sockets`,
    );

    for (const [socketId, lastActive] of this.lastActivity.entries()) {
      if (now - lastActive > inactivityThreshold) {
        const userId = this.socketToUser.get(socketId);
        if (userId) {
          this.logger.warn(
            `Socket ${socketId} for user ${userId} inactive for too long, disconnecting`,
          );

          // Find the socket instance
          const userSockets = this.userSockets.get(userId);
          if (userSockets) {
            for (const socket of userSockets) {
              if (socket.id === socketId) {
                socket.disconnect(true);
                break;
              }
            }
          }
        }
      }
    }
  }

  handleDisconnect(client: Socket) {
    this.getUserFromSocket(client).then((userId) => {
      if (userId) {
        this.removeUserSocket(userId, client);

        // If no more sockets for this user, emit offline status
        if (!this.userSockets.has(userId)) {
          this.server.emit('userStatus', {
            userId,
            status: 'offline',
            timestamp: new Date(),
          });
        }
      }
    });
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('heartbeat')
  handleHeartbeat(@ConnectedSocket() client: Socket) {
    const socketId = client.id;
    this.lastActivity.set(socketId, Date.now());
    return { status: 'ok', timestamp: Date.now() };
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('sendUserMessage')
  async handleUserMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() message: UserMessageDto,
  ) {
    const userId = await this.getUserFromSocket(client);
    if (!userId) return;

    try {
      // Update last activity
      this.lastActivity.set(client.id, Date.now());
      const savedMessage = await this.messageService.createUserMessage(
        message,
        userId,
      );

      // Emit to sender's room
      this.server.to(`user:${userId}`).emit('newMessage', {
        type: 'user',
        message: savedMessage,
        timestamp: new Date(),
      });

      // Emit to receiver's room
      this.server.to(`user:${message.receiverId}`).emit('newMessage', {
        type: 'user',
        message: savedMessage,
        timestamp: new Date(),
      });

      // Emit typing stopped
      this.server.to(`user:${message.receiverId}`).emit('userTypingStopped', {
        userId,
        timestamp: new Date(),
      });

      return savedMessage;
    } catch (error) {
      client.emit('error', { message: error.message });
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('sendGroupMessage')
  async handleGroupMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() message: GroupMessageDto,
  ) {
    const userId = await this.getUserFromSocket(client);
    if (!userId) return;

    try {
      // Update last activity
      this.lastActivity.set(client.id, Date.now());
      const savedMessage = await this.messageService.createGroupMessage(
        message,
        userId,
      );

      // Emit to the group room
      this.server.to(`group:${message.groupId}`).emit('newMessage', {
        type: 'group',
        message: savedMessage,
        timestamp: new Date(),
      });

      // Emit typing stopped
      this.server.to(`group:${message.groupId}`).emit('userTypingStopped', {
        userId,
        groupId: message.groupId,
        timestamp: new Date(),
      });

      return savedMessage;
    } catch (error) {
      client.emit('error', { message: error.message });
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('readMessage')
  async handleReadMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { messageId: string },
  ) {
    const userId = await this.getUserFromSocket(client);
    if (!userId) return;

    try {
      // Update last activity
      this.lastActivity.set(client.id, Date.now());
      const updatedMessage = await this.messageService.readMessage(
        data.messageId,
        userId,
      );

      const readEvent = {
        messageId: updatedMessage.id,
        readBy: updatedMessage.readBy,
        userId,
        timestamp: new Date(),
      };

      // For user messages
      if (updatedMessage.messageType === 'USER') {
        this.server
          .to(`user:${updatedMessage.senderId}`)
          .emit('messageRead', readEvent);
        this.server
          .to(`user:${updatedMessage.receiverId}`)
          .emit('messageRead', readEvent);
      }
      // For group messages
      else if (updatedMessage.messageType === 'GROUP') {
        this.server
          .to(`group:${updatedMessage.groupId}`)
          .emit('messageRead', readEvent);
      }

      return updatedMessage;
    } catch (error) {
      client.emit('error', { message: error.message });
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('recallMessage')
  async handleRecallMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { messageId: string },
  ) {
    const userId = await this.getUserFromSocket(client);
    if (!userId) return;

    try {
      // Update last activity
      this.lastActivity.set(client.id, Date.now());
      const recalledMessage = await this.messageService.recallMessage(
        data.messageId,
        userId,
      );

      const recallEvent = {
        messageId: recalledMessage.id,
        userId,
        timestamp: new Date(),
      };

      if (recalledMessage.messageType === 'USER') {
        this.server
          .to(`user:${recalledMessage.senderId}`)
          .emit('messageRecalled', recallEvent);
        this.server
          .to(`user:${recalledMessage.receiverId}`)
          .emit('messageRecalled', recallEvent);
      } else if (recalledMessage.messageType === 'GROUP') {
        this.server
          .to(`group:${recalledMessage.groupId}`)
          .emit('messageRecalled', recallEvent);
      }

      return recalledMessage;
    } catch (error) {
      client.emit('error', { message: error.message });
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('addReaction')
  async handleAddReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() reaction: CreateReactionDto,
  ) {
    const userId = await this.getUserFromSocket(client);
    if (!userId) return;

    try {
      // Update last activity
      this.lastActivity.set(client.id, Date.now());
      const updatedMessage = await this.messageService.addReaction(
        reaction,
        userId,
      );

      const reactionEvent = {
        messageId: updatedMessage.id,
        reactions: updatedMessage.reactions,
        userId,
        timestamp: new Date(),
      };

      if (updatedMessage.messageType === 'USER') {
        this.server
          .to(`user:${updatedMessage.senderId}`)
          .emit('messageReactionUpdated', reactionEvent);
        this.server
          .to(`user:${updatedMessage.receiverId}`)
          .emit('messageReactionUpdated', reactionEvent);
      } else if (updatedMessage.messageType === 'GROUP') {
        this.server
          .to(`group:${updatedMessage.groupId}`)
          .emit('messageReactionUpdated', reactionEvent);
      }

      return updatedMessage;
    } catch (error) {
      client.emit('error', { message: error.message });
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('removeReaction')
  async handleRemoveReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { messageId: string },
  ) {
    const userId = await this.getUserFromSocket(client);
    if (!userId) return;

    try {
      // Update last activity
      this.lastActivity.set(client.id, Date.now());
      const updatedMessage = await this.messageService.removeReaction(
        data.messageId,
        userId,
      );

      const reactionEvent = {
        messageId: updatedMessage.id,
        reactions: updatedMessage.reactions,
        userId,
        timestamp: new Date(),
      };

      if (updatedMessage.messageType === 'USER') {
        this.server
          .to(`user:${updatedMessage.senderId}`)
          .emit('messageReactionUpdated', reactionEvent);
        this.server
          .to(`user:${updatedMessage.receiverId}`)
          .emit('messageReactionUpdated', reactionEvent);
      } else if (updatedMessage.messageType === 'GROUP') {
        this.server
          .to(`group:${updatedMessage.groupId}`)
          .emit('messageReactionUpdated', reactionEvent);
      }

      return updatedMessage;
    } catch (error) {
      client.emit('error', { message: error.message });
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('getUserStatus')
  async handleGetUserStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userIds: string[] },
  ) {
    const requestingUserId = await this.getUserFromSocket(client);
    if (!requestingUserId) return;

    // Update last activity
    this.lastActivity.set(client.id, Date.now());

    try {
      const statusMap = {};

      for (const userId of data.userIds) {
        const isOnline =
          this.userSockets.has(userId) && this.userSockets.get(userId).size > 0;
        statusMap[userId] = {
          userId,
          status: isOnline ? 'online' : 'offline',
          timestamp: Date.now(),
        };
      }

      return statusMap;
    } catch (error) {
      client.emit('error', { message: error.message });
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { receiverId?: string; groupId?: string },
  ) {
    const userId = await this.getUserFromSocket(client);
    if (!userId) return;

    // Update last activity
    this.lastActivity.set(client.id, Date.now());

    const typingEvent = {
      userId,
      timestamp: new Date(),
    };

    if (data.receiverId) {
      this.server.to(`user:${data.receiverId}`).emit('userTyping', {
        ...typingEvent,
        receiverId: data.receiverId,
      });
    } else if (data.groupId) {
      this.server.to(`group:${data.groupId}`).emit('userTyping', {
        ...typingEvent,
        groupId: data.groupId,
      });
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('stopTyping')
  async handleStopTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { receiverId?: string; groupId?: string },
  ) {
    const userId = await this.getUserFromSocket(client);
    if (!userId) return;

    // Update last activity
    this.lastActivity.set(client.id, Date.now());

    const typingEvent = {
      userId,
      timestamp: new Date(),
    };

    if (data.receiverId) {
      this.server.to(`user:${data.receiverId}`).emit('userTypingStopped', {
        ...typingEvent,
        receiverId: data.receiverId,
      });
    } else if (data.groupId) {
      this.server.to(`group:${data.groupId}`).emit('userTypingStopped', {
        ...typingEvent,
        groupId: data.groupId,
      });
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('messageWithMediaSent')
  async handleMessageWithMedia(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { messageId: string },
  ) {
    const userId = await this.getUserFromSocket(client);
    if (!userId) return;

    // Update last activity
    this.lastActivity.set(client.id, Date.now());

    try {
      // Get the message details
      const message = await this.prisma.message.findUnique({
        where: { id: data.messageId },
      });

      if (!message) {
        client.emit('error', { message: 'Message not found' });
        return;
      }

      // Emit to appropriate rooms based on message type
      if (message.messageType === 'USER') {
        // For direct messages, emit to both sender and receiver
        this.server.to(`user:${message.senderId}`).emit('newMessage', {
          type: 'user',
          message,
          timestamp: new Date(),
        });

        if (message.receiverId) {
          this.server.to(`user:${message.receiverId}`).emit('newMessage', {
            type: 'user',
            message,
            timestamp: new Date(),
          });
        }
      } else if (message.messageType === 'GROUP' && message.groupId) {
        // For group messages, emit to the group
        this.server.to(`group:${message.groupId}`).emit('newMessage', {
          type: 'group',
          message,
          timestamp: new Date(),
        });
      }

      return message;
    } catch (error) {
      client.emit('error', { message: error.message });
    }
  }
}
