import { Module } from '@nestjs/common';
import { QrCodeService } from './qr-code.service';
import { QrCodeGateway } from './qr-code.gateway';
import { PrismaModule } from '../prisma/prisma.module';
import { QrCodeController } from './qr-code.controller';
import { ScheduleModule } from '@nestjs/schedule';
import { QrCodeCleanupTask } from './qr-code.cleanup';

@Module({
  imports: [PrismaModule, ScheduleModule.forRoot()],
  controllers: [QrCodeController],
  providers: [QrCodeGateway, QrCodeService, QrCodeCleanupTask],
})
export class QrCodeModule {}
