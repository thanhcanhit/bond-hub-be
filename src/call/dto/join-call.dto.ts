import { IsNotEmpty, IsUUID } from 'class-validator';

export class JoinCallDto {
  @IsNotEmpty()
  @IsUUID()
  callId: string;

  @IsNotEmpty()
  @IsUUID()
  userId: string;
}
