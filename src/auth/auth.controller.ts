import {
  Controller,
  Post,
  Body,
  Headers,
  Req,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { Request } from 'express';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { InitiateRegistrationDto } from './dto/initiate-registration.dto';
import { CompleteRegistrationDto } from './dto/complete-registration.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyForgotPasswordOtpDto } from './dto/verify-forgot-password-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

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
    if (!loginDto.email && !loginDto.phoneNumber) {
      throw new BadRequestException('Either email or phone number is required');
    }

    const deviceInfo = {
      deviceName: request.headers['x-device-name'],
      deviceType: loginDto.deviceType,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    };

    const identifier = loginDto.email || loginDto.phoneNumber;
    return this.authService.login(identifier, loginDto.password, deviceInfo);
  }

  @Post('refresh')
  async refreshToken(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshAccessToken(
      refreshTokenDto.refreshToken,
      refreshTokenDto.deviceId,
    );
  }

  @Post('logout')
  async logout(@Headers('refresh-token') refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }
    return this.authService.logout(refreshToken);
  }

  @Post('forgot-password')
  async initiateForgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.initiateForgotPassword(forgotPasswordDto);
  }

  @Post('forgot-password/verify')
  async verifyForgotPasswordOtp(@Body() verifyDto: VerifyForgotPasswordOtpDto) {
    return this.authService.verifyForgotPasswordOtp(
      verifyDto.resetId,
      verifyDto.otp,
    );
  }

  @Post('forgot-password/reset')
  async resetPassword(@Body() resetDto: ResetPasswordDto) {
    return this.authService.resetPassword(
      resetDto.resetId,
      resetDto.newPassword,
    );
  }
}
