import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  Request,
} from '@nestjs/common';
import { GroupService } from './group.service';
import { CreateGroupDto, UpdateGroupDto, AddMemberDto } from './dto';
import { GroupRole } from '@prisma/client';

@Controller('groups')
export class GroupController {
  constructor(private readonly groupService: GroupService) {}

  @Post()
  create(@Body() createGroupDto: CreateGroupDto) {
    return this.groupService.create(createGroupDto);
  }

  @Get('user')
  findUserGroups(@Request() req: Request) {
    const currentUserId = req['user'].sub;
    return this.groupService.findUserGroups(currentUserId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.groupService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateGroupDto: UpdateGroupDto,
    @Request() req: Request,
  ) {
    const requestUserId = req['user'].sub;
    return this.groupService.update(id, updateGroupDto, requestUserId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Request() req: Request) {
    const requestUserId = req['user'].sub;
    return this.groupService.remove(id, requestUserId);
  }

  @Post('members')
  addMember(@Body() addMemberDto: AddMemberDto) {
    return this.groupService.addMember(addMemberDto);
  }

  @Delete(':groupId/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @Param('groupId') groupId: string,
    @Param('userId') removeUserId: string,
    @Request() req: Request,
  ) {
    const requestUserId = req['user'].sub;
    return this.groupService.removeMember(groupId, removeUserId, requestUserId);
  }

  @Patch(':groupId/members/:userId/role')
  updateMemberRole(
    @Param('groupId') groupId: string,
    @Param('userId') userId: string,
    @Body('role') role: GroupRole,
    @Request() req: Request,
  ) {
    const requestUserId = req['user'].sub;
    return this.groupService.updateMemberRole(
      groupId,
      userId,
      role,
      requestUserId,
    );
  }

  @Post(':groupId/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  leaveGroup(@Param('groupId') groupId: string, @Request() req: Request) {
    const userId = req['user'].sub;
    return this.groupService.leaveGroup(groupId, userId);
  }
}
