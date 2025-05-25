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
import { SummarizeRequestDto } from './dto/summarize-request.dto';
import { EnhanceMessageRequestDto } from './dto/enhance-message-request.dto';
import { FreestyleRequestDto } from './dto/freestyle-request.dto';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly genAI: GoogleGenerativeAI;
  private readonly defaultModel = 'gemini-2.0-flash';
  private readonly flashModel = 'gemini-2.0-flash';

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

  /**
   * Summarize a long text/message
   * @param summarizeRequestDto The request containing the text to summarize
   * @returns The summarized text
   */
  async summarizeText(
    summarizeRequestDto: SummarizeRequestDto,
  ): Promise<{ summary: string }> {
    try {
      const { text, maxLength, previousMessages } = summarizeRequestDto;
      this.logger.log(`Summarizing text of length: ${text.length}`);

      // Calculate appropriate max length if not specified
      const defaultMaxLength = Math.max(Math.floor(text.length * 0.3), 100);
      const maxLengthValue = maxLength ? parseInt(maxLength) : defaultMaxLength;

      // Get the model for summarization (using flash model for faster response)
      const model = this.genAI.getGenerativeModel({
        model: this.flashModel,
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

      // Prepare context instructions
      let contextInstructions = '';
      if (previousMessages && previousMessages.length > 0) {
        contextInstructions = '\n\nPrevious conversation context:\n';
        previousMessages.forEach((msg) => {
          contextInstructions += `${msg.senderName} (${msg.type}): ${msg.content}\n`;
        });
      }

      // System instructions in English for better AI comprehension
      const systemInstructions = `SMART SUMMARIZATION - MAX ${maxLengthValue} CHARACTERS

MANDATORY RULES:
1. Return ONLY the summary content, NO introductions or formatting
2. DO NOT start with "I will", "Here is", "Summary", "Below"
3. DO NOT use bullet points, numbering, or special symbols
4. DO NOT add personal comments, evaluations, or conclusions
5. MAXIMUM ${maxLengthValue} characters including spaces

SUMMARIZATION APPROACH:
- Extract core information and important context
- Retain key details that help understand the situation
- Use concise, clear language
- Combine related information into flowing sentences
- Prioritize information that helps readers grasp the full picture

LANGUAGE: Write in Vietnamese if original text is Vietnamese, English if original text is English.`;

      // Generate summary
      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `${systemInstructions}\n\nTEXT TO SUMMARIZE:\n${text}${contextInstructions}`,
              },
            ],
          },
        ],
      });

      let summary = result.response.text().trim();

      // Clean up any unwanted prefixes
      const unwantedPrefixes = [
        'Tóm tắt:',
        'Tóm tắt',
        'Đây là tóm tắt:',
        'Đây là tóm tắt',
        'Nội dung tóm tắt:',
        'Nội dung:',
        'Dưới đây là tóm tắt:',
        'Tôi sẽ tóm tắt:',
        'Được rồi,',
        'Được rồi:',
        'Summary:',
        'Here is the summary:',
        'The summary is:',
        'Summary',
      ];

      for (const prefix of unwantedPrefixes) {
        if (summary.toLowerCase().startsWith(prefix.toLowerCase())) {
          summary = summary.substring(prefix.length).trim();
        }
      }

      // Ensure summary doesn't exceed the max length
      if (summary.length > maxLengthValue) {
        this.logger.log(
          `Summary exceeds max length (${summary.length}/${maxLengthValue}), truncating...`,
        );

        const truncationResult = await model.generateContent({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `TASK: Shorten the text below to maximum ${maxLengthValue} characters while preserving the main meaning.

RULES:
- Return ONLY the shortened content
- NO introductions or comments
- Maximum ${maxLengthValue} characters

TEXT TO SHORTEN:\n${summary}`,
                },
              ],
            },
          ],
        });

        summary = truncationResult.response.text().trim();

        // Clean unwanted prefixes again after truncation
        for (const prefix of unwantedPrefixes) {
          if (summary.toLowerCase().startsWith(prefix.toLowerCase())) {
            summary = summary.substring(prefix.length).trim();
          }
        }
      }

      return { summary };
    } catch (error) {
      this.logger.error('Error summarizing text:', error);
      throw new InternalServerErrorException(
        'Failed to summarize text: ' + (error.message || 'Unknown error'),
      );
    }
  }

  /**
   * Enhance a message to be more professional and appropriate for work context
   * @param enhanceMessageRequestDto The request containing the message to enhance
   * @returns The enhanced message
   */
  async enhanceMessage(
    enhanceMessageRequestDto: EnhanceMessageRequestDto,
  ): Promise<{ enhancedMessage: string }> {
    try {
      const { message, previousMessages } = enhanceMessageRequestDto;
      this.logger.log(`Enhancing message: ${message.substring(0, 50)}...`);

      // Get the model for enhancing messages
      const model = this.genAI.getGenerativeModel({
        model: this.flashModel,
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

      // Prepare context instructions
      let contextInstructions = '';
      if (previousMessages && previousMessages.length > 0) {
        contextInstructions = '\n\nConversation context:\n';
        previousMessages.forEach((msg) => {
          contextInstructions += `${msg.senderName} (${msg.type}): ${msg.content}\n`;
        });
      }

      // System instructions in English for better AI comprehension
      const systemInstructions = `PROFESSIONAL MESSAGE ENHANCEMENT

MANDATORY RULES:
1. Return ONLY the enhanced message
2. NO introductions like "Here is the improved message", "I will", "Okay"
3. NO comments or explanations
4. DO NOT change main content or factual information
5. DO NOT add new information not present in original message

EQ & COMMUNICATION PRINCIPLES:
- Show respect and understanding for the recipient
- Use positive, constructive language instead of negative
- Adjust formality level appropriate for work relationships
- Add subtle emotional expressions, not excessive
- Inspire and encourage when appropriate
- Handle negative feedback gently and constructively
- Be friendly while maintaining professionalism
- Avoid rigid or robotic tone

ENHANCEMENT TECHNIQUES:
- Fix spelling and grammar errors
- Improve sentence structure for clarity
- Add appropriate polite expressions
- Adjust tone to fit workplace environment
- Maintain original length and overall style

LANGUAGE: Keep the same language as the original message (Vietnamese or English).`;

      // Generate enhanced message
      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `${systemInstructions}\n\nMESSAGE TO ENHANCE:\n"${message}"${contextInstructions}`,
              },
            ],
          },
        ],
      });

      let enhancedMessage = result.response.text().trim();

      // Clean up any unwanted prefixes or formatting
      const unwantedPrefixes = [
        'Đây là tin nhắn đã được cải thiện:',
        'Đây là tin nhắn đã cải thiện:',
        'Tin nhắn đã được nâng cấp:',
        'Tin nhắn sau khi cải thiện:',
        'Phiên bản cải thiện:',
        'Tôi sẽ cải thiện:',
        'Được rồi,',
        'Được rồi:',
        'Here is the enhanced message:',
        'Enhanced message:',
        'The improved message is:',
        'Improved version:',
      ];

      for (const prefix of unwantedPrefixes) {
        if (enhancedMessage.toLowerCase().startsWith(prefix.toLowerCase())) {
          enhancedMessage = enhancedMessage.substring(prefix.length).trim();
        }
      }

      // Remove quotes if the entire message is wrapped in quotes
      if (enhancedMessage.startsWith('"') && enhancedMessage.endsWith('"')) {
        enhancedMessage = enhancedMessage.slice(1, -1).trim();
      }
      if (enhancedMessage.startsWith("'") && enhancedMessage.endsWith("'")) {
        enhancedMessage = enhancedMessage.slice(1, -1).trim();
      }

      return { enhancedMessage };
    } catch (error) {
      this.logger.error('Error enhancing message:', error);
      throw new InternalServerErrorException(
        'Failed to enhance message: ' + (error.message || 'Unknown error'),
      );
    }
  }

  /**
   * Freestyle AI response with custom system prompt
   * @param freestyleRequestDto The request containing the prompt and system prompt
   * @returns The AI-generated response
   */
  async freestyle(
    freestyleRequestDto: FreestyleRequestDto,
  ): Promise<{ response: string }> {
    try {
      const { prompt, systemPrompt } = freestyleRequestDto;
      this.logger.log(
        `Generating freestyle response for prompt: ${prompt.substring(0, 50)}...`,
      );

      // Get the model for freestyle responses
      const model = this.genAI.getGenerativeModel({
        model: this.flashModel,
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

      // Generate freestyle response without using system role (not supported in Gemini-2.0-Flash)
      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `${systemPrompt}\n\nLưu ý: Trả lời TRỰC TIẾP với nội dung cần thiết, KHÔNG thêm các câu mở đầu như "Được rồi", "Tôi sẽ", "Đây là câu trả lời".\n\n${prompt}`,
              },
            ],
          },
        ],
      });

      const response = result.response.text();
      return { response };
    } catch (error) {
      this.logger.error('Error generating freestyle response:', error);
      throw new InternalServerErrorException(
        'Failed to generate freestyle response: ' +
          (error.message || 'Unknown error'),
      );
    }
  }
}
