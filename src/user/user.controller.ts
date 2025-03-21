import { Controller, Get, Param, NotFoundException } from '@nestjs/common';

import { UserService } from './user.service';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  async getAllUsers() {
    return this.userService.getAllUsers();
  }

  @Get(':id')
  async getUserById(@Param('id') id: string) {
    const user = await this.userService.getUserById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  @Get(':id/basic-info')
  async getUserBasicInfo(@Param('id') id: string) {
    const userInfo = await this.userService.getUserBasicInfo(id);
    if (!userInfo) {
      throw new NotFoundException('User info not found');
    }
    return userInfo;
  }
}
