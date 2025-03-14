import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { MessageService } from './message.service';
import { UserMessageDto } from './dtos/user-message.dto';
import { GroupMessageDto } from './dtos/group-message.dto';

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
}
