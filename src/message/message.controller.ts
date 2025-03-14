import { Body, Controller, Post } from '@nestjs/common';
import { MessageService } from './message.service';
import { UserMessageDto } from './dtos/user-message.dto';
import { GroupMessageDto } from './dtos/group-message.dto';

@Controller('messages')
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  @Post('/user')
  async createUserMessage(@Body() message: UserMessageDto) {
    return this.messageService.createUserMessage(message);
  }

  @Post('/group')
  async createGroupMessage(@Body() message: GroupMessageDto) {
    return this.messageService.createGroupMessage(message);
  }
}
