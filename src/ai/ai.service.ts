import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from '@google/generative-ai';
import { AiRequestDto } from './dto/ai-request.dto';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly genAI: GoogleGenerativeAI;
  private readonly defaultModel = 'gemini-1.5-pro';

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('GOOGLE_AI_API_KEY');
    if (!apiKey) {
      this.logger.error(
        'GOOGLE_AI_API_KEY is not defined in environment variables',
      );
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  /**
   * Generate a response from the AI model
   * @param aiRequestDto The request containing the prompt and optional parameters
   * @returns The AI-generated response
   */
  async generateResponse(
    aiRequestDto: AiRequestDto,
  ): Promise<{ response: string }> {
    try {
      const { prompt, systemPrompt, imageUrls } = aiRequestDto;

      // Get the model
      const model = this.genAI.getGenerativeModel({
        model: this.defaultModel,
        safetySettings: [
          {
            category: HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
          },
        ],
      });

      // Prepare content parts
      const contentParts = [];

      // Add system prompt if provided
      if (systemPrompt) {
        contentParts.push({ text: `System: ${systemPrompt}\n\n` });
      }

      // Add images if provided
      if (imageUrls && imageUrls.length > 0) {
        for (const imageUrl of imageUrls) {
          try {
            const response = await fetch(imageUrl);
            const imageData = await response.arrayBuffer();
            contentParts.push({
              inlineData: {
                data: Buffer.from(imageData).toString('base64'),
                mimeType: response.headers.get('content-type') || 'image/jpeg',
              },
            });
          } catch (error) {
            this.logger.error(
              `Failed to fetch image from URL: ${imageUrl}`,
              error,
            );
            throw new InternalServerErrorException(
              `Failed to fetch image from URL: ${imageUrl}`,
            );
          }
        }
      }

      // Add the main prompt
      contentParts.push({ text: prompt });

      // Generate content
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: contentParts }],
      });

      const response = result.response;
      return { response: response.text() };
    } catch (error) {
      this.logger.error('Error generating AI response:', error);
      throw new InternalServerErrorException(
        'Failed to generate AI response: ' + (error.message || 'Unknown error'),
      );
    }
  }

  /**
   * Generate a streaming response from the AI model
   * @param aiRequestDto The request containing the prompt and optional parameters
   * @returns A stream of the AI-generated response
   */
  async generateStreamingResponse(
    aiRequestDto: AiRequestDto,
  ): Promise<ReadableStream> {
    try {
      const { prompt, systemPrompt, imageUrls } = aiRequestDto;

      // Get the model
      const model = this.genAI.getGenerativeModel({
        model: this.defaultModel,
        safetySettings: [
          {
            category: HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
          },
        ],
      });

      // Prepare content parts
      const contentParts = [];

      // Add system prompt if provided
      if (systemPrompt) {
        contentParts.push({ text: `System: ${systemPrompt}\n\n` });
      }

      // Add images if provided
      if (imageUrls && imageUrls.length > 0) {
        for (const imageUrl of imageUrls) {
          try {
            const response = await fetch(imageUrl);
            const imageData = await response.arrayBuffer();
            contentParts.push({
              inlineData: {
                data: Buffer.from(imageData).toString('base64'),
                mimeType: response.headers.get('content-type') || 'image/jpeg',
              },
            });
          } catch (error) {
            this.logger.error(
              `Failed to fetch image from URL: ${imageUrl}`,
              error,
            );
            throw new InternalServerErrorException(
              `Failed to fetch image from URL: ${imageUrl}`,
            );
          }
        }
      }

      // Add the main prompt
      contentParts.push({ text: prompt });

      // Generate streaming content
      const result = await model.generateContentStream({
        contents: [{ role: 'user', parts: contentParts }],
      });

      // Create a ReadableStream from the streaming result
      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of result.stream) {
              const text = chunk.text();
              if (text) {
                controller.enqueue(text);
              }
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });

      return stream;
    } catch (error) {
      this.logger.error('Error generating streaming AI response:', error);
      throw new InternalServerErrorException(
        'Failed to generate streaming AI response: ' +
          (error.message || 'Unknown error'),
      );
    }
  }
}
