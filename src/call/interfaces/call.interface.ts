import { CallStatus, CallType } from '@prisma/client';

export interface CallParticipant {
  id: string;
  userId: string;
  callId: string;
  joinedAt: Date;
  leftAt?: Date;
  status: string;
  user?: {
    id: string;
    email?: string;
    phoneNumber?: string;
    userInfo?: {
      fullName?: string;
      profilePictureUrl?: string;
    };
  };
}

export interface Call {
  id: string;
  initiatorId: string;
  groupId?: string;
  type: CallType;
  status: CallStatus;
  startedAt: Date;
  endedAt?: Date;
  duration?: number;
  roomId: string;
  participants?: CallParticipant[];
  initiator?: {
    id: string;
    email?: string;
    phoneNumber?: string;
    userInfo?: {
      fullName?: string;
      profilePictureUrl?: string;
    };
  };
  group?: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
}

export interface CallRoom {
  id: string;
  callId: string;
  participants: Map<string, CallRoomParticipant>;
}

export interface CallRoomParticipant {
  id: string;
  userId: string;
  producerIds: string[];
  consumerIds: string[];
  rtpCapabilities?: any;
  joined: boolean;
}

export interface MediasoupTransport {
  id: string;
  iceParameters: any;
  iceCandidates: any[];
  dtlsParameters: any;
}
