import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class FreestyleRequestDto {
  @ApiProperty({
    description: 'The prompt to send to the AI model',
    example: 'Write a short poem about friendship',
  })
  @IsNotEmpty()
  @IsString()
  prompt: string;

  @ApiProperty({
    description: 'Custom system prompt to guide the AI response',
    example: 'You are a creative writing assistant who specializes in poetry.',
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  systemPrompt: string;
}
