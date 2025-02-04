import { Server } from 'socket.io';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';

@WebSocketGateway({ cors: true })
export class QrCodeGateway {
  @WebSocketServer()
  server: Server;

  // Gửi cập nhật trạng thái mã QR đến client
  sendQrStatus(qrToken: string, status: string) {
    this.server.emit(`qr-status-${qrToken}`, { status });
  }
}
