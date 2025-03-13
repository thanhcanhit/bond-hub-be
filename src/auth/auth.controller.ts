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
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { InitiateRegistrationDto } from './dto/initiate-registration.dto';
import { CompleteRegistrationDto } from './dto/complete-registration.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register/initiate')
  async initiateRegistration(@Body() initiateDto: InitiateRegistrationDto) {
    return this.authService.initiateRegistration(initiateDto);
  }

  @Post('register/verify')
  async verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.authService.verifyOtp(
      verifyOtpDto.registrationId,
      verifyOtpDto.otp,
    );
  }

  @Post('register/complete')
  async completeRegistration(@Body() completeDto: CompleteRegistrationDto) {
    return this.authService.completeRegistration(completeDto);
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
