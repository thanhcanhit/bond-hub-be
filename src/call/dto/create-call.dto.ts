import { IsEnum, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import { CallType } from '@prisma/client';

export class CreateCallDto {
  @IsNotEmpty()
  @IsUUID()
  initiatorId: string;

  @IsOptional()
  @IsUUID()
  receiverId?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;

  @IsEnum(CallType)
  @IsNotEmpty()
  type: CallType;
}
