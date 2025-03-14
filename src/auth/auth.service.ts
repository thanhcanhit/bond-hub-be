import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CacheService } from '../cache/cache.service';
import { AuthGateway } from './auth.gateway';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { InitiateRegistrationDto } from './dto/initiate-registration.dto';
import { CompleteRegistrationDto } from './dto/complete-registration.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private mailService: MailService,
    private cacheService: CacheService,
    private authGateway: AuthGateway,
  ) {}

  async login(identifier: string, password: string, deviceInfo: any) {
    this.logger.log(
      `Login attempt - Identifier: ${identifier}, DeviceType: ${deviceInfo.deviceType}`,
    );

    // Find user by email or phone number
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { phoneNumber: identifier }],
      },
      include: {
        userInfo: true,
        refreshTokens: {
          where: {
            isRevoked: false,
            expiresAt: {
              gt: new Date(),
            },
          },
        },
      },
    });

    if (!user) {
      this.logger.warn(
        `Login failed - User not found for identifier: ${identifier}`,
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      this.logger.warn(`Login failed - Invalid password for user: ${user.id}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check device type restrictions
    const activeTokens = user.refreshTokens.filter(
      (token) => !token.isRevoked && token.expiresAt > new Date(),
    );

    this.logger.debug(`Active sessions for user ${user.id}:`, {
      activeTokens: activeTokens.map((token) => ({
        deviceType: token.deviceType,
        deviceName: token.deviceName,
        expiresAt: token.expiresAt,
      })),
    });

    // Check if there's already an active session for this device type
    const existingDeviceTypeSession = activeTokens.find(
      (token) => token.deviceType === deviceInfo.deviceType,
    );

    // Check if trying to login with mobile/tablet when the other type is active
    const hasMobileSession = activeTokens.some(
      (token) => token.deviceType === 'MOBILE',
    );
    const hasTabletSession = activeTokens.some(
      (token) => token.deviceType === 'TABLET',
    );

    // Prevent mobile login if tablet is active and vice versa
    if (
      (deviceInfo.deviceType === 'MOBILE' && hasTabletSession) ||
      (deviceInfo.deviceType === 'TABLET' && hasMobileSession)
    ) {
      this.logger.warn(
        `Login blocked - Attempted ${deviceInfo.deviceType} login while ${
          hasTabletSession ? 'TABLET' : 'MOBILE'
        } session is active for user: ${user.id}`,
      );
      throw new BadRequestException(
        'Cannot login on mobile and tablet simultaneously',
      );
    }

    // If there's an existing session for this device type, revoke it
    if (existingDeviceTypeSession) {
      this.logger.log(
        `Revoking existing session - UserId: ${user.id}, DeviceType: ${existingDeviceTypeSession.deviceType}, DeviceId: ${existingDeviceTypeSession.id}`,
      );
      await this.prisma.refreshToken.update({
        where: { id: existingDeviceTypeSession.id },
        data: { isRevoked: true },
      });

      // Notify the existing device about logout
      await this.authGateway.notifyDeviceLogout(
        user.id,
        existingDeviceTypeSession.id,
      );
    }

    // Generate tokens
    const tokens = await this.generateTokens(user.id, deviceInfo);

    this.logger.log(
      `Login successful - UserId: ${user.id}, DeviceType: ${deviceInfo.deviceType}, DeviceId: ${tokens.deviceId}`,
    );

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        phoneNumber: user.phoneNumber,
        fullName: user.userInfo?.fullName,
      },
      device: {
        id: tokens.deviceId,
        name: deviceInfo.deviceName,
        type: deviceInfo.deviceType,
      },
    };
  }

  private async generateTokens(userId: string, deviceInfo: any) {
    const accessToken = this.jwtService.sign({
      sub: userId,
      deviceType: deviceInfo.deviceType,
    });

    const refreshToken = uuidv4();
    const refreshTokenExpiry = new Date();
    refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 30);

    const refreshTokenRecord = await this.prisma.refreshToken.create({
      data: {
        id: uuidv4(),
        token: refreshToken,
        userId,
        deviceName: deviceInfo.deviceName,
        deviceType: deviceInfo.deviceType,
        ipAddress: deviceInfo.ipAddress,
        userAgent: deviceInfo.userAgent,
        expiresAt: refreshTokenExpiry,
      },
    });

    this.logger.debug(
      `Tokens generated - UserId: ${userId}, DeviceType: ${deviceInfo.deviceType}, DeviceId: ${refreshTokenRecord.id}`,
    );

    return {
      accessToken,
      refreshToken,
      deviceId: refreshTokenRecord.id,
    };
  }

  async refreshAccessToken(refreshToken: string, deviceId: string) {
    this.logger.log(`Token refresh attempt - DeviceId: ${deviceId}`);

    const tokenRecord = await this.prisma.refreshToken.findFirst({
      where: {
        token: refreshToken,
        id: deviceId,
        isRevoked: false,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: { user: true },
    });

    if (!tokenRecord) {
      this.logger.warn(
        `Token refresh failed - Invalid token or device ID: ${deviceId}`,
      );
      throw new UnauthorizedException('Invalid refresh token');
    }

    const accessToken = this.jwtService.sign({
      sub: tokenRecord.userId,
      deviceType: tokenRecord.deviceType,
    });

    this.logger.log(
      `Token refresh successful - UserId: ${tokenRecord.userId}, DeviceId: ${deviceId}`,
    );

    return {
      accessToken,
      device: {
        id: tokenRecord.id,
        name: tokenRecord.deviceName,
        type: tokenRecord.deviceType,
      },
    };
  }

  async logout(refreshToken: string) {
    this.logger.log(`Logout attempt - Token: ${refreshToken}`);

    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
    });

    if (tokenRecord) {
      await this.prisma.refreshToken.update({
        where: { token: refreshToken },
        data: { isRevoked: true },
      });

      this.logger.log(
        `Logout successful - UserId: ${tokenRecord.userId}, DeviceId: ${tokenRecord.id}`,
      );
    } else {
      this.logger.warn(`Logout failed - Token not found: ${refreshToken}`);
    }
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
