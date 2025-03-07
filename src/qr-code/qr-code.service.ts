// src/qr-code/qr-code.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QrCodeGateway } from './qr-code.gateway';
import { QrCodeStatus } from '@prisma/client';

@Injectable()
export class QrCodeService {
  constructor(
    private prisma: PrismaService,
    private qrCodeGateway: QrCodeGateway,
  ) {}

  // Tạo mã QR
  async generateQrCode() {
    const qrToken = Math.random().toString(36).substring(2, 15); // Tạo token ngẫu nhiên
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // Hết hạn sau 5 phút

    const qrCode = await this.prisma.qrCode.create({
      data: {
        qrToken,
        status: QrCodeStatus.PENDING,
        expiresAt,
      },
    });

    return { qrToken: qrCode.qrToken, expires_in: 300 };
  }

  // Kiểm tra trạng thái mã QR
  async getQrStatus(qrToken: string) {
    const qrCode = await this.prisma.qrCode.findUnique({ where: { qrToken } });

    if (!qrCode || new Date() > qrCode.expiresAt) {
      throw new Error('QR Code is invalid or expired');
    }

    return { status: qrCode.status };
  }

  // Quét mã QR
  async scanQrCode(qrToken: string, userId: string) {
    const qrCode = await this.prisma.qrCode.findUnique({ where: { qrToken } });

    if (
      !qrCode ||
      qrCode.status !== QrCodeStatus.PENDING ||
      new Date() > qrCode.expiresAt
    ) {
      throw new Error('QR Code is invalid or expired');
    }

    await this.prisma.qrCode.update({
      where: { qrToken },
      data: { status: QrCodeStatus.SCANNED, userId },
    });

    // Gửi cập nhật trạng thái qua WebSocket
    this.qrCodeGateway.sendQrStatus(qrToken, QrCodeStatus.SCANNED);

    return { status: QrCodeStatus.SCANNED };
  }

  // Xác nhận đăng nhập
  async confirmQrCode(qrToken: string, userId: string) {
    const qrCode = await this.prisma.qrCode.findUnique({ where: { qrToken } });

    if (
      !qrCode ||
      qrCode.status !== QrCodeStatus.SCANNED ||
      new Date() > qrCode.expiresAt
    ) {
      throw new Error('QR Code is invalid or expired');
    }

    await this.prisma.qrCode.update({
      where: { qrToken },
      data: { status: QrCodeStatus.CONFIRMED, userId },
    });

    // Gửi cập nhật trạng thái qua WebSocket
    this.qrCodeGateway.sendQrStatus(qrToken, QrCodeStatus.CONFIRMED);

    // Xóa mã QR sau khi xác nhận
    await this.deleteQrCode(qrToken);

    return { status: QrCodeStatus.CONFIRMED };
  }

  // Hủy mã QR
  async cancelQrCode(qrToken: string) {
    const qrCode = await this.prisma.qrCode.findUnique({ where: { qrToken } });

    if (!qrCode || new Date() > qrCode.expiresAt) {
      throw new Error('QR Code is invalid or expired');
    }

    // Cập nhật trạng thái thành "cancelled"
    await this.prisma.qrCode.update({
      where: { qrToken },
      data: { status: QrCodeStatus.CANCELLED },
    });

    // Gửi cập nhật trạng thái qua WebSocket
    this.qrCodeGateway.sendQrStatus(qrToken, QrCodeStatus.CANCELLED);

    // Xóa mã QR sau khi hủy
    await this.deleteQrCode(qrToken);

    return { status: QrCodeStatus.CANCELLED };
  }

  // Xóa mã QR khỏi cơ sở dữ liệu
  async deleteQrCode(qrToken: string) {
    await this.prisma.qrCode.delete({ where: { qrToken } });
  }
}
