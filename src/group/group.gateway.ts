import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventService } from '../event/event.service';

@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/groups',
})
export class GroupGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger('GroupGateway');
  private userSockets: Map<string, Set<Socket>> = new Map();
  private groupRooms: Map<string, Set<string>> = new Map(); // groupId -> Set of userIds

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventService: EventService,
  ) {
    // Lắng nghe sự kiện từ EventService
    this.eventService.eventEmitter.on(
      'group.member.added',
      this.handleGroupMemberAdded.bind(this),
    );
    this.eventService.eventEmitter.on(
      'group.member.removed',
      this.handleGroupMemberRemoved.bind(this),
    );
    this.eventService.eventEmitter.on(
      'group.updated',
      this.handleGroupUpdated.bind(this),
    );
    this.eventService.eventEmitter.on(
      'group.avatar.updated',
      this.handleGroupAvatarUpdated.bind(this),
    );
    this.eventService.eventEmitter.on(
      'group.role.changed',
      this.handleGroupRoleChanged.bind(this),
    );
  }

  handleConnection(client: Socket): void {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client disconnected: ${client.id}`);

    // Clean up user socket mappings
    for (const [userId, sockets] of this.userSockets.entries()) {
      if (sockets.has(client)) {
        sockets.delete(client);
        if (sockets.size === 0) {
          this.userSockets.delete(userId);
        }
        break;
      }
    }
  }

  /**
   * Add a user to a group room
   * @param userId User ID
   * @param groupId Group ID
   */
  async joinGroupRoom(userId: string, groupId: string): Promise<void> {
    // Check if user is a member of the group
    const isMember = await this.prisma.groupMember.findFirst({
      where: {
        groupId,
        userId,
      },
    });

    if (!isMember) {
      this.logger.warn(`User ${userId} is not a member of group ${groupId}`);
      return;
    }

    // Add user to group room
    if (!this.groupRooms.has(groupId)) {
      this.groupRooms.set(groupId, new Set());
    }
    this.groupRooms.get(groupId).add(userId);

    // Join all user's sockets to the group room
    const userSockets = this.userSockets.get(userId);
    if (userSockets) {
      for (const socket of userSockets) {
        socket.join(`group:${groupId}`);
      }
    }

    this.logger.debug(`User ${userId} joined group room ${groupId}`);
  }

  /**
   * Remove a user from a group room
   * @param userId User ID
   * @param groupId Group ID
   */
  leaveGroupRoom(userId: string, groupId: string): void {
    // Remove user from group room
    const groupUsers = this.groupRooms.get(groupId);
    if (groupUsers) {
      groupUsers.delete(userId);
      if (groupUsers.size === 0) {
        this.groupRooms.delete(groupId);
      }
    }

    // Leave all user's sockets from the group room
    const userSockets = this.userSockets.get(userId);
    if (userSockets) {
      for (const socket of userSockets) {
        socket.leave(`group:${groupId}`);
      }
    }

    this.logger.debug(`User ${userId} left group room ${groupId}`);
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
    const { groupId, userId, addedById } = payload;
    this.logger.debug(
      `Handling group.member.added event: ${groupId}, ${userId}`,
    );

    // Tự động thêm người dùng vào phòng nhóm
    this.joinGroupRoom(userId, groupId);

    // Thông báo cho các thành viên trong nhóm
    this.notifyMemberAdded(groupId, {
      groupId,
      userId,
      addedById,
      timestamp: new Date(),
    });
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
    const { groupId, userId, removedById } = payload;
    this.logger.debug(
      `Handling group.member.removed event: ${groupId}, ${userId}`,
    );

    // Xóa người dùng khỏi phòng nhóm
    this.leaveGroupRoom(userId, groupId);

    // Thông báo cho các thành viên trong nhóm
    this.notifyMemberRemoved(groupId, {
      groupId,
      userId,
      removedById,
      timestamp: new Date(),
    });
  }

  /**
   * Xử lý sự kiện cập nhật thông tin nhóm
   * @param payload Dữ liệu sự kiện
   */
  private handleGroupUpdated(payload: {
    groupId: string;
    data: any;
    updatedById: string;
  }): void {
    const { groupId, data, updatedById } = payload;
    this.logger.debug(`Handling group.updated event: ${groupId}`);

    // Thông báo cho các thành viên trong nhóm
    this.notifyGroupUpdated(groupId, {
      groupId,
      data,
      updatedById,
      timestamp: new Date(),
    });
  }

  /**
   * Xử lý sự kiện cập nhật ảnh đại diện nhóm
   * @param payload Dữ liệu sự kiện
   */
  private handleGroupAvatarUpdated(payload: {
    groupId: string;
    avatarUrl: string;
    updatedById: string;
  }): void {
    const { groupId, avatarUrl, updatedById } = payload;
    this.logger.debug(`Handling group.avatar.updated event: ${groupId}`);

    // Thông báo cho các thành viên trong nhóm
    this.notifyAvatarUpdated(groupId, {
      groupId,
      avatarUrl,
      updatedById,
      timestamp: new Date(),
    });
  }

  /**
   * Xử lý sự kiện thay đổi vai trò thành viên
   * @param payload Dữ liệu sự kiện
   */
  private handleGroupRoleChanged(payload: {
    groupId: string;
    userId: string;
    role: string;
    updatedById: string;
  }): void {
    const { groupId, userId, role, updatedById } = payload;
    this.logger.debug(
      `Handling group.role.changed event: ${groupId}, ${userId}, ${role}`,
    );

    // Thông báo cho các thành viên trong nhóm
    this.notifyRoleChanged(groupId, {
      groupId,
      userId,
      role,
      updatedById,
      timestamp: new Date(),
    });
  }

  /**
   * Notify group members about a group update
   * @param groupId Group ID
   * @param data Update data
   */
  notifyGroupUpdated(groupId: string, data: Record<string, any>): void {
    this.server.to(`group:${groupId}`).emit('groupUpdated', data);
  }

  /**
   * Notify group members about a new member
   * @param groupId Group ID
   * @param data Member data
   */
  notifyMemberAdded(groupId: string, data: Record<string, any>): void {
    this.server.to(`group:${groupId}`).emit('memberAdded', data);
  }

  /**
   * Notify group members about a member removal
   * @param groupId Group ID
   * @param data Member data
   */
  notifyMemberRemoved(groupId: string, data: Record<string, any>): void {
    this.server.to(`group:${groupId}`).emit('memberRemoved', data);
  }

  /**
   * Notify group members about a role change
   * @param groupId Group ID
   * @param data Role change data
   */
  notifyRoleChanged(groupId: string, data: Record<string, any>): void {
    this.server.to(`group:${groupId}`).emit('roleChanged', data);
  }

  /**
   * Notify group members about an avatar update
   * @param groupId Group ID
   * @param data Avatar update data
   */
  notifyAvatarUpdated(groupId: string, data: Record<string, any>): void {
    this.server.to(`group:${groupId}`).emit('avatarUpdated', data);
  }
}
