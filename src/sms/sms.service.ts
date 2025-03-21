import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as twilio from 'twilio';

@Injectable()
export class SmsService {
  private readonly twilioClient: twilio.Twilio;
  private readonly logger = new Logger('SmsService');
  private readonly isTrial: boolean;
  private readonly isTestMode: boolean;

  constructor(private configService: ConfigService) {
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    const fromNumber = this.configService.get<string>('TWILIO_PHONE_NUMBER');
    this.isTrial = this.configService.get<boolean>('TWILIO_IS_TRIAL') ?? true;
    this.isTestMode = this.configService.get<boolean>('SMS_TEST_MODE') ?? false;

    // Skip Twilio initialization in test mode
    if (this.isTestMode) {
      this.logger.warn(
        'SMS Service running in TEST MODE - No real SMS will be sent',
      );
      return;
    }

    if (!accountSid || !authToken || !fromNumber) {
      this.logger.error('Missing Twilio configuration', {
        accountSid: !!accountSid,
        authToken: !!authToken,
        fromNumber: !!fromNumber,
      });
      return;
    }

    // Validate Account SID format
    if (!accountSid.startsWith('AC')) {
      this.logger.error(
        'Invalid Twilio Account SID format - Must start with AC',
      );
      return;
    }

    // Validate phone number format
    if (!fromNumber.startsWith('+')) {
      this.logger.error(
        'Invalid Twilio phone number format - Must start with + and include country code',
      );
      return;
    }

    try {
      this.twilioClient = twilio(accountSid, authToken);
      this.logger.log('Twilio client initialized successfully', {
        fromNumber,
        isTrial: this.isTrial,
        isTestMode: this.isTestMode,
      });
    } catch (error) {
      this.logger.error('Failed to initialize Twilio client:', error);
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
    return formatted;
  }

  async sendOtp(phoneNumber: string, otp: string): Promise<boolean> {
    try {
      // In test mode, just log the OTP and return success
      if (this.isTestMode) {
        this.logger.warn(`[TEST MODE] Would send OTP ${otp} to ${phoneNumber}`);
        return true;
      }

      const fromNumber = this.configService.get<string>('TWILIO_PHONE_NUMBER');

      if (!this.twilioClient || !fromNumber) {
        this.logger.error('Twilio client not initialized', {
          hasClient: !!this.twilioClient,
          fromNumber,
        });
        return false;
      }

      // Format the phone number to E.164 format
      const formattedPhoneNumber =
        this.formatVietnamesePhoneNumber(phoneNumber);

      this.logger.debug('Attempting to send SMS', {
        from: fromNumber,
        to: formattedPhoneNumber,
        isTrial: this.isTrial,
        isTestMode: this.isTestMode,
      });

      const message = await this.twilioClient.messages.create({
        body: `Your OTP is: ${otp}. This code will expire in 5 minutes.`,
        from: fromNumber,
        to: formattedPhoneNumber,
      });

      this.logger.log(`SMS sent successfully to ${formattedPhoneNumber}`, {
        messageId: message.sid,
        status: message.status,
      });
      return true;
    } catch (error) {
      // Log detailed error information
      this.logger.error('Failed to send SMS', {
        phoneNumber,
        errorCode: error.code,
        errorMessage: error.message,
        moreInfo: error.moreInfo,
        status: error.status,
        details: error.details,
      });

      // Handle specific Twilio errors
      switch (error.code) {
        case 21608:
          throw new BadRequestException(
            'Phone number not verified. Please verify in Twilio console or upgrade to paid account.',
          );
        case 21211:
          throw new BadRequestException('Invalid phone number format.');
        case 21614:
          throw new BadRequestException(
            'Invalid sending phone number. Please check TWILIO_PHONE_NUMBER in .env',
          );
        default:
          throw new BadRequestException(`Failed to send SMS: ${error.message}`);
      }
    }
  }
}
