// src/tasks/qr-code.cleanup.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class QrCodeCleanupTask {
  private readonly logger = new Logger(QrCodeCleanupTask.name);

  constructor(private prisma: PrismaService) {}

  @Cron('*/5 * * * *') // Chạy mỗi 5 phút
  async handleCron() {
    this.logger.debug('Running QR Code cleanup task...');
    const now = new Date();

    // Xóa các mã QR đã hết hạn
    const result = await this.prisma.qrCode.deleteMany({
      where: { expiresAt: { lt: now }, status: { not: 'CONFIRMED' } },
    });

    this.logger.debug(`Deleted ${result.count} expired QR Codes.`);
  }
}
