import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private resend: Resend;
  private readonly logger = new Logger(MailService.name);

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      this.logger.error('RESEND_API_KEY is not set in environment variables');
    }
    this.resend = new Resend(apiKey);
  }

  async sendOtpEmail(email: string, otp: string) {
    try {
      const data = await this.resend.emails.send({
        from: 'noreply@bondhub.cloud',
        to: [email],
        subject: 'Your OTP Code for Bond Hub',
        html: `
          <h1>Your OTP Code</h1>
          <p>Your OTP code is: <strong>${otp}</strong></p>
          <p>This code will expire in 1 minute.</p>
          <p>If you didn't request this code, please ignore this email.</p>
        `,
      });
      
      this.logger.log(`Email sent successfully to ${email}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send email to ${email}:`, error);
      return false;
    }
  }
}