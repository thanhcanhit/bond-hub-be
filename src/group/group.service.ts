import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Group, GroupMember, GroupRole } from '@prisma/client';
import { CreateGroupDto, UpdateGroupDto, AddMemberDto } from './dto';

@Injectable()
export class GroupService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createGroupDto: CreateGroupDto): Promise<Group> {
    return this.prisma.group.create({
      data: {
        name: createGroupDto.name,
        creatorId: createGroupDto.creatorId,
        avatarUrl: createGroupDto.avatarUrl,
        members: {
          create: {
            userId: createGroupDto.creatorId,
            role: GroupRole.LEADER,
            addedById: createGroupDto.creatorId,
          },
        },
      },
      include: {
        members: true,
      },
    });
  }

  async findAll(): Promise<Group[]> {
    return this.prisma.group.findMany({
      include: {
        members: true,
      },
    });
  }

  async findOne(id: string): Promise<Group> {
    const group = await this.prisma.group.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                // Include only fields that exist on the User model
                // username, email, and avatarUrl should be checked against your schema
                // and adjusted accordingly
              },
            },
          },
        },
      },
    });

    if (!group) {
      throw new NotFoundException(`Group with ID ${id} not found`);
    }

    return group;
  }

  async update(
    id: string,
    updateGroupDto: UpdateGroupDto,
    requestUserId: string,
  ): Promise<Group> {
    await this.validateGroupAccess(id, requestUserId, 'update group details');

    try {
      return await this.prisma.group.update({
        where: { id },
        data: updateGroupDto,
      });
    } catch (error) {
      throw new NotFoundException(`Failed to update group: ${error.message}`);
    }
  }

  async remove(id: string, requestUserId: string): Promise<Group> {
    await this.validateGroupAccess(id, requestUserId, 'delete groups');

    try {
      // First delete all group members
      await this.prisma.groupMember.deleteMany({
        where: { groupId: id },
      });

      // Then delete the group
      return await this.prisma.group.delete({
        where: { id },
      });
    } catch (_error) {
      throw new NotFoundException(`Group with ID ${id} not found ${_error}`);
    }
  }

  async findUserGroups(userId: string): Promise<Group[]> {
    return this.prisma.group.findMany({
      where: {
        members: {
          some: {
            userId,
          },
        },
      },
      include: {
        members: true,
      },
    });
  }

  async addMember(addMemberDto: AddMemberDto): Promise<GroupMember> {
    const { groupId, userId, addedById, role } = addMemberDto;

    // Check if user is already a member
    const existingMember = await this.prisma.groupMember.findFirst({
      where: {
        groupId,
        userId,
      },
    });

    if (existingMember) {
      return existingMember;
    }

    return this.prisma.groupMember.create({
      data: {
        groupId,
        userId,
        addedById,
        role,
      },
      include: {
        user: {
          select: {
            id: true,
          },
        },
        group: true,
      },
    });
  }

  async removeMember(
    groupId: string,
    userId: string,
    requestUserId: string,
  ): Promise<void> {
    await this.validateGroupAccess(groupId, requestUserId, 'remove members');

    await this.prisma.groupMember.deleteMany({
      where: {
        groupId,
        userId,
      },
    });
  }

  async updateMemberRole(
    groupId: string,
    userId: string,
    role: GroupRole,
    requestUserId: string,
  ): Promise<GroupMember> {
    // Validate the requester has leadership access and get leadership info
    const {
      group,
      userMembership: requesterMembership,
      leader,
    } = await this.validateGroupAccess(
      groupId,
      requestUserId,
      'update member role',
    );

    // Type assertion to ensure TypeScript recognizes members property
    const groupWithMembers = group as Group & { members: GroupMember[] };

    // Find the target user's membership
    const targetMembership = groupWithMembers.members.find(
      (member) => member.userId === userId,
    );

    if (!targetMembership) {
      throw new NotFoundException(
        `User ${userId} is not a member of group ${groupId}`,
      );
    }

    // Apply role assignment rules based on leadership hierarchy
    let finalRole = role;

    // Rule 1: Only LEADER can assign CO_LEADER role
    if (
      role === GroupRole.CO_LEADER &&
      requesterMembership.role !== GroupRole.LEADER
    ) {
      throw new ForbiddenException(
        'Only group leaders can assign co-leader role',
      );
    }

    // Rule 2: Handle LEADER role assignment
    if (role === GroupRole.LEADER) {
      // If there's already a leader and it's not the target user
      if (leader && leader.userId !== userId) {
        // If the requester is the current leader, it's a leadership transfer
        if (leader.userId === requestUserId) {
          // Step 1: Demote current leader to co-leader
          await this.prisma.groupMember.update({
            where: { id: leader.id },
            data: { role: GroupRole.CO_LEADER },
          });
          // Step 2: Allow target to become new leader
          finalRole = GroupRole.LEADER;
        } else {
          // If requester is not the current leader, convert to CO_LEADER instead
          finalRole = GroupRole.CO_LEADER;
        }
      }
    }

    // Apply the role change
    return this.prisma.groupMember.update({
      where: { id: targetMembership.id },
      data: { role: finalRole },
    });
  }

  private async getMembershipId(
    groupId: string,
    userId: string,
  ): Promise<string> {
    const membership = await this.prisma.groupMember.findFirst({
      where: {
        groupId,
        userId,
      },
      select: {
        id: true,
      },
    });

    if (!membership) {
      throw new NotFoundException(
        `User ${userId} is not a member of group ${groupId}`,
      );
    }

    return membership.id;
  }

  /**
   * Validates if a user has leadership access to a group and returns group info with leadership details
   *
   * @param groupId The ID of the group
   * @param userId The ID of the user requesting access
   * @param operation The operation description for error messages
   * @returns Object containing the group, user membership, leader and co-leader information
   * @throws NotFoundException if the group doesn't exist
   * @throws ForbiddenException if the user is not a leader or co-leader
   */
  private async validateGroupAccess(
    groupId: string,
    userId: string,
    operation: string,
  ): Promise<{
    group: Group;
    userMembership: GroupMember;
    leader: GroupMember | undefined;
    coLeaders: GroupMember[];
  }> {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: {
        members: true,
      },
    });

    if (!group) {
      throw new NotFoundException(`Group with ID ${groupId} not found`);
    }

    const userMembership = group.members.find(
      (member) => member.userId === userId,
    );

    const hasLeadershipRole =
      userMembership &&
      (userMembership.role === GroupRole.LEADER ||
        userMembership.role === GroupRole.CO_LEADER);

    if (!hasLeadershipRole) {
      throw new ForbiddenException(
        `Only group leaders and co-leaders can ${operation}`,
      );
    }

    // Find the leader and co-leaders for the group
    const leader = group.members.find(
      (member) => member.role === GroupRole.LEADER,
    );

    const coLeaders = group.members.filter(
      (member) => member.role === GroupRole.CO_LEADER,
    );

    return {
      group,
      userMembership,
      leader,
      coLeaders,
    };
  }

  async leaveGroup(groupId: string, userId: string): Promise<void> {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: {
        members: true,
      },
    });

    if (!group) {
      throw new NotFoundException(`Group with ID ${groupId} not found`);
    }

    const userMembership = group.members.find(
      (member) => member.userId === userId,
    );

    if (!userMembership) {
      throw new NotFoundException(
        `User ${userId} is not a member of group ${groupId}`,
      );
    }

    // Check if user is the leader
    if (userMembership.role === GroupRole.LEADER) {
      throw new ForbiddenException(
        'Group leader cannot leave the group. Transfer leadership to another member first.',
      );
    }

    // Remove the user from the group
    await this.prisma.groupMember.delete({
      where: {
        id: userMembership.id,
      },
    });
  }
}
