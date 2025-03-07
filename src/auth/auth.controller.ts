import {
  Controller,
  Post,
  Body,
  Headers,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { Request } from 'express';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register/initiate')
  async initiateRegistration(@Body() registerDto: RegisterDto) {
    return this.authService.initiateRegistration({
      email: registerDto.email,
      phoneNumber: registerDto.phoneNumber,
      password: registerDto.password,
      fullName: registerDto.fullName,
      dateOfBirth: registerDto.dateOfBirth,
      gender: registerDto.gender,
    });
  }

  @Post('register/verify')
  async verifyAndRegister(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.authService.verifyOtpAndRegister(
      verifyOtpDto.registrationId,
      verifyOtpDto.otp,
    );
  }

  @Post('login')
  async login(@Body() loginDto: LoginDto, @Req() request: Request) {
    const deviceInfo = {
      deviceName: request.headers['x-device-name'],
      deviceType: request.headers['x-device-type'],
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    };

    return this.authService.login(
      loginDto.phoneNumber,
      loginDto.password,
      deviceInfo,
    );
  }

  @Post('refresh')
  async refreshToken(@Headers('refresh-token') refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }
    return this.authService.refreshAccessToken(refreshToken);
  }

  @Post('logout')
  async logout(@Headers('refresh-token') refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }
    return this.authService.logout(refreshToken);
  }
}
