import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

@Injectable()
export class SmsService {
  private readonly snsClient: SNSClient;
  private readonly logger = new Logger(SmsService.name);
  private readonly isTestMode: boolean;

  constructor(private configService: ConfigService) {
    // Kiểm tra xem biến SMS_TEST_MODE có tồn tại trong env không
    const hasTestMode =
      this.configService.get<string>('SMS_TEST_MODE') !== undefined;
    this.isTestMode = hasTestMode;

    this.logger.log(
      `SMS Service Test Mode: ${this.isTestMode ? 'Enabled (OTP will be logged)' : 'Disabled (OTP will be sent via SNS)'}`,
    );

    if (!this.isTestMode) {
      const region = this.configService.get<string>('AWS_REGION');
      const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
      const secretAccessKey = this.configService.get<string>(
        'AWS_SECRET_ACCESS_KEY',
      );

      if (!region || !accessKeyId || !secretAccessKey) {
        this.logger.error('Missing AWS configuration', {
          region: !!region,
          accessKeyId: !!accessKeyId,
          secretAccessKey: !!secretAccessKey,
        });
        return;
      }

      try {
        this.snsClient = new SNSClient({
          region,
          credentials: {
            accessKeyId,
            secretAccessKey,
          },
        });
        this.logger.log('AWS SNS client initialized successfully');
      } catch (error) {
        this.logger.error('Failed to initialize AWS SNS client:', error);
      }
    } else {
      this.logger.warn(
        'SMS Service running in TEST MODE - OTP will be logged instead of sent',
      );
    }
  }

  private formatVietnamesePhoneNumber(phoneNumber: string): string {
    // Remove any existing '+' or leading zeros
    let cleaned = phoneNumber.replace(/^\+|^0+/, '');

    // If the number doesn't start with '84' (country code), add it
    if (!cleaned.startsWith('84')) {
      cleaned = '84' + cleaned;
    }

    // Add the '+' prefix
    const formatted = '+' + cleaned;
    this.logger.debug(`Formatted phone number: ${phoneNumber} -> ${formatted}`);
    this.logger.log(formatted);
    return formatted;
  }

  async sendOtp(phoneNumber: string, otp: string): Promise<boolean> {
    try {
      if (this.isTestMode) {
        this.logger.warn('TEST MODE: Not sending actual SMS');
        this.logger.debug(`Phone number: ${phoneNumber}`);
        this.logger.debug(`OTP code: ${otp}`);
        return true;
      }

      const formattedPhoneNumber =
        this.formatVietnamesePhoneNumber(phoneNumber);
      const message = `Your OTP is: ${otp}. This code will expire in 5 minutes.`;

      if (!this.snsClient) {
        this.logger.error('SNS client not initialized');
        return false;
      }

      const command = new PublishCommand({
        Message: message,
        PhoneNumber: formattedPhoneNumber,
        MessageAttributes: {
          'AWS.SNS.SMS.SMSType': {
            DataType: 'String',
            StringValue: 'Transactional',
          },
          'AWS.SNS.SMS.SenderID': {
            DataType: 'String',
            StringValue:
              this.configService.get<string>('AWS_SNS_SENDER_ID') || 'BondHub',
          },
        },
      });

      const response = await this.snsClient.send(command);
      this.logger.debug('SMS sent successfully', {
        messageId: response.MessageId,
        phoneNumber: formattedPhoneNumber,
      });

      return true;
    } catch (error) {
      this.logger.error(`Failed to send OTP to ${phoneNumber}:`, error);
      return false;
    }
  }
}
