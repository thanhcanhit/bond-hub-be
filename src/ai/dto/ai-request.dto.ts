import { IsNotEmpty, IsString, IsOptional, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AiRequestDto {
  @ApiProperty({
    description: 'The prompt to send to the AI model',
    example: 'Explain the concept of event-driven architecture',
  })
  @IsNotEmpty()
  @IsString()
  prompt: string;

  @ApiProperty({
    description: 'Optional system prompt to guide the AI response',
    example:
      'You are a helpful assistant that explains technical concepts clearly and concisely.',
    required: false,
  })
  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @ApiProperty({
    description:
      'Optional array of image URLs to include in the prompt (for multimodal models)',
    example: ['https://example.com/image1.jpg'],
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];
}
