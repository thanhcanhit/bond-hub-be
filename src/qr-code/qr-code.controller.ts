// src/qr-code/qr-code.controller.ts
import { Controller, Post, Get, Param, Body } from '@nestjs/common';
import { QrCodeService } from './qr-code.service';

@Controller('qrcode')
export class QrCodeController {
  constructor(private qrCodeService: QrCodeService) {}

  @Post('generate')
  async generateQrCode() {
    return this.qrCodeService.generateQrCode();
  }

  @Get('status/:qrToken')
  async getQrStatus(@Param('qrToken') qrToken: string) {
    return this.qrCodeService.getQrStatus(qrToken);
  }

  @Post('scan')
  async scanQrCode(
    @Body('qrToken') qrToken: string,
    @Body('userId') userId: number,
  ) {
    return this.qrCodeService.scanQrCode(qrToken, userId);
  }

  @Post('confirm')
  async confirmQrCode(
    @Body('qrToken') qrToken: string,
    @Body('userId') userId: number,
  ) {
    return this.qrCodeService.confirmQrCode(qrToken, userId);
  }

  @Post('cancel')
  async cancelQrCode(@Body('qrToken') qrToken: string) {
    return this.qrCodeService.cancelQrCode(qrToken);
  }
}
