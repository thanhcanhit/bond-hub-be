import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PreviousMessageDto } from './summarize-request.dto';

export class EnhanceMessageRequestDto {
  @ApiProperty({
    description: 'The original message to be enhanced',
    example: 'Gửi mọi người cái báo cáo nay nha.',
  })
  @IsNotEmpty()
  @IsString()
  message: string;

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
