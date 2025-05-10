import { Module } from '@nestjs/common';
import { CallService } from './call.service';
import { CallController } from './call.controller';
import { CallGateway } from './call.gateway';
import { MediasoupService } from './mediasoup.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EventModule } from '../event/event.module';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    PrismaModule, 
    EventModule, 
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '15m' },
    })
  ],
  controllers: [CallController],
  providers: [CallService, CallGateway, MediasoupService],
  exports: [CallService, CallGateway],
})
export class CallModule {}
