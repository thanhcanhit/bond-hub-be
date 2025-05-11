import { IsNotEmpty, IsUUID } from 'class-validator';

export class EndCallDto {
  @IsNotEmpty()
  @IsUUID()
  callId: string;

  @IsNotEmpty()
  @IsUUID()
  userId: string;
}
