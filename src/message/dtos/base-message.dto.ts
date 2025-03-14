import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class MessageContentDto {
  @IsString()
  text: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  media: string[] = [];
}

export class BaseCreateMessageDto {
  @Type(() => MessageContentDto)
  @ValidateNested()
  content: MessageContentDto;

  @IsUUID()
  senderId: string;

  @IsUUID()
  @IsOptional()
  repliedTo?: string;
}
