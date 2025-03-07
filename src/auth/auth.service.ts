import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { Gender } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
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

  async register(data: {
    email?: string;
    phoneNumber?: string;
    password: string;
    fullName: string;
    dateOfBirth: string;
    gender: Gender;
  }) {
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

    // Hash password
    const hashedPassword = await bcrypt.hash(data.password, 10);

    // Create user with userInfo
    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        phoneNumber: data.phoneNumber,
        passwordHash: hashedPassword,
        userInfo: {
          create: {
            fullName: data.fullName,
            dateOfBirth: new Date(data.dateOfBirth),
            gender: data.gender,
          },
        },
      },
      include: {
        userInfo: true,
      },
    });

    return {
      id: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      fullName: user.userInfo?.fullName,
      dateOfBirth: user.userInfo?.dateOfBirth,
      gender: user.userInfo?.gender,
    };
  }
}
