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

      const maxLengthInstructions = `Tóm tắt phải ngắn gọn, không quá ${maxLengthValue} ký tự.`;

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
        contextInstructions = '\n\nĐây là ngữ cảnh trước đó:\n';
        previousMessages.forEach((msg) => {
          contextInstructions += `- ${msg.senderName} (${msg.type}): "${msg.content}"\n`;
        });
        contextInstructions +=
          '\nHãy sử dụng ngữ cảnh trên để tóm tắt tốt hơn.';
      }

      // Prepare system instructions for super-concise summarization
      const systemInstructions = `Bạn là chuyên gia tóm tắt siêu ngắn gọn. Nhiệm vụ: truyền tải ý chính và bối cảnh quan trọng của văn bản trong KHÔNG QUÁ ${maxLengthValue} ký tự.

Quy tắc tóm tắt siêu ngắn gọn:
- Nắm bắt TINH TÚY và Ý NGHĨA CHÍNH, bỏ qua chi tiết phụ
- Dùng từ ngữ NGẮN GỌN, chính xác, cô đọng thông tin
- Ưu tiên cấu trúc ngắn thay vì câu dài
- Giữ lại số liệu quan trọng, từ khóa thiết yếu
- Loại bỏ từ không cần thiết và từ ngữ mang tính hình thức
- Bảo đảm tóm tắt có thể đứng độc lập, người đọc hiểu được nội dung chính
- Tóm tắt bằng các ĐIỂM CHÍNH nếu phù hợp

${maxLengthInstructions} Viết bằng tiếng Việt nếu văn bản gốc là tiếng Việt.`;

      // Generate summary without using system role (not supported in Gemini-2.0-Flash)
      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `${systemInstructions}\n\nĐây là văn bản cần tóm tắt:\n\n${text}${contextInstructions}\n\nTạo tóm tắt CỰC NGẮN GỌN (tối đa ${maxLengthValue} ký tự) cung cấp TINH TÚY của văn bản, đảm bảo người đọc nắm bắt được nội dung thiết yếu.`,
              },
            ],
          },
        ],
      });

      let summary = result.response.text();

      // Ensure summary doesn't exceed the max length
      if (summary.length > maxLengthValue) {
        this.logger.log(
          `Summary exceeds max length (${summary.length}/${maxLengthValue}), truncating...`,
        );
        const model = this.genAI.getGenerativeModel({
          model: this.flashModel,
        });

        const truncationResult = await model.generateContent({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Đây là một bản tóm tắt nhưng vẫn quá dài (${summary.length} ký tự):\n\n"${summary}"\n\nHãy rút gọn lại, KHÔNG QUÁ ${maxLengthValue} ký tự, giữ lại ý chính quan trọng nhất.`,
                },
              ],
            },
          ],
        });

        summary = truncationResult.response.text();
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
        contextInstructions = '\n\nĐây là ngữ cảnh trước đó:\n';
        previousMessages.forEach((msg) => {
          contextInstructions += `- ${msg.senderName} (${msg.type}): "${msg.content}"\n`;
        });
        contextInstructions +=
          '\nHãy sử dụng ngữ cảnh trên để cải thiện tin nhắn phù hợp hơn.';
      }

      // Prepare system instructions with enhanced EQ focus
      const systemInstructions = `Bạn là một trợ lý cải thiện cách giao tiếp với trí tuệ cảm xúc (EQ) cao. Nhiệm vụ của bạn là nâng cấp tin nhắn của người dùng để thể hiện sự chuyên nghiệp, tế nhị và tinh tế trong môi trường làm việc.
      
      Hướng dẫn về EQ và cách ăn nói khéo léo:
      - Thể hiện sự tôn trọng và thấu hiểu đối với người nhận
      - Sử dụng ngôn từ tích cực, xây dựng thay vì tiêu cực, áp đặt
      - Điều chỉnh độ trang trọng phù hợp với mối quan hệ và văn hóa công ty
      - Thêm biểu hiện cảm xúc phù hợp (nhưng không quá lố)
      - Sử dụng câu từ truyền cảm hứng và động viên khi cần thiết
      - Khi từ chối hay đưa ra phản hồi tiêu cực, hãy làm một cách nhẹ nhàng và xây dựng
      - Tạo cảm giác thân thiện nhưng vẫn chuyên nghiệp
      - Tránh giọng điệu cứng nhắc hoặc máy móc
      
      Nguyên tắc cơ bản:
      - Giữ nguyên ý chính và nội dung quan trọng của tin nhắn
      - Cải thiện cách diễn đạt để thể hiện EQ cao hơn
      - Sửa lỗi chính tả và ngữ pháp
      - Giữ nguyên ngôn ngữ của tin nhắn gốc (tiếng Việt hoặc tiếng Anh)
      - Không thay đổi thông tin thực tế hoặc thêm dữ liệu mới
      - Giữ độ dài tương đương với tin nhắn gốc`;

      // Generate enhanced message without using system role
      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `${systemInstructions}\n\nĐây là tin nhắn cần cải thiện:\n\n"${message}"${contextInstructions}\n\nHãy cải thiện tin nhắn trên để thể hiện EQ cao và cách ăn nói khéo léo trong môi trường làm việc.`,
              },
            ],
          },
        ],
      });

      const enhancedMessage = result.response.text();
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
                text: `${systemPrompt}\n\n${prompt}`,
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
