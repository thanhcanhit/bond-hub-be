import { Controller, Get, Post, Body, Param, Query, Request, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus } from '@nestjs/common';
import { CallService } from './call.service';
import { CreateCallDto, JoinCallDto, EndCallDto } from './dto';
import { Call } from './interfaces/call.interface';

@Controller('calls')
export class CallController {
  constructor(private readonly callService: CallService) {}

  @Post()
  async createCall(@Body() createCallDto: CreateCallDto, @Request() req: Request): Promise<Call> {
    const userId = req['user'].sub;
    
    // Ensure the initiator is the authenticated user
    if (createCallDto.initiatorId !== userId) {
      createCallDto.initiatorId = userId;
    }
    
    return this.callService.createCall(createCallDto);
  }

  @Post('join')
  async joinCall(@Body() joinCallDto: JoinCallDto, @Request() req: Request): Promise<Call> {
    const userId = req['user'].sub;
    
    // Ensure the user is the authenticated user
    if (joinCallDto.userId !== userId) {
      joinCallDto.userId = userId;
    }
    
    return this.callService.joinCall(joinCallDto);
  }

  @Post('end')
  async endCall(@Body() endCallDto: EndCallDto, @Request() req: Request): Promise<Call> {
    const userId = req['user'].sub;
    
    // Ensure the user is the authenticated user
    if (endCallDto.userId !== userId) {
      endCallDto.userId = userId;
    }
    
    return this.callService.endCall(endCallDto);
  }

  @Post(':callId/reject')
  @HttpCode(HttpStatus.OK)
  async rejectCall(
    @Param('callId', ParseUUIDPipe) callId: string,
    @Request() req: Request,
  ): Promise<Call> {
    const userId = req['user'].sub;
    return this.callService.rejectCall(callId, userId);
  }

  @Get(':callId')
  async getCall(
    @Param('callId', ParseUUIDPipe) callId: string,
    @Request() req: Request,
  ): Promise<Call> {
    return this.callService.getCall(callId);
  }

  @Get('user/active')
  async getActiveCallsForUser(@Request() req: Request): Promise<Call[]> {
    const userId = req['user'].sub;
    return this.callService.getActiveCallsForUser(userId);
  }

  @Get('user/history')
  async getCallHistory(
    @Request() req: Request,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ): Promise<{ calls: Call[]; total: number }> {
    const userId = req['user'].sub;
    return this.callService.getCallHistory(userId, page, limit);
  }
}
