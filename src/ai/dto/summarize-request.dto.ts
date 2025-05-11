import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  IsEnum,
  ArrayMaxSize,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class PreviousMessageDto {
  @ApiProperty({
    description: 'The content of the previous message',
    example: 'Chúng ta cần hoàn thành báo cáo tuần này',
  })
  @IsString()
  content: string;

  @ApiProperty({
    description: 'The type of message sender',
    example: 'user',
    enum: ['user', 'group'],
  })
  @IsEnum(['user', 'group'])
  type: 'user' | 'group';

  @ApiProperty({
    description: 'The ID of the sender (user ID or group ID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  senderId: string;

  @ApiProperty({
    description: 'The name of the sender',
    example: 'John Doe',
  })
  @IsString()
  senderName: string;
}

export class SummarizeRequestDto {
  @ApiProperty({
    description: 'The long text to be summarized',
    example: 'This is a long text/message that needs to be summarized...',
  })
  @IsNotEmpty()
  @IsString()
  text: string;

  @ApiProperty({
    description: 'Optional maximum length for the summary',
    example: 100,
    required: false,
  })
  @IsOptional()
  @IsString()
  maxLength?: string;

  @ApiProperty({
    description: 'Optional array of previous messages for context (max 5)',
    type: [PreviousMessageDto],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PreviousMessageDto)
  @ArrayMaxSize(5)
  previousMessages?: PreviousMessageDto[];
}
