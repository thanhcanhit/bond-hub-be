import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class AuthGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private connectedClients: Map<string, Socket> = new Map();

  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token;
      if (!token) {
        client.disconnect();
        return;
      }

      const decoded = this.jwtService.verify(token);
      const userId = decoded.sub;

      // Store client connection
      this.connectedClients.set(userId, client);
    } catch (error) {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    // Remove disconnected client
    for (const [userId, socket] of this.connectedClients.entries()) {
      if (socket === client) {
        this.connectedClients.delete(userId);
        break;
      }
    }
  }

  async notifyDeviceLogout(userId: string, currentDeviceId: string) {
    const client = this.connectedClients.get(userId);
    if (client) {
      client.emit('forceLogout', { deviceId: currentDeviceId });
    }
  }
}
