import { Server } from 'socket.io';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type UserData = {
  id: string;
  email: string | null;
  phoneNumber: string | null;
  fullName: string | null;
  profilePictureUrl?: string | null;
};

interface LoginData {
  accessToken: string;
  refreshToken: string;
  user: UserData;
  device: {
    id: string;
    name: string | null;
    type: string;
  };
}

@Injectable()
@WebSocketGateway({ namespace: '/qr-code', cors: true })
export class QrCodeGateway {
  @WebSocketServer()
  server: Server;

  constructor(private prisma: PrismaService) {}

  private readonly logger = new Logger('QrCodeGateway');

  sendQrStatus(
    qrToken: string,
    status: string,
    userData?: UserData,
    loginData?: LoginData,
  ): void {
    this.server.emit(`qr-status-${qrToken}`, {
      status,
      userData,
      loginData,
    });
  }
}
