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
    origin: '*',
    credentials: true,
  },
  namespace: '/call',
  pingInterval: 5000,
  pingTimeout: 10000,
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
  private socketToRoom: Map<string, string> = new Map();

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
      this.logger.log(`New connection: ${client.id} via ${client.conn.transport.name}`);
      
      const userId = await this.getUserFromSocket(client);
      if (!userId) {
        this.logger.warn(`Client ${client.id} connected without valid authentication`);
        return;
      }

      this.addUserSocket(userId, client);
      client.join(`user:${userId}`);

      client.emit('connection:established', { 
        userId, 
        socketId: client.id, 
        status: 'connected',
        timestamp: new Date().toISOString()
      });

      this.logger.log(`User ${userId} connected to call gateway with socket ID: ${client.id}`);
      this.logger.log(`Current transport: ${client.conn.transport.name}`);
      this.logger.log(`Connection state: ${client.connected ? 'Connected' : 'Disconnected'}`);
    } catch (error) {
      this.logger.error(`Error in handleConnection: ${error.message}`);
    }
  }

  handleDisconnect(client: Socket) {
    try {
      const userId = this.socketToUser.get(client.id);
      const roomId = this.socketToRoom.get(client.id);
      
      this.logger.log(`Client disconnected: ${client.id}, user: ${userId || 'unknown'}`);
      
      if (userId && roomId) {
        client.to(`room:${roomId}`).emit('user:disconnected', { 
          userId, 
          reason: 'socket_closed',
          timestamp: new Date().toISOString()
        });
        
        this.mediasoupService.closeTransport(roomId, userId, 'send');
        this.mediasoupService.closeTransport(roomId, userId, 'recv');
        
        this.socketToRoom.delete(client.id);
        
        this.logger.log(`Cleaned up resources for user ${userId} in room ${roomId}`);
      }
      
      this.removeUserSocket(client);
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
        this.logger.error(`User not authenticated for socket ${client.id}`);
        
        setTimeout(() => {
          client.emit('auth:required', { message: 'Authentication required' });
        }, 1000);
        
        return { error: 'User not authenticated' };
      }

      const { roomId } = data;
      
      this.logger.log(`User ${userId} attempting to join room ${roomId}`);
      
      await this.mediasoupService.createRouter(roomId);
      
      client.join(`room:${roomId}`);
      this.socketToRoom.set(client.id, roomId);
      
      const rtpCapabilities = await this.mediasoupService.getRtpCapabilities(roomId);
      
      client.to(`room:${roomId}`).emit('user:joined', { userId, timestamp: new Date().toISOString() });
      
      this.logger.log(`User ${userId} joined room ${roomId} successfully with capabilities`);
      
      return { rtpCapabilities, success: true };
    } catch (error) {
      this.logger.error(`Error in joinRoom for user ${this.socketToUser.get(client.id)}: ${error.message}`);
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
        this.logger.error(`User not authenticated for socket ${client.id}`);
        return { error: 'User not authenticated' };
      }

      const { roomId, direction } = data;

      // Kiểm tra xem user có trong room không
      if (!client.rooms.has(`room:${roomId}`)) {
        this.logger.error(`User ${userId} not in room ${roomId}`);
        return { error: 'Not in room' };
      }
      
      this.logger.log(`Creating ${direction} transport for user ${userId} in room ${roomId}`);
      
      const transportData = await this.mediasoupService.createWebRtcTransport(
        roomId,
        userId,
        direction,
      );
      
      this.logger.log(`Transport created successfully: ${transportData.transport.id}`);
      
      return { 
        id: transportData.params.id,
        iceParameters: transportData.params.iceParameters,
        iceCandidates: transportData.params.iceCandidates,
        dtlsParameters: transportData.params.dtlsParameters,
      };
    } catch (error) {
      this.logger.error(`Error creating WebRTC transport for user ${this.socketToUser.get(client.id)}: ${error.message}`);
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
