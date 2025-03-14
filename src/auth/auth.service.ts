import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CacheService } from '../cache/cache.service';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { InitiateRegistrationDto } from './dto/initiate-registration.dto';
import { CompleteRegistrationDto } from './dto/complete-registration.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private mailService: MailService,
    private cacheService: CacheService,
  ) {}

  async login(phoneNumber: string, password: string, deviceInfo: any) {
    // Find user
    const user = await this.prisma.user.findUnique({
      where: { phoneNumber },
      include: {
        userInfo: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate tokens
    const tokens = await this.generateTokens(user.id, deviceInfo);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        phoneNumber: user.phoneNumber,
        fullName: user.userInfo?.fullName,
      },
    };
  }

  private async generateTokens(userId: string, deviceInfo: any) {
    const accessToken = this.jwtService.sign({ sub: userId });
    const refreshToken = uuidv4();
    const refreshTokenExpiry = new Date();
    refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 30);

    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId,
        deviceName: deviceInfo.deviceName,
        deviceType: deviceInfo.deviceType,
        ipAddress: deviceInfo.ipAddress,
        userAgent: deviceInfo.userAgent,
        expiresAt: refreshTokenExpiry,
      },
    });

    return { accessToken, refreshToken };
  }

  async refreshAccessToken(refreshToken: string) {
    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (
      !tokenRecord ||
      tokenRecord.isRevoked ||
      tokenRecord.expiresAt < new Date()
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const accessToken = this.jwtService.sign({ sub: tokenRecord.userId });

    return { accessToken };
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.update({
      where: { token: refreshToken },
      data: { isRevoked: true },
    });
  }

  private generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async initiateRegistration(data: InitiateRegistrationDto) {
    // Check if at least email or phone number is provided
    if (!data.email && !data.phoneNumber) {
      throw new BadRequestException('Either email or phone number is required');
    }

    // Check if user exists with either email or phone number
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: data.email || undefined },
          { phoneNumber: data.phoneNumber || undefined },
        ],
      },
    });

    if (existingUser) {
      throw new BadRequestException(
        existingUser.email === data.email
          ? 'Email already registered'
          : 'Phone number already registered',
      );
    }

    // Generate OTP and registration ID
    const otp = this.generateOtp();
    const registrationId = uuidv4();

    // Store registration data and OTP in Redis
    await this.cacheService.set(
      `registration:${registrationId}`,
      JSON.stringify(data),
      300, // 5 minutes expiry
    );
    await this.cacheService.set(
      `otp:${registrationId}`,
      otp,
      300, // 5 minutes expiry
    );

    // Send OTP via email if email is provided
    if (data.email) {
      const emailSent = await this.mailService.sendOtpEmail(data.email, otp);
      if (!emailSent) {
        throw new BadRequestException('Failed to send OTP email');
      }
    }
    // TODO: Implement SMS OTP sending when available

    return {
      message: 'OTP sent successfully',
      registrationId,
    };
  }

  async verifyOtp(registrationId: string, otp: string) {
    // Get stored OTP and registration data
    const storedOtp = await this.cacheService.get(`otp:${registrationId}`);
    const registrationData = await this.cacheService.get(
      `registration:${registrationId}`,
    );

    if (!storedOtp || !registrationData) {
      throw new BadRequestException('Registration session expired');
    }

    if (storedOtp !== otp) {
      throw new BadRequestException('Invalid OTP');
    }

    return {
      message: 'OTP verified successfully',
      registrationId,
    };
  }

  async completeRegistration(data: CompleteRegistrationDto) {
    // Get registration data
    const registrationData = await this.cacheService.get(
      `registration:${data.registrationId}`,
    );

    if (!registrationData) {
      throw new BadRequestException('Registration session expired');
    }

    const { email, phoneNumber } = JSON.parse(registrationData);

    // Hash password
    const hashedPassword = await bcrypt.hash(data.password, 10);

    // Create user with userInfo and userSettings
    const user = await this.prisma.user.create({
      data: {
        email,
        phoneNumber,
        passwordHash: hashedPassword,
        userInfo: {
          create: {
            fullName: data.fullName,
            dateOfBirth: new Date(data.dateOfBirth),
            gender: data.gender,
          },
        },
        settings: {
          create: {
            notificationEnabled: true,
            darkMode: false,
          },
        },
      },
      include: {
        userInfo: true,
        settings: true,
      },
    });

    // Clean up Redis data
    await this.cacheService.del(`otp:${data.registrationId}`);
    await this.cacheService.del(`registration:${data.registrationId}`);

    return {
      message: 'Registration completed successfully',
      user: {
        id: user.id,
        email: user.email,
        phoneNumber: user.phoneNumber,
        fullName: user.userInfo?.fullName,
        dateOfBirth: user.userInfo?.dateOfBirth,
        gender: user.userInfo?.gender,
      },
    };
  }

  async initiateForgotPassword(data: ForgotPasswordDto) {
    // Check if at least email or phone number is provided
    if (!data.email && !data.phoneNumber) {
      throw new BadRequestException('Either email or phone number is required');
    }

    // Find user by email or phone number
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: data.email || undefined },
          { phoneNumber: data.phoneNumber || undefined },
        ],
      },
      include: {
        userInfo: true,
      },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Generate OTP and reset ID
    const otp = this.generateOtp();
    const resetId = uuidv4();

    // Store reset data and OTP in Redis
    await this.cacheService.set(
      `reset:${resetId}`,
      JSON.stringify({
        userId: user.id,
        phoneNumber: user.phoneNumber,
        email: user.email,
      }),
      300, // 5 minutes expiry
    );
    await this.cacheService.set(
      `reset_otp:${resetId}`,
      otp,
      300, // 5 minutes expiry
    );

    // Send OTP via email if email exists
    if (user.email) {
      const emailSent = await this.mailService.sendOtpEmail(user.email, otp);
      if (!emailSent) {
        throw new BadRequestException('Failed to send OTP email');
      }
    }
    // TODO: Implement SMS OTP sending when available

    return {
      message: 'OTP sent successfully',
      resetId,
    };
  }

  async verifyForgotPasswordOtp(resetId: string, otp: string) {
    // Get stored OTP and reset data
    const storedOtp = await this.cacheService.get(`reset_otp:${resetId}`);
    const resetData = await this.cacheService.get(`reset:${resetId}`);

    if (!storedOtp || !resetData) {
      throw new BadRequestException('Reset session expired');
    }

    if (storedOtp !== otp) {
      throw new BadRequestException('Invalid OTP');
    }

    return {
      message: 'OTP verified successfully',
      resetId,
    };
  }

  async resetPassword(resetId: string, newPassword: string) {
    // Get reset data
    const resetData = await this.cacheService.get(`reset:${resetId}`);

    if (!resetData) {
      throw new BadRequestException('Reset session expired');
    }

    const { userId } = JSON.parse(resetData);

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user password
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hashedPassword },
    });

    // Clean up Redis data
    await this.cacheService.del(`reset_otp:${resetId}`);
    await this.cacheService.del(`reset:${resetId}`);

    return {
      message: 'Password reset successfully',
    };
  }
}
