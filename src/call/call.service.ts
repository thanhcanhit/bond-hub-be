import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediasoupService } from './mediasoup.service';
import { EventService } from '../event/event.service';
import {
  Call,
  CallParticipant,
  CallRoom,
  CallRoomParticipant,
} from './interfaces/call.interface';
import { CreateCallDto } from './dto/create-call.dto';
import { JoinCallDto } from './dto/join-call.dto';
import { EndCallDto } from './dto/end-call.dto';
import { CallStatus, CallType } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CallService {
  private readonly logger = new Logger(CallService.name);
  private activeRooms: Map<string, CallRoom> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mediasoupService: MediasoupService,
    private readonly eventService: EventService,
  ) {}

  /**
   * Create a new call
   * @param createCallDto The call data
   */
  async createCall(createCallDto: CreateCallDto): Promise<Call> {
    const { initiatorId, receiverId, groupId, type } = createCallDto;

    // Validate that either receiverId or groupId is provided, but not both
    if ((receiverId && groupId) || (!receiverId && !groupId)) {
      throw new BadRequestException(
        'Either receiverId or groupId must be provided, but not both',
      );
    }

    // For group calls, verify that the initiator is a member of the group
    if (groupId) {
      const isMember = await this.prisma.groupMember.findFirst({
        where: {
          groupId,
          userId: initiatorId,
        },
      });

      if (!isMember) {
        throw new BadRequestException('Initiator is not a member of the group');
      }
    }

    // For direct calls, verify that the receiver exists
    if (receiverId) {
      const receiver = await this.prisma.user.findUnique({
        where: { id: receiverId },
      });

      if (!receiver) {
        throw new NotFoundException(`User with ID ${receiverId} not found`);
      }
    }

    // Generate a unique room ID
    const roomId = uuidv4();

    // Create the call in the database
    const call = await this.prisma.call.create({
      data: {
        initiatorId,
        groupId,
        type,
        status: CallStatus.RINGING,
        roomId,
        participants: {
          create: {
            userId: initiatorId,
            status: 'connected',
          },
        },
      },
      include: {
        initiator: {
          include: {
            userInfo: true,
          },
        },
        group: groupId ? true : false,
        participants: {
          include: {
            user: {
              include: {
                userInfo: true,
              },
            },
          },
        },
      },
    });

    // Create a mediasoup router for the call
    await this.mediasoupService.createRouter(roomId);

    // Create a room in memory
    const room: CallRoom = {
      id: roomId,
      callId: call.id,
      participants: new Map(),
    };

    // Add the initiator to the room
    room.participants.set(initiatorId, {
      id: uuidv4(),
      userId: initiatorId,
      producerIds: [],
      consumerIds: [],
      joined: false,
    });

    // Store the room
    this.activeRooms.set(roomId, room);

    // If it's a direct call, emit an event to notify the receiver
    if (receiverId) {
      this.eventService.emitEvent('call.incoming', {
        callId: call.id,
        initiatorId,
        receiverId,
        type,
        roomId,
      });
    }
    // If it's a group call, emit an event to notify all group members
    else if (groupId) {
      // Get all group members except the initiator
      const groupMembers = await this.prisma.groupMember.findMany({
        where: {
          groupId,
          userId: {
            not: initiatorId,
          },
        },
        select: {
          userId: true,
        },
      });

      // Emit an event for each group member
      for (const member of groupMembers) {
        this.eventService.emitEvent('call.incoming', {
          callId: call.id,
          initiatorId,
          receiverId: member.userId,
          groupId,
          type,
          roomId,
        });
      }
    }

    return call;
  }

  /**
   * Join a call
   * @param joinCallDto The join call data
   */
  async joinCall(joinCallDto: JoinCallDto): Promise<Call> {
    const { callId, userId } = joinCallDto;

    // Find the call
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: {
        initiator: {
          include: {
            userInfo: true,
          },
        },
        group: true,
        participants: {
          include: {
            user: {
              include: {
                userInfo: true,
              },
            },
          },
        },
      },
    });

    if (!call) {
      throw new NotFoundException(`Call with ID ${callId} not found`);
    }

    // Check if the call is still active
    if (
      call.status !== CallStatus.RINGING &&
      call.status !== CallStatus.ONGOING
    ) {
      throw new BadRequestException('Call is no longer active');
    }

    // Check if the user is allowed to join the call
    if (
      !call.groupId &&
      call.initiatorId !== userId &&
      !call.participants.some((p) => p.userId === userId)
    ) {
      throw new BadRequestException('User is not allowed to join this call');
    }

    // For group calls, verify that the user is a member of the group
    if (call.groupId) {
      const isMember = await this.prisma.groupMember.findFirst({
        where: {
          groupId: call.groupId,
          userId,
        },
      });

      if (!isMember) {
        throw new BadRequestException('User is not a member of the group');
      }
    }

    // Check if the user is already a participant
    const existingParticipant = call.participants.find(
      (p) => p.userId === userId,
    );

    if (!existingParticipant) {
      // Add the user as a participant
      await this.prisma.callParticipant.create({
        data: {
          callId,
          userId,
          status: 'connected',
        },
      });
    } else if (existingParticipant.status !== 'connected') {
      // Update the participant status
      await this.prisma.callParticipant.update({
        where: { id: existingParticipant.id },
        data: {
          status: 'connected',
          leftAt: null,
        },
      });
    }

    // Update call status to ONGOING
    if (call.status === CallStatus.RINGING) {
      await this.prisma.call.update({
        where: { id: callId },
        data: {
          status: CallStatus.ONGOING,
        },
      });
    }

    // Get the room
    let room = this.activeRooms.get(call.roomId);

    if (!room) {
      // Create a new room if it doesn't exist
      room = {
        id: call.roomId,
        callId: call.id,
        participants: new Map(),
      };
      this.activeRooms.set(call.roomId, room);

      // Create a mediasoup router for the call
      await this.mediasoupService.createRouter(call.roomId);
    }

    // Add the user to the room if not already present
    if (!room.participants.has(userId)) {
      room.participants.set(userId, {
        id: uuidv4(),
        userId,
        producerIds: [],
        consumerIds: [],
        joined: false,
      });
    }

    // Emit an event to notify other participants
    this.eventService.emitEvent('call.participant.joined', {
      callId,
      userId,
      roomId: call.roomId,
    });

    // Get the updated call
    const updatedCall = await this.prisma.call.findUnique({
      where: { id: callId },
      include: {
        initiator: {
          include: {
            userInfo: true,
          },
        },
        group: true,
        participants: {
          include: {
            user: {
              include: {
                userInfo: true,
              },
            },
          },
        },
      },
    });

    return updatedCall;
  }

  /**
   * End a call
   * @param endCallDto The end call data
   */
  async endCall(endCallDto: EndCallDto): Promise<Call> {
    const { callId, userId } = endCallDto;

    // Find the call
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: {
        participants: true,
      },
    });

    if (!call) {
      throw new NotFoundException(`Call with ID ${callId} not found`);
    }

    // Check if the call is already ended
    if (
      call.status === CallStatus.ENDED ||
      call.status === CallStatus.MISSED ||
      call.status === CallStatus.REJECTED
    ) {
      throw new BadRequestException('Call is already ended');
    }

    // Check if the user is a participant or the initiator
    const isParticipant = call.participants.some((p) => p.userId === userId);
    const isInitiator = call.initiatorId === userId;

    if (!isParticipant && !isInitiator) {
      throw new BadRequestException('User is not a participant in this call');
    }

    // If the user is the initiator or the only participant, end the call
    if (isInitiator || call.participants.length === 1) {
      // Calculate call duration
      const duration = call.startedAt
        ? Math.floor((Date.now() - call.startedAt.getTime()) / 1000)
        : 0;

      // Update the call status
      const updatedCall = await this.prisma.call.update({
        where: { id: callId },
        data: {
          status: CallStatus.ENDED,
          endedAt: new Date(),
          duration,
        },
        include: {
          initiator: {
            include: {
              userInfo: true,
            },
          },
          group: true,
          participants: {
            include: {
              user: {
                include: {
                  userInfo: true,
                },
              },
            },
          },
        },
      });

      // Update all participants
      for (const participant of call.participants) {
        if (participant.status === 'connected' && !participant.leftAt) {
          await this.prisma.callParticipant.update({
            where: { id: participant.id },
            data: {
              status: 'disconnected',
              leftAt: new Date(),
            },
          });
        }
      }

      // Close the mediasoup router
      this.mediasoupService.closeRouter(call.roomId);

      // Remove the room
      this.activeRooms.delete(call.roomId);

      // Emit an event to notify all participants
      this.eventService.emitEvent('call.ended', {
        callId,
        initiatorId: call.initiatorId,
        roomId: call.roomId,
        endedBy: userId,
      });

      return updatedCall;
    }
    // If the user is just leaving the call but others remain
    else {
      // Update the participant
      const participant = call.participants.find((p) => p.userId === userId);

      await this.prisma.callParticipant.update({
        where: { id: participant.id },
        data: {
          status: 'disconnected',
          leftAt: new Date(),
        },
      });

      // Get the room
      const room = this.activeRooms.get(call.roomId);

      if (room) {
        // Remove the user from the room
        room.participants.delete(userId);

        // Close the user's transports
        this.mediasoupService.closeTransport(call.roomId, userId, 'send');
        this.mediasoupService.closeTransport(call.roomId, userId, 'recv');

        // If no participants remain, close the room
        if (room.participants.size === 0) {
          this.mediasoupService.closeRouter(call.roomId);
          this.activeRooms.delete(call.roomId);

          // Update the call status
          await this.prisma.call.update({
            where: { id: callId },
            data: {
              status: CallStatus.ENDED,
              endedAt: new Date(),
              duration: Math.floor(
                (Date.now() - call.startedAt.getTime()) / 1000,
              ),
            },
          });
        }
      }

      // Emit an event to notify other participants
      this.eventService.emitEvent('call.participant.left', {
        callId,
        userId,
        roomId: call.roomId,
      });

      // Get the updated call
      const updatedCall = await this.prisma.call.findUnique({
        where: { id: callId },
        include: {
          initiator: {
            include: {
              userInfo: true,
            },
          },
          group: true,
          participants: {
            include: {
              user: {
                include: {
                  userInfo: true,
                },
              },
            },
          },
        },
      });

      return updatedCall;
    }
  }

  /**
   * Reject a call
   * @param callId The call ID
   * @param userId The user ID
   */
  async rejectCall(callId: string, userId: string): Promise<Call> {
    // Find the call
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
    });

    if (!call) {
      throw new NotFoundException(`Call with ID ${callId} not found`);
    }

    // Check if the call is still ringing
    if (call.status !== CallStatus.RINGING) {
      throw new BadRequestException('Call is no longer ringing');
    }

    // Check if the user is the receiver (for direct calls)
    if (!call.groupId && call.initiatorId !== userId) {
      // Update the call status
      const updatedCall = await this.prisma.call.update({
        where: { id: callId },
        data: {
          status: CallStatus.REJECTED,
          endedAt: new Date(),
        },
        include: {
          initiator: {
            include: {
              userInfo: true,
            },
          },
          group: true,
          participants: {
            include: {
              user: {
                include: {
                  userInfo: true,
                },
              },
            },
          },
        },
      });

      // Close the mediasoup router
      this.mediasoupService.closeRouter(call.roomId);

      // Remove the room
      this.activeRooms.delete(call.roomId);

      // Emit an event to notify the initiator
      this.eventService.emitEvent('call.rejected', {
        callId,
        initiatorId: call.initiatorId,
        receiverId: userId,
        roomId: call.roomId,
      });

      return updatedCall;
    }
    // For group calls, just mark the user as rejected
    else if (call.groupId) {
      // Check if the user is a member of the group
      const isMember = await this.prisma.groupMember.findFirst({
        where: {
          groupId: call.groupId,
          userId,
        },
      });

      if (!isMember) {
        throw new BadRequestException('User is not a member of the group');
      }

      // Add the user as a participant with status 'rejected'
      await this.prisma.callParticipant.create({
        data: {
          callId,
          userId,
          status: 'rejected',
          leftAt: new Date(),
        },
      });

      // Emit an event to notify the initiator
      this.eventService.emitEvent('call.participant.rejected', {
        callId,
        initiatorId: call.initiatorId,
        userId,
        groupId: call.groupId,
        roomId: call.roomId,
      });

      // Get the updated call
      const updatedCall = await this.prisma.call.findUnique({
        where: { id: callId },
        include: {
          initiator: {
            include: {
              userInfo: true,
            },
          },
          group: true,
          participants: {
            include: {
              user: {
                include: {
                  userInfo: true,
                },
              },
            },
          },
        },
      });

      return updatedCall;
    }

    throw new BadRequestException('User is not allowed to reject this call');
  }

  /**
   * Get a call by ID
   * @param callId The call ID
   */
  async getCall(callId: string): Promise<Call> {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: {
        initiator: {
          include: {
            userInfo: true,
          },
        },
        group: true,
        participants: {
          include: {
            user: {
              include: {
                userInfo: true,
              },
            },
          },
        },
      },
    });

    if (!call) {
      throw new NotFoundException(`Call with ID ${callId} not found`);
    }

    return call;
  }

  /**
   * Get active calls for a user
   * @param userId The user ID
   */
  async getActiveCallsForUser(userId: string): Promise<Call[]> {
    // Get calls where the user is a participant and the call is active
    const calls = await this.prisma.call.findMany({
      where: {
        OR: [
          {
            initiatorId: userId,
            status: {
              in: [CallStatus.RINGING, CallStatus.ONGOING],
            },
          },
          {
            participants: {
              some: {
                userId,
                status: 'connected',
              },
            },
            status: {
              in: [CallStatus.RINGING, CallStatus.ONGOING],
            },
          },
        ],
      },
      include: {
        initiator: {
          include: {
            userInfo: true,
          },
        },
        group: true,
        participants: {
          include: {
            user: {
              include: {
                userInfo: true,
              },
            },
          },
        },
      },
      orderBy: {
        startedAt: 'desc',
      },
    });

    return calls;
  }

  /**
   * Get call history for a user
   * @param userId The user ID
   * @param page The page number
   * @param limit The number of items per page
   */
  async getCallHistory(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<{ calls: Call[]; total: number }> {
    const skip = (page - 1) * limit;

    // Get calls where the user is a participant
    const [calls, total] = await Promise.all([
      this.prisma.call.findMany({
        where: {
          OR: [
            { initiatorId: userId },
            {
              participants: {
                some: {
                  userId,
                },
              },
            },
          ],
          status: {
            in: [CallStatus.ENDED, CallStatus.MISSED, CallStatus.REJECTED],
          },
        },
        include: {
          initiator: {
            include: {
              userInfo: true,
            },
          },
          group: true,
          participants: {
            include: {
              user: {
                include: {
                  userInfo: true,
                },
              },
            },
          },
        },
        orderBy: {
          startedAt: 'desc',
        },
        skip,
        take: limit,
      }),
      this.prisma.call.count({
        where: {
          OR: [
            { initiatorId: userId },
            {
              participants: {
                some: {
                  userId,
                },
              },
            },
          ],
          status: {
            in: [CallStatus.ENDED, CallStatus.MISSED, CallStatus.REJECTED],
          },
        },
      }),
    ]);

    return { calls, total };
  }

  /**
   * Get a room by ID
   * @param roomId The room ID
   */
  getRoom(roomId: string): CallRoom {
    const room = this.activeRooms.get(roomId);
    if (!room) {
      throw new NotFoundException(`Room with ID ${roomId} not found`);
    }
    return room;
  }

  /**
   * Get a participant in a room
   * @param roomId The room ID
   * @param userId The user ID
   */
  getRoomParticipant(roomId: string, userId: string): CallRoomParticipant {
    const room = this.getRoom(roomId);
    const participant = room.participants.get(userId);
    if (!participant) {
      throw new NotFoundException(
        `Participant with ID ${userId} not found in room ${roomId}`,
      );
    }
    return participant;
  }

  /**
   * Set a participant's RTP capabilities
   * @param roomId The room ID
   * @param userId The user ID
   * @param rtpCapabilities The RTP capabilities
   */
  setParticipantRtpCapabilities(
    roomId: string,
    userId: string,
    rtpCapabilities: any,
  ): void {
    const participant = this.getRoomParticipant(roomId, userId);
    participant.rtpCapabilities = rtpCapabilities;
  }

  /**
   * Mark a participant as joined
   * @param roomId The room ID
   * @param userId The user ID
   */
  markParticipantAsJoined(roomId: string, userId: string): void {
    const participant = this.getRoomParticipant(roomId, userId);
    participant.joined = true;
  }

  /**
   * Add a producer ID to a participant
   * @param roomId The room ID
   * @param userId The user ID
   * @param producerId The producer ID
   */
  addProducerToParticipant(
    roomId: string,
    userId: string,
    producerId: string,
  ): void {
    const participant = this.getRoomParticipant(roomId, userId);
    participant.producerIds.push(producerId);
  }

  /**
   * Add a consumer ID to a participant
   * @param roomId The room ID
   * @param userId The user ID
   * @param consumerId The consumer ID
   */
  addConsumerToParticipant(
    roomId: string,
    userId: string,
    consumerId: string,
  ): void {
    const participant = this.getRoomParticipant(roomId, userId);
    participant.consumerIds.push(consumerId);
  }

  /**
   * Get all participants in a room except the specified user
   * @param roomId The room ID
   * @param excludeUserId The user ID to exclude
   */
  getOtherParticipants(
    roomId: string,
    excludeUserId: string,
  ): CallRoomParticipant[] {
    const room = this.getRoom(roomId);
    const participants: CallRoomParticipant[] = [];

    room.participants.forEach((participant, userId) => {
      if (userId !== excludeUserId && participant.joined) {
        participants.push(participant);
      }
    });

    return participants;
  }
}
