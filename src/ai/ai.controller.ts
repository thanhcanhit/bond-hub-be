import {
  Controller,
  Post,
  Body,
  Logger,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { AiRequestDto } from './dto/ai-request.dto';
import { Readable } from 'stream';
import { Public } from '../auth/public.decorator';
import { SummarizeRequestDto } from './dto/summarize-request.dto';
import { EnhanceMessageRequestDto } from './dto/enhance-message-request.dto';
import { FreestyleRequestDto } from './dto/freestyle-request.dto';

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

  @Post('summarize')
  @Public()
  @ApiOperation({ summary: 'Summarize a long text or message with context' })
  @ApiBody({ type: SummarizeRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Returns the summarized text',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async summarizeText(@Body() summarizeRequestDto: SummarizeRequestDto) {
    this.logger.log(
      `Summarizing text of length: ${summarizeRequestDto.text.length} with ${summarizeRequestDto.previousMessages?.length || 0} previous messages`,
    );
    return this.aiService.summarizeText(summarizeRequestDto);
  }

  @Post('enhance')
  @Public()
  @ApiOperation({
    summary: 'Enhance a message to be more professional with context',
  })
  @ApiBody({ type: EnhanceMessageRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Returns the enhanced message',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async enhanceMessage(
    @Body() enhanceMessageRequestDto: EnhanceMessageRequestDto,
  ) {
    this.logger.log(
      `Enhancing message: ${enhanceMessageRequestDto.message.substring(0, 50)}... with ${enhanceMessageRequestDto.previousMessages?.length || 0} previous messages`,
    );
    return this.aiService.enhanceMessage(enhanceMessageRequestDto);
  }

  @Post('freestyle')
  @Public()
  @ApiOperation({
    summary: 'Generate a freestyle AI response with custom system prompt',
  })
  @ApiBody({ type: FreestyleRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Returns the AI-generated response',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async freestyleResponse(@Body() freestyleRequestDto: FreestyleRequestDto) {
    this.logger.log(
      `Generating freestyle response for prompt: ${freestyleRequestDto.prompt.substring(0, 50)}...`,
    );
    return this.aiService.freestyle(freestyleRequestDto);
  }
}
