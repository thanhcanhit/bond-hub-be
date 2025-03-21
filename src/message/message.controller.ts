import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
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
    @Request() req: Request,
    @Param('groupId') groupId: string,
    @Query('page') page = 1,
  ) {
    const requestUserId = req['user'].sub;
    return this.messageService.getGroupMessages(requestUserId, groupId, page);
  }

  @Get('/group/:groupId/search')
  async findMessagesInGroup(
    @Request() req: Request,
    @Param('groupId') groupId: string,
    @Query('searchText') searchText: string,
    @Query('page', ParseIntPipe) page = 1,
  ) {
    const requestUserId = req['user'].sub;
    return this.messageService.findMessagesInGroup(groupId, searchText, page);
  }

  @Get('/user/:userIdB/search')
  async findMessagesInUser(
    @Request() req: Request,
    @Param('userIdB', ParseUUIDPipe) userIdB: string,
    @Query('searchText') searchText: string,
    @Query('page', ParseIntPipe) page = 1,
  ) {
    const requestUserId = req['user'].sub;
    return this.messageService.findMessagesInUser(
      requestUserId,
      userIdB,
      searchText,
      page,
    );
  }

  @Get('/user/:userIdB')
  async getUserMessages(
    @Request() req: Request,
    @Param('userIdB', ParseUUIDPipe) userIdB: string,
    @Query('page') page = 1,
  ) {
    const requestUserId = req['user'].sub;
    return this.messageService.getUserMessages(requestUserId, userIdB, page);
  }

  @Post('/user')
  async createUserMessage(
    @Body() messageBody: UserMessageDto,
    @Request() req: Request,
  ) {
    const requestUserId = req['user'].sub;
    return this.messageService.createUserMessage(messageBody, requestUserId);
  }

  @Post('/group')
  async createGroupMessage(
    @Body() messageBody: GroupMessageDto,
    @Request() req: Request,
  ) {
    const requestUserId = req['user'].sub;
    return this.messageService.createGroupMessage(messageBody, requestUserId);
  }

  @Patch('/recall/:messageId')
  async recallMessage(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Request() req: Request,
  ) {
    const requestUserId = req['user'].sub;
    return this.messageService.recallMessage(messageId, requestUserId);
  }

  @Delete('/deleted-self-side/:messageId')
  async deleteMessage(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Request() req: Request,
  ) {
    const requestUserId = req['user'].sub;
    return this.messageService.deleteMessageSelfSide(messageId, requestUserId);
  }

  @Patch('/read/:messageId')
  async readMessage(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Request() req: Request,
  ) {
    const requestUserId = req['user'].sub;
    return this.messageService.readMessage(messageId, requestUserId);
  }

  @Patch('/unread/:messageId')
  async unreadMessage(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Request() req: Request,
  ) {
    const requestUserId = req['user'].sub;
    return this.messageService.unreadMessage(messageId, requestUserId);
  }

  @Post('/reaction')
  async addReaction(
    @Body() reaction: CreateReactionDto,
    @Request() req: Request,
  ) {
    const requestUserId = req['user'].sub;
    return this.messageService.addReaction(reaction, requestUserId);
  }

  @Delete('/reaction/:messageId')
  async removeReaction(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Request() req: Request,
  ) {
    const requestUserId = req['user'].sub;
    return this.messageService.removeReaction(messageId, requestUserId);
  }
}
