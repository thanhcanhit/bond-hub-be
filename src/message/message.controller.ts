import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { MessageService } from './message.service';
import { UserMessageDto } from './dtos/user-message.dto';
import { GroupMessageDto } from './dtos/group-message.dto';
import { CreateReactionDto } from './dtos/create-reaction.dto';

@Controller('messages')
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  @Get('/group/:groupId')
  async getGroupMessages(
    @Param('groupId') groupId: string,
    @Query('page') page = 1,
  ) {
    return this.messageService.getGroupMessages(groupId, page);
  }

  @Get('/user')
  async getUserMessages(
    @Body('userIdA', ParseUUIDPipe) userIdA: string,
    @Body('userIdB', ParseUUIDPipe) userIdB: string,
    @Query('page') page = 1,
  ) {
    return this.messageService.getUserMessages(userIdA, userIdB, page);
  }

  @Post('/user')
  async createUserMessage(@Body() message: UserMessageDto) {
    return this.messageService.createUserMessage(message);
  }

  @Post('/group')
  async createGroupMessage(@Body() message: GroupMessageDto) {
    return this.messageService.createGroupMessage(message);
  }

  // TODO: Check jwt user id = message sender id
  @Patch('/recall/:messageId')
  async recallMessage(@Param('messageId', ParseUUIDPipe) messageId: string) {
    return this.messageService.recallMessage(messageId);
  }

  @Patch('read/:messageId')
  async readMessage(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body('readerId') readerId: string,
  ) {
    return this.messageService.readMessage(messageId, readerId);
  }

  @Patch('unread/:messageId')
  async unreadMessage(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body('readerId') readerId: string,
  ) {
    return this.messageService.unreadMessage(messageId, readerId);
  }

  @Post('/reaction')
  async addReaction(@Body() reaction: CreateReactionDto) {
    return this.messageService.addReaction(reaction);
  }

  @Delete('/reaction/:messageId')
  async removeReaction(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body('userId') userId: string,
  ) {
    return this.messageService.removeReaction(messageId, userId);
  }
}
