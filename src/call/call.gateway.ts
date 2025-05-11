import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { CallService } from './call.service';
import { MediasoupService } from './mediasoup.service';
import { EventService } from '../event/event.service';
import { JwtService } from '@nestjs/jwt';

@Injectable()
@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
  namespace: '/call',
  pingInterval: 30000,
  pingTimeout: 30000,
  transports: ['websocket', 'polling'],
  allowUpgrades: true,
  connectTimeout: 60000,
  maxHttpBufferSize: 1e8,
})
export class CallGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(CallGateway.name);
  private userSockets: Map<string, Set<Socket>> = new Map();
  private socketToUser: Map<string, string> = new Map();

  constructor(
    private readonly callService: CallService,
    private readonly mediasoupService: MediasoupService,
    private readonly eventService: EventService,
    private readonly jwtService: JwtService,
  ) {
    // Listen for call events
    this.eventService.eventEmitter.on(
      'call.incoming',
      this.handleCallIncoming.bind(this),
    );
    this.eventService.eventEmitter.on(
      'call.rejected',
      this.handleCallRejected.bind(this),
    );
    this.eventService.eventEmitter.on(
      'call.ended',
      this.handleCallEnded.bind(this),
    );
    this.eventService.eventEmitter.on(
      'call.participant.joined',
      this.handleCallParticipantJoined.bind(this),
    );
    this.eventService.eventEmitter.on(
      'call.participant.left',
      this.handleCallParticipantLeft.bind(this),
    );
  }

  private async getUserFromSocket(client: Socket): Promise<string | null> {
    try {
      // Try to get the token from auth or query params
      const token =
        client.handshake.auth?.token ||
        (client.handshake.query?.token as string);

      if (!token) {
        return null;
      }

      const decoded = this.jwtService.verify(token);
      return decoded.sub;
    } catch (error) {
      this.logger.error(`Error verifying token: ${error.message}`);
      return null;
    }
  }

  private addUserSocket(userId: string, socket: Socket) {
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId).add(socket);
    this.socketToUser.set(socket.id, userId);
  }

  private removeUserSocket(socket: Socket) {
    const userId = this.socketToUser.get(socket.id);
    if (userId) {
      const userSockets = this.userSockets.get(userId);
      if (userSockets) {
        userSockets.delete(socket);
        if (userSockets.size === 0) {
          this.userSockets.delete(userId);
        }
      }
      this.socketToUser.delete(socket.id);
    }
  }

  async handleConnection(client: Socket) {
    try {
      const userId = await this.getUserFromSocket(client);
      if (!userId) {
        this.logger.warn('Client connected without valid authentication');
        client.disconnect();
        return;
      }

      this.addUserSocket(userId, client);
      client.join(`user:${userId}`);

      this.logger.log(`User ${userId} connected to call gateway`);
    } catch (error) {
      this.logger.error(`Error in handleConnection: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    try {
      this.removeUserSocket(client);
      this.logger.log(`Client disconnected: ${client.id}`);
    } catch (error) {
      this.logger.error(`Error in handleDisconnect: ${error.message}`);
    }
  }

  // Event handlers
  private handleCallIncoming(data: any) {
    const { callId, initiatorId, receiverId, groupId, type, roomId } = data;

    // For direct calls, notify the receiver
    if (receiverId) {
      this.server.to(`user:${receiverId}`).emit('call:incoming', {
        callId,
        initiatorId,
        type,
        roomId,
        isGroupCall: false,
      });
    }

    // For group calls, notify all members
    if (groupId) {
      // The group members will be notified through individual user rooms
      // This is handled in the CallService when creating the call
    }

    // Also notify the initiator
    this.server.to(`user:${initiatorId}`).emit('call:initiated', {
      callId,
      receiverId,
      groupId,
      type,
      roomId,
      isGroupCall: !!groupId,
    });
  }

  private handleCallRejected(data: any) {
    const { callId, initiatorId, receiverId, roomId } = data;

    // Notify the initiator
    this.server.to(`user:${initiatorId}`).emit('call:rejected', {
      callId,
      receiverId,
      roomId,
    });
  }

  private handleCallEnded(data: any) {
    const { callId, roomId, endedBy } = data;

    // Notify all participants in the room
    this.server.to(`room:${roomId}`).emit('call:ended', {
      callId,
      roomId,
      endedBy,
    });
  }

  private handleCallParticipantJoined(data: any) {
    const { callId, userId, roomId } = data;

    // Notify all participants in the room
    this.server.to(`room:${roomId}`).emit('call:participant:joined', {
      callId,
      userId,
      roomId,
    });
  }

  private handleCallParticipantLeft(data: any) {
    const { callId, userId, roomId } = data;

    // Notify all participants in the room
    this.server.to(`room:${roomId}`).emit('call:participant:left', {
      callId,
      userId,
      roomId,
    });
  }

  // WebRTC signaling
  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    try {
      const userId = this.socketToUser.get(client.id);
      if (!userId) {
        return { error: 'User not authenticated' };
      }

      const { roomId } = data;

      // Join the room
      client.join(`room:${roomId}`);

      // Get router RTP capabilities
      const rtpCapabilities =
        await this.mediasoupService.getRtpCapabilities(roomId);

      return { rtpCapabilities };
    } catch (error) {
      this.logger.error(`Error in joinRoom: ${error.message}`);
      return { error: error.message };
    }
  }

  @SubscribeMessage('createWebRtcTransport')
  async handleCreateWebRtcTransport(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; direction: 'send' | 'recv' },
  ) {
    try {
      const userId = this.socketToUser.get(client.id);
      if (!userId) {
        return { error: 'User not authenticated' };
      }

      const { roomId, direction } = data;

      // Create WebRTC transport
      const { params } = await this.mediasoupService.createWebRtcTransport(
        roomId,
        userId,
        direction,
      );

      return { params };
    } catch (error) {
      this.logger.error(`Error in createWebRtcTransport: ${error.message}`);
      return { error: error.message };
    }
  }

  @SubscribeMessage('connectWebRtcTransport')
  async handleConnectWebRtcTransport(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      roomId: string;
      direction: 'send' | 'recv';
      dtlsParameters: any;
    },
  ) {
    try {
      const userId = this.socketToUser.get(client.id);
      if (!userId) {
        return { error: 'User not authenticated' };
      }

      const { roomId, direction, dtlsParameters } = data;

      // Connect WebRTC transport
      await this.mediasoupService.connectWebRtcTransport(
        roomId,
        userId,
        direction,
        dtlsParameters,
      );

      return { connected: true };
    } catch (error) {
      this.logger.error(`Error in connectWebRtcTransport: ${error.message}`);
      return { error: error.message };
    }
  }

  @SubscribeMessage('produce')
  async handleProduce(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      roomId: string;
      kind: 'audio' | 'video';
      rtpParameters: any;
      appData: any;
    },
  ) {
    try {
      const userId = this.socketToUser.get(client.id);
      if (!userId) {
        return { error: 'User not authenticated' };
      }

      const { roomId, kind, rtpParameters, appData } = data;

      // Create producer
      const producer = await this.mediasoupService.createProducer(
        roomId,
        userId,
        {
          kind,
          rtpParameters,
          appData,
        },
      );

      // Add producer to participant
      this.callService.addProducerToParticipant(roomId, userId, producer.id);

      // Notify other participants about the new producer
      client.to(`room:${roomId}`).emit('newProducer', {
        producerId: producer.id,
        producerUserId: userId,
        kind,
      });

      return { id: producer.id };
    } catch (error) {
      this.logger.error(`Error in produce: ${error.message}`);
      return { error: error.message };
    }
  }

  @SubscribeMessage('consume')
  async handleConsume(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      roomId: string;
      producerId: string;
      rtpCapabilities: any;
    },
  ) {
    try {
      const userId = this.socketToUser.get(client.id);
      if (!userId) {
        return { error: 'User not authenticated' };
      }

      const { roomId, producerId, rtpCapabilities } = data;

      // Create consumer
      const consumer = await this.mediasoupService.createConsumer(
        roomId,
        userId,
        producerId,
        rtpCapabilities,
      );

      // Add consumer to participant
      this.callService.addConsumerToParticipant(roomId, userId, consumer.id);

      return {
        id: consumer.id,
        producerId: consumer.producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      };
    } catch (error) {
      this.logger.error(`Error in consume: ${error.message}`);
      return { error: error.message };
    }
  }

  @SubscribeMessage('resumeConsumer')
  async handleResumeConsumer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { consumerId: string },
  ) {
    try {
      const userId = this.socketToUser.get(client.id);
      if (!userId) {
        return { error: 'User not authenticated' };
      }

      const { consumerId } = data;

      // Resume consumer
      await this.mediasoupService.resumeConsumer(consumerId);

      return { resumed: true };
    } catch (error) {
      this.logger.error(`Error in resumeConsumer: ${error.message}`);
      return { error: error.message };
    }
  }

  @SubscribeMessage('getProducers')
  async handleGetProducers(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    try {
      const userId = this.socketToUser.get(client.id);
      if (!userId) {
        return { error: 'User not authenticated' };
      }

      const { roomId } = data;

      // Get other participants in the room
      const otherParticipants = this.callService.getOtherParticipants(
        roomId,
        userId,
      );

      // Collect all producer IDs from other participants
      const producers = [];
      for (const participant of otherParticipants) {
        for (const producerId of participant.producerIds) {
          producers.push({
            producerId,
            producerUserId: participant.userId,
          });
        }
      }

      return { producers };
    } catch (error) {
      this.logger.error(`Error in getProducers: ${error.message}`);
      return { error: error.message };
    }
  }

  @SubscribeMessage('setRtpCapabilities')
  async handleSetRtpCapabilities(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; rtpCapabilities: any },
  ) {
    try {
      const userId = this.socketToUser.get(client.id);
      if (!userId) {
        return { error: 'User not authenticated' };
      }

      const { roomId, rtpCapabilities } = data;

      // Set participant RTP capabilities
      this.callService.setParticipantRtpCapabilities(
        roomId,
        userId,
        rtpCapabilities,
      );

      return { success: true };
    } catch (error) {
      this.logger.error(`Error in setRtpCapabilities: ${error.message}`);
      return { error: error.message };
    }
  }

  @SubscribeMessage('finishJoining')
  async handleFinishJoining(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    try {
      const userId = this.socketToUser.get(client.id);
      if (!userId) {
        return { error: 'User not authenticated' };
      }

      const { roomId } = data;

      // Mark participant as joined
      this.callService.markParticipantAsJoined(roomId, userId);

      // Notify other participants
      client.to(`room:${roomId}`).emit('participantJoined', {
        userId,
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`Error in finishJoining: ${error.message}`);
      return { error: error.message };
    }
  }
}
