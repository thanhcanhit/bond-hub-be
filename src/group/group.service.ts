import { Injectable, NotFoundException } from '@nestjs/common';
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

  async update(id: string, updateGroupDto: UpdateGroupDto): Promise<Group> {
    try {
      return await this.prisma.group.update({
        where: { id },
        data: updateGroupDto,
      });
    } catch (_error) {
      throw new NotFoundException(`Group with ID ${id} not found ${_error}`);
    }
  }

  async remove(id: string): Promise<Group> {
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
            // Include only fields that exist on the User model
          },
        },
        group: true,
      },
    });
  }

  async removeMember(groupId: string, userId: string): Promise<void> {
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
  ): Promise<GroupMember> {
    const membershipId = await this.getMembershipId(groupId, userId);
    return this.prisma.groupMember.update({
      where: {
        id: membershipId,
      },
      data: {
        role,
      },
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
}
