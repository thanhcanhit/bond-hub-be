import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './user/user.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { GroupModule } from './group/group.module';
import { QrCodeModule } from './qr-code/qr-code.module';
import { MessageModule } from './message/message.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    UserModule,
    PrismaModule,
    AuthModule,
    QrCodeModule,
    GroupModule,
    MessageModule,
    StorageModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
