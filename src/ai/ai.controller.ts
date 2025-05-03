import {
  Controller,
  Post,
  Body,
  Logger,
  Res,
  HttpStatus,
  StreamableFile,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { AiRequestDto } from './dto/ai-request.dto';
import { Readable } from 'stream';
import { Public } from '../auth/public.decorator';

@ApiTags('ai')
@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(private readonly aiService: AiService) {}

  @Post('generate')
  @Public()
  @ApiOperation({ summary: 'Generate AI response' })
  @ApiBody({ type: AiRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Returns the AI-generated response',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async generateResponse(@Body() aiRequestDto: AiRequestDto) {
    this.logger.log(
      `Generating AI response for prompt: ${aiRequestDto.prompt.substring(0, 50)}...`,
    );
    return this.aiService.generateResponse(aiRequestDto);
  }

  @Post('generate/stream')
  @Public()
  @ApiOperation({ summary: 'Generate streaming AI response' })
  @ApiBody({ type: AiRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Returns a stream of the AI-generated response',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async generateStreamingResponse(
    @Body() aiRequestDto: AiRequestDto,
    @Res() response: Response,
  ) {
    try {
      this.logger.log(
        `Generating streaming AI response for prompt: ${aiRequestDto.prompt.substring(0, 50)}...`,
      );

      // Set headers for SSE
      response.setHeader('Content-Type', 'text/event-stream');
      response.setHeader('Cache-Control', 'no-cache');
      response.setHeader('Connection', 'keep-alive');

      const stream =
        await this.aiService.generateStreamingResponse(aiRequestDto);

      // Create a readable stream from the ReadableStream
      const reader = stream.getReader();
      const readable = new Readable({
        async read() {
          try {
            const { done, value } = await reader.read();
            if (done) {
              this.push(null); // End of stream
              response.end();
            } else {
              // Format as SSE
              this.push(`data: ${value}\n\n`);
            }
          } catch (error) {
            this.destroy(error);
          }
        },
      });

      // Pipe the readable stream to the response
      readable.pipe(response);
    } catch (error) {
      this.logger.error('Error in streaming response:', error);
      if (!response.headersSent) {
        response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          message: 'Failed to generate streaming AI response',
          error: error.message,
        });
      } else {
        response.end();
      }
    }
  }
}
