import { Module } from '@nestjs/common';
import { CallService } from './call.service';
import { CallController } from './call.controller';
import { CallGateway } from './call.gateway';
import { MediasoupService } from './mediasoup.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EventModule } from '../event/event.module';

@Module({
  imports: [PrismaModule, EventModule],
  controllers: [CallController],
  providers: [CallService, CallGateway, MediasoupService],
  exports: [CallService, CallGateway],
})
export class CallModule {}
