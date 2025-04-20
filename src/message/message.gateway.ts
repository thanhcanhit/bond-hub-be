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
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  Inject,
  forwardRef,
} from '@nestjs/common';

import { MessageService } from './message.service';
import { EventService } from '../event/event.service';

// Interface cho tin nhắn với các trường cần thiết
type MessageData = {
  id: string;
  senderId: string;
  receiverId?: string;
  groupId?: string;
  content: any;
  messageType?: 'USER' | 'GROUP';
  reactions?: any[];
  readBy?: string[];
  createdAt?: Date;
  updatedAt?: Date;
  [key: string]: any; // Cho phép các trường khác
};

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
    @Inject(forwardRef(() => MessageService))
    private readonly messageService?: MessageService,
    private readonly eventService?: EventService,
  ) {
    // Lắng nghe sự kiện từ EventService
    if (this.eventService) {
      this.eventService.eventEmitter.on(
        'group.member.added',
        this.handleGroupMemberAdded.bind(this),
      );
      this.eventService.eventEmitter.on(
        'group.member.removed',
        this.handleGroupMemberRemoved.bind(this),
      );
      this.eventService.eventEmitter.on(
        'message.recalled',
        this.handleMessageRecalled.bind(this),
      );
      this.eventService.eventEmitter.on(
        'message.read',
        this.handleMessageRead.bind(this),
      );
      this.eventService.eventEmitter.on(
        'group.dissolved',
        this.handleGroupDissolved.bind(this),
      );
    }
  }

  private async getUserFromSocket(client: Socket): Promise<string> {
    // Đơn giản hóa: lấy userId từ query parameter hoặc sử dụng một giá trị mặc định
    const userId =
      (client.handshake.query.userId as string) ||
      (client.handshake.auth.userId as string);

    // Nếu có userId trong query hoặc auth, sử dụng nó
    if (userId) {
      return userId;
    }

    // Nếu không có userId, tạo một ID ngẫu nhiên
    const randomId = Math.random().toString(36).substring(2, 15);
    this.logger.debug(
      `Generated random userId: ${randomId} for socket ${client.id}`,
    );
    return randomId;
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
    // Không cần kiểm tra userId nữa vì luôn có giá trị

    this.addUserSocket(userId, client);

    // Join user's personal room
    client.join(`user:${userId}`);

    // Join all group rooms the user is a member of
    if (this.messageService) {
      const userGroups = await this.messageService.getUserGroups(userId);
      userGroups.forEach((groupId) => {
        client.join(`group:${groupId}`);
      });
    }

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
      this.removeUserSocket(userId, client);

      // If no more sockets for this user, emit offline status
      if (!this.userSockets.has(userId)) {
        this.server.emit('userStatus', {
          userId,
          status: 'offline',
          timestamp: new Date(),
        });
      }
    });
  }

  @SubscribeMessage('heartbeat')
  handleHeartbeat(@ConnectedSocket() client: Socket) {
    const socketId = client.id;
    this.lastActivity.set(socketId, Date.now());
    return { status: 'ok', timestamp: Date.now() };
  }

  /**
   * Phát sự kiện tin nhắn mới đến người dùng
   * @param message Tin nhắn đã được lưu vào database
   */
  notifyNewUserMessage(message: MessageData) {
    const eventData = {
      type: 'user',
      message,
      timestamp: new Date(),
    };

    // Phát sự kiện đến người gửi
    this.server.to(`user:${message.senderId}`).emit('newMessage', eventData);

    // Phát sự kiện đến người nhận
    if (message.receiverId) {
      this.server
        .to(`user:${message.receiverId}`)
        .emit('newMessage', eventData);

      // Phát sự kiện dừng nhập
      this.server.to(`user:${message.receiverId}`).emit('userTypingStopped', {
        userId: message.senderId,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Phát sự kiện tin nhắn mới đến nhóm
   * @param message Tin nhắn đã được lưu vào database
   */
  notifyNewGroupMessage(message: MessageData) {
    const eventData = {
      type: 'group',
      message,
      timestamp: new Date(),
    };

    // Phát sự kiện đến phòng nhóm
    if (message.groupId) {
      this.server.to(`group:${message.groupId}`).emit('newMessage', eventData);

      // Phát sự kiện dừng nhập
      this.server.to(`group:${message.groupId}`).emit('userTypingStopped', {
        userId: message.senderId,
        groupId: message.groupId,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Phát sự kiện đã đọc tin nhắn
   * @param message Tin nhắn đã được cập nhật trạng thái đọc
   * @param userId ID của người đọc
   */
  notifyMessageRead(message: MessageData, userId: string) {
    const readEvent = {
      messageId: message.id,
      readBy: message.readBy,
      userId,
      timestamp: new Date(),
    };

    // Đối với tin nhắn cá nhân
    if (message.messageType === 'USER') {
      this.server.to(`user:${message.senderId}`).emit('messageRead', readEvent);
      this.server
        .to(`user:${message.receiverId}`)
        .emit('messageRead', readEvent);
    }
    // Đối với tin nhắn nhóm
    else if (message.messageType === 'GROUP') {
      this.server.to(`group:${message.groupId}`).emit('messageRead', readEvent);
    }
  }

  /**
   * Phát sự kiện thu hồi tin nhắn
   * @param message Tin nhắn đã được thu hồi
   * @param userId ID của người thu hồi
   */
  notifyMessageRecalled(message: MessageData, userId: string) {
    const recallEvent = {
      messageId: message.id,
      userId,
      timestamp: new Date(),
    };

    // Đối với tin nhắn cá nhân
    if (message.messageType === 'USER') {
      this.server
        .to(`user:${message.senderId}`)
        .emit('messageRecalled', recallEvent);
      this.server
        .to(`user:${message.receiverId}`)
        .emit('messageRecalled', recallEvent);
    }
    // Đối với tin nhắn nhóm
    else if (message.messageType === 'GROUP') {
      this.server
        .to(`group:${message.groupId}`)
        .emit('messageRecalled', recallEvent);
    }
  }

  /**
   * Phát sự kiện cập nhật phản ứng tin nhắn
   * @param message Tin nhắn đã được cập nhật phản ứng
   * @param userId ID của người thêm/xóa phản ứng
   */
  notifyMessageReactionUpdated(message: MessageData, userId: string) {
    const reactionEvent = {
      messageId: message.id,
      reactions: message.reactions,
      userId,
      timestamp: new Date(),
    };

    // Đối với tin nhắn cá nhân
    if (message.messageType === 'USER') {
      this.server
        .to(`user:${message.senderId}`)
        .emit('messageReactionUpdated', reactionEvent);
      this.server
        .to(`user:${message.receiverId}`)
        .emit('messageReactionUpdated', reactionEvent);
    }
    // Đối với tin nhắn nhóm
    else if (message.messageType === 'GROUP') {
      this.server
        .to(`group:${message.groupId}`)
        .emit('messageReactionUpdated', reactionEvent);
    }
  }

  /**
   * Phát sự kiện xóa tin nhắn (phía người dùng)
   * @param message Tin nhắn đã bị xóa
   * @param userId ID của người xóa tin nhắn
   */
  notifyMessageDeleted(message: MessageData, userId: string) {
    const deleteEvent = {
      messageId: message.id,
      userId,
      deletedBy: message.deletedBy,
      timestamp: new Date(),
    };

    // Chỉ thông báo cho người xóa tin nhắn
    this.server.to(`user:${userId}`).emit('messageDeleted', deleteEvent);
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { receiverId?: string; groupId?: string },
  ) {
    const userId = await this.getUserFromSocket(client);

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

  @SubscribeMessage('getUserStatus')
  async handleGetUserStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userIds: string[] },
  ) {
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

  @SubscribeMessage('stopTyping')
  async handleStopTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { receiverId?: string; groupId?: string },
  ) {
    const userId = await this.getUserFromSocket(client);

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

  /**
   * Phát sự kiện tin nhắn có media
   * @param message Tin nhắn có media đã được lưu vào database
   */
  notifyMessageWithMedia(message: MessageData) {
    // Phát sự kiện dựa trên loại tin nhắn
    if (message.messageType === 'USER') {
      // Đối với tin nhắn cá nhân, phát đến cả người gửi và người nhận
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
      // Đối với tin nhắn nhóm, phát đến phòng nhóm
      this.server.to(`group:${message.groupId}`).emit('newMessage', {
        type: 'group',
        message,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Xử lý sự kiện thêm thành viên vào nhóm
   * @param payload Dữ liệu sự kiện
   */
  private handleGroupMemberAdded(payload: {
    groupId: string;
    userId: string;
    addedById: string;
  }): void {
    const { groupId, userId } = payload;
    this.logger.debug(
      `Handling group.member.added event: ${groupId}, ${userId}`,
    );

    // Tìm tất cả socket của người dùng và thêm vào phòng nhóm
    const userSockets = this.userSockets.get(userId);
    if (userSockets) {
      for (const socket of userSockets) {
        socket.join(`group:${groupId}`);
      }
      this.logger.debug(
        `User ${userId} joined group room ${groupId} via event`,
      );
    }
  }

  /**
   * Xử lý sự kiện xóa thành viên khỏi nhóm
   * @param payload Dữ liệu sự kiện
   */
  private handleGroupMemberRemoved(payload: {
    groupId: string;
    userId: string;
    removedById: string;
  }): void {
    const { groupId, userId } = payload;
    this.logger.debug(
      `Handling group.member.removed event: ${groupId}, ${userId}`,
    );

    // Tìm tất cả socket của người dùng và xóa khỏi phòng nhóm
    const userSockets = this.userSockets.get(userId);
    if (userSockets) {
      for (const socket of userSockets) {
        socket.leave(`group:${groupId}`);
      }
      this.logger.debug(`User ${userId} left group room ${groupId} via event`);
    }
  }

  /**
   * Xử lý sự kiện thu hồi tin nhắn
   * @param payload Dữ liệu sự kiện
   */
  private handleMessageRecalled(payload: {
    messageId: string;
    userId: string;
  }): void {
    const { messageId, userId } = payload;
    this.logger.debug(`Handling message.recalled event: ${messageId}`);

    // Lấy thông tin tin nhắn từ database
    if (this.messageService) {
      this.messageService.findMessageById(messageId).then((message) => {
        if (message) {
          this.notifyMessageRecalled(message, userId);
        }
      });
    }
  }

  /**
   * Xử lý sự kiện đọc tin nhắn
   * @param payload Dữ liệu sự kiện
   */
  private handleMessageRead(payload: {
    messageId: string;
    userId: string;
  }): void {
    const { messageId, userId } = payload;
    this.logger.debug(`Handling message.read event: ${messageId}`);

    // Lấy thông tin tin nhắn từ database
    if (this.messageService) {
      this.messageService.findMessageById(messageId).then((message) => {
        if (message) {
          this.notifyMessageRead(message, userId);
        }
      });
    }
  }

  /**
   * Xử lý sự kiện giải tán nhóm
   * @param payload Dữ liệu sự kiện
   */
  private handleGroupDissolved(payload: {
    groupId: string;
    groupName: string;
    dissolvedById: string;
    timestamp: Date;
  }): void {
    const { groupId } = payload;
    this.logger.debug(`Handling group.dissolved event: ${groupId}`);

    // Xóa phòng nhóm khỏi socket.io
    const roomName = `group:${groupId}`;
    this.server.in(roomName).socketsLeave(roomName);

    this.logger.debug(`All sockets removed from room ${roomName}`);
  }
}
