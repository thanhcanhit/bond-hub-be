import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class EventService {
  private readonly logger = new Logger(EventService.name);

  constructor(public readonly eventEmitter: EventEmitter2) {}

  // Group events
  emitGroupMemberAdded(
    groupId: string,
    userId: string,
    addedById: string,
  ): void {
    this.logger.debug(`Emitting group.member.added: ${groupId}, ${userId}`);
    this.eventEmitter.emit('group.member.added', {
      groupId,
      userId,
      addedById,
    });
  }

  emitGroupMemberRemoved(
    groupId: string,
    userId: string,
    removedById: string,
    options: { kicked?: boolean; left?: boolean } = {},
  ): void {
    this.logger.debug(`Emitting group.member.removed: ${groupId}, ${userId}`);
    this.eventEmitter.emit('group.member.removed', {
      groupId,
      userId,
      removedById,
      kicked: options.kicked,
      left: options.left,
    });
  }

  emitGroupUpdated(groupId: string, data: any, updatedById: string): void {
    this.logger.debug(`Emitting group.updated: ${groupId}`);
    this.eventEmitter.emit('group.updated', { groupId, data, updatedById });
  }

  emitGroupAvatarUpdated(
    groupId: string,
    avatarUrl: string,
    updatedById: string,
  ): void {
    this.logger.debug(`Emitting group.avatar.updated: ${groupId}`);
    this.eventEmitter.emit('group.avatar.updated', {
      groupId,
      avatarUrl,
      updatedById,
    });
  }

  emitGroupRoleChanged(
    groupId: string,
    userId: string,
    role: string,
    updatedById: string,
  ): void {
    this.logger.debug(
      `Emitting group.role.changed: ${groupId}, ${userId}, ${role}`,
    );
    this.eventEmitter.emit('group.role.changed', {
      groupId,
      userId,
      role,
      updatedById,
    });
  }

  emitGroupDissolved(
    groupId: string,
    groupName: string,
    dissolvedById: string,
    members: Array<{ userId: string }> = [],
  ): void {
    this.logger.debug(
      `Emitting group.dissolved: ${groupId} with ${members.length} members`,
    );
    this.eventEmitter.emit('group.dissolved', {
      groupId,
      groupName,
      dissolvedById,
      timestamp: new Date(),
      members, // Truyền danh sách thành viên để tránh truy vấn database sau khi nhóm đã bị xóa
    });
  }

  // Message events
  emitMessageCreated(message: any): void {
    this.logger.debug(`Emitting message.created: ${message.id}`);
    this.eventEmitter.emit('message.created', { message });
  }

  emitMessageRecalled(messageId: string, userId: string): void {
    this.logger.debug(`Emitting message.recalled: ${messageId}`);
    this.eventEmitter.emit('message.recalled', { messageId, userId });
  }

  emitMessageRead(messageId: string, userId: string): void {
    this.logger.debug(`Emitting message.read: ${messageId}`);
    this.eventEmitter.emit('message.read', { messageId, userId });
  }

  // User events
  emitUserOnline(userId: string): void {
    this.logger.debug(`Emitting user.online: ${userId}`);
    this.eventEmitter.emit('user.online', { userId });
  }

  emitUserOffline(userId: string): void {
    this.logger.debug(`Emitting user.offline: ${userId}`);
    this.eventEmitter.emit('user.offline', { userId });
  }
}
