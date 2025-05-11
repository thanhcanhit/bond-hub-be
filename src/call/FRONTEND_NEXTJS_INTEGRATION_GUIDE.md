# HƯỚNG DẪN TÍCH HỢP CHỨC NĂNG GỌI ĐIỆN VỚI NEXT.JS

## Giới thiệu

Tài liệu này hướng dẫn chi tiết cách tích hợp chức năng gọi điện và video call với ứng dụng Next.js, sử dụng module `@call` từ backend. Hướng dẫn bao gồm các bước cài đặt, cấu hình, và triển khai các tính năng gọi điện trong ứng dụng Next.js.

## Cài đặt các thư viện cần thiết

```bash
# Cài đặt mediasoup-client
npm install mediasoup-client

# Cài đặt socket.io-client
npm install socket.io-client

# Cài đặt các thư viện hỗ trợ
npm install axios
npm install zustand # Quản lý state
npm install react-icons # Icons
```

## Cấu trúc thư mục

```
src/
  ├── app/
  │   ├── call/
  │   │   ├── page.tsx           # Trang chính cho cuộc gọi
  │   │   ├── incoming/
  │   │   │   └── page.tsx       # Trang cuộc gọi đến
  │   │   └── layout.tsx         # Layout cho các trang cuộc gọi
  │   └── ...
  ├── components/
  │   ├── call/
  │   │   ├── CallControls.tsx   # Component điều khiển cuộc gọi
  │   │   ├── VideoStream.tsx    # Component hiển thị video
  │   │   └── CallModal.tsx      # Modal cuộc gọi
  │   └── ...
  ├── lib/
  │   ├── call/
  │   │   ├── CallService.ts     # Service xử lý logic gọi điện
  │   │   ├── CallStore.ts       # Zustand store cho cuộc gọi
  │   │   └── types.ts           # Các type definitions
  │   └── ...
  └── ...
```

## Cấu hình WebRTC

### 1. Khởi tạo CallService

```typescript
// src/lib/call/CallService.ts
import { io, Socket } from 'socket.io-client';
import { Device } from 'mediasoup-client';

export class CallService {
  private socket: Socket;
  private device: Device;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;

  constructor() {
    // Khởi tạo socket.io
    this.socket = io('YOUR_BACKEND_URL/call', {
      auth: {
        token: 'YOUR_JWT_TOKEN'
      },
      transports: ['websocket'],
    });

    // Khởi tạo mediasoup device
    this.device = new Device();

    // Đăng ký các event listeners
    this.registerEventListeners();
  }

  private registerEventListeners() {
    // Xử lý sự kiện cuộc gọi đến
    this.socket.on('call:incoming', (data) => {
      // Emit event để UI cập nhật
      window.dispatchEvent(new CustomEvent('call:incoming', { detail: data }));
    });

    // Xử lý sự kiện kết thúc cuộc gọi
    this.socket.on('call:ended', (data) => {
      window.dispatchEvent(new CustomEvent('call:ended', { detail: data }));
    });

    // Xử lý sự kiện người tham gia tham gia
    this.socket.on('call:participant:joined', (data) => {
      window.dispatchEvent(new CustomEvent('call:participant:joined', { detail: data }));
    });

    // Xử lý sự kiện người tham gia rời đi
    this.socket.on('call:participant:left', (data) => {
      window.dispatchEvent(new CustomEvent('call:participant:left', { detail: data }));
    });
  }

  // Khởi tạo cuộc gọi
  async initiateCall(receiverId: string, type: 'AUDIO' | 'VIDEO'): Promise<Call> {
    try {
      // 1. Gọi API tạo cuộc gọi
      const response = await axios.post('/api/v1/calls', {
        initiatorId: currentUserId,
        receiverId,
        type,
      });

      const { callId, roomId } = response.data;

      // 2. Yêu cầu quyền truy cập media
      await this.requestMediaPermissions(type);

      // 3. Lấy local stream
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: type === 'VIDEO',
      });

      // 4. Tham gia phòng gọi
      await this.joinCall(callId, roomId);

      return response.data;
    } catch (error) {
      console.error('Error initiating call:', error);
      throw error;
    }
  }

  // Tham gia cuộc gọi
  async joinCall(callId: string, roomId: string): Promise<void> {
    try {
      // 1. Gọi API tham gia cuộc gọi
      await axios.post('/api/v1/calls/join', {
        callId,
        userId: currentUserId,
      });

      // 2. Tham gia phòng WebRTC
      this.socket.emit('joinRoom', { roomId });

      // 3. Lấy RTP capabilities
      this.socket.emit('getRtpCapabilities', { roomId }, async (data) => {
        const { rtpCapabilities } = data;
        
        // 4. Khởi tạo device WebRTC
        await this.device.load({ routerRtpCapabilities: rtpCapabilities });
        
        // 5. Tạo transport gửi
        await this.createSendTransport(roomId);
        
        // 6. Tạo transport nhận
        await this.createRecvTransport(roomId);
      });
    } catch (error) {
      console.error('Error joining call:', error);
      throw error;
    }
  }

  // Tạo transport gửi
  private async createSendTransport(roomId: string): Promise<void> {
    this.socket.emit('createWebRtcTransport', {
      roomId,
      direction: 'send',
    }, async (data) => {
      const { id, iceParameters, iceCandidates, dtlsParameters } = data;
      
      const sendTransport = this.device.createSendTransport({
        id,
        iceParameters,
        iceCandidates,
        dtlsParameters,
      });

      // Xử lý sự kiện connect
      sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        this.socket.emit('connectWebRtcTransport', {
          roomId,
          direction: 'send',
          dtlsParameters,
        }, callback);
      });

      // Xử lý sự kiện produce
      sendTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
        this.socket.emit('produce', {
          roomId,
          kind,
          rtpParameters,
        }, ({ id }) => {
          callback({ id });
        });
      });

      // Tạo producer cho audio
      const audioTrack = this.localStream.getAudioTracks()[0];
      const audioProducer = await sendTransport.produce({
        track: audioTrack,
        encodings: [
          { maxBitrate: 64000, dtx: true },
        ],
        codecOptions: {
          opusStereo: true,
          opusDtx: true,
        },
      });

      // Tạo producer cho video (nếu là video call)
      if (this.localStream.getVideoTracks().length > 0) {
        const videoTrack = this.localStream.getVideoTracks()[0];
        const videoProducer = await sendTransport.produce({
          track: videoTrack,
          encodings: [
            { maxBitrate: 1000000, scalabilityMode: 'S3T3' },
            { maxBitrate: 300000, scalabilityMode: 'S3T3' },
            { maxBitrate: 150000, scalabilityMode: 'S3T3' },
          ],
          codecOptions: {
            videoGoogleStartBitrate: 1000,
          },
        });
      }
    });
  }

  // Tạo transport nhận
  private async createRecvTransport(roomId: string): Promise<void> {
    this.socket.emit('createWebRtcTransport', {
      roomId,
      direction: 'recv',
    }, async (data) => {
      const { id, iceParameters, iceCandidates, dtlsParameters } = data;
      
      const recvTransport = this.device.createRecvTransport({
        id,
        iceParameters,
        iceCandidates,
        dtlsParameters,
      });

      // Xử lý sự kiện connect
      recvTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        this.socket.emit('connectWebRtcTransport', {
          roomId,
          direction: 'recv',
          dtlsParameters,
        }, callback);
      });

      // Lấy danh sách producers
      this.socket.emit('getProducers', { roomId }, async (data) => {
        const { producers } = data;
        
        // Tạo consumer cho mỗi producer
        for (const producer of producers) {
          const consumer = await recvTransport.consume({
            id: producer.id,
            producerId: producer.id,
            kind: producer.kind,
            rtpParameters: producer.rtpParameters,
          });

          // Tiếp tục consumer
          this.socket.emit('resumeConsumer', {
            consumerId: consumer.id,
          });
        }
      });
    });
  }
}
```

### 2. Tạo Zustand Store

```typescript
// src/lib/call/CallStore.ts
import { create } from 'zustand';
import { CallService } from './CallService';

interface CallState {
  callService: CallService;
  isInCall: boolean;
  callType: 'AUDIO' | 'VIDEO' | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  startCall: (receiverId: string, type: 'AUDIO' | 'VIDEO') => Promise<void>;
  endCall: () => Promise<void>;
}

export const useCallStore = create<CallState>((set) => ({
  callService: new CallService(),
  isInCall: false,
  callType: null,
  localStream: null,
  remoteStream: null,

  startCall: async (receiverId: string, type: 'AUDIO' | 'VIDEO') => {
    try {
      const call = await useCallStore.getState().callService.initiateCall(receiverId, type);
      set({
        isInCall: true,
        callType: type,
        localStream: useCallStore.getState().callService.localStream,
      });
    } catch (error) {
      console.error('Error starting call:', error);
      throw error;
    }
  },

  endCall: async () => {
    try {
      await useCallStore.getState().callService.endCall();
      set({
        isInCall: false,
        callType: null,
        localStream: null,
        remoteStream: null,
      });
    } catch (error) {
      console.error('Error ending call:', error);
      throw error;
    }
  },
}));
```

### 3. Tạo Component VideoStream

```typescript
// src/components/call/VideoStream.tsx
import React, { useEffect, useRef } from 'react';

interface VideoStreamProps {
  stream: MediaStream | null;
  isLocal?: boolean;
}

export const VideoStream: React.FC<VideoStreamProps> = ({ stream, isLocal = false }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={isLocal}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        transform: isLocal ? 'scaleX(-1)' : 'none',
      }}
    />
  );
};
```

### 4. Tạo Component CallControls

```typescript
// src/components/call/CallControls.tsx
import React from 'react';
import { FaMicrophone, FaMicrophoneSlash, FaVideo, FaVideoSlash, FaPhoneSlash } from 'react-icons/fa';

interface CallControlsProps {
  onEndCall: () => void;
  onToggleMute?: () => void;
  onToggleCamera?: () => void;
  isMuted?: boolean;
  isCameraOff?: boolean;
}

export const CallControls: React.FC<CallControlsProps> = ({
  onEndCall,
  onToggleMute,
  onToggleCamera,
  isMuted = false,
  isCameraOff = false,
}) => {
  return (
    <div className="fixed bottom-8 left-0 right-0 flex justify-center items-center space-x-4">
      <button
        className="w-12 h-12 rounded-full bg-gray-600 flex items-center justify-center"
        onClick={onToggleMute}
      >
        {isMuted ? (
          <FaMicrophoneSlash className="text-white text-xl" />
        ) : (
          <FaMicrophone className="text-white text-xl" />
        )}
      </button>

      <button
        className="w-14 h-14 rounded-full bg-red-600 flex items-center justify-center"
        onClick={onEndCall}
      >
        <FaPhoneSlash className="text-white text-2xl" />
      </button>

      {onToggleCamera && (
        <button
          className="w-12 h-12 rounded-full bg-gray-600 flex items-center justify-center"
          onClick={onToggleCamera}
        >
          {isCameraOff ? (
            <FaVideoSlash className="text-white text-xl" />
          ) : (
            <FaVideo className="text-white text-xl" />
          )}
        </button>
      )}
    </div>
  );
};
```

### 5. Tạo Component CallModal

```typescript
// src/components/call/CallModal.tsx
import React from 'react';
import { VideoStream } from './VideoStream';
import { CallControls } from './CallControls';
import { useCallStore } from '@/lib/call/CallStore';

export const CallModal: React.FC = () => {
  const {
    isInCall,
    callType,
    localStream,
    remoteStream,
    endCall,
  } = useCallStore();

  if (!isInCall) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black z-50">
      {callType === 'VIDEO' && (
        <>
          <div className="absolute inset-0">
            <VideoStream stream={remoteStream} />
          </div>
          <div className="absolute top-4 right-4 w-48 h-64 rounded-lg overflow-hidden">
            <VideoStream stream={localStream} isLocal />
          </div>
        </>
      )}
      <CallControls onEndCall={endCall} />
    </div>
  );
};
```

### 6. Tạo trang cuộc gọi

```typescript
// src/app/call/page.tsx
'use client';

import React from 'react';
import { CallModal } from '@/components/call/CallModal';
import { useCallStore } from '@/lib/call/CallStore';

export default function CallPage() {
  const { isInCall } = useCallStore();

  if (!isInCall) {
    return null;
  }

  return <CallModal />;
}
```

### 7. Tạo trang cuộc gọi đến

```typescript
// src/app/call/incoming/page.tsx
'use client';

import React from 'react';
import { useCallStore } from '@/lib/call/CallStore';
import { FaPhone, FaPhoneSlash } from 'react-icons/fa';

export default function IncomingCallPage() {
  const { callService } = useCallStore();
  const [callData, setCallData] = React.useState<any>(null);

  React.useEffect(() => {
    const handleIncomingCall = (event: CustomEvent) => {
      setCallData(event.detail);
    };

    window.addEventListener('call:incoming', handleIncomingCall as EventListener);

    return () => {
      window.removeEventListener('call:incoming', handleIncomingCall as EventListener);
    };
  }, []);

  const handleAccept = async () => {
    if (callData) {
      await callService.acceptCall(callData.callId);
    }
  };

  const handleReject = async () => {
    if (callData) {
      await callService.rejectCall(callData.callId);
    }
  };

  if (!callData) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-8 text-center">
        <h2 className="text-2xl font-bold mb-4">Cuộc gọi đến</h2>
        <p className="mb-8">Từ: {callData.initiatorId}</p>
        <div className="flex justify-center space-x-4">
          <button
            className="w-14 h-14 rounded-full bg-green-600 flex items-center justify-center"
            onClick={handleAccept}
          >
            <FaPhone className="text-white text-2xl" />
          </button>
          <button
            className="w-14 h-14 rounded-full bg-red-600 flex items-center justify-center"
            onClick={handleReject}
          >
            <FaPhoneSlash className="text-white text-2xl" />
          </button>
        </div>
      </div>
    </div>
  );
}
```

## Luồng hoạt động chi tiết

### 1. Khởi tạo cuộc gọi

#### Frontend (Next.js)

1. Người dùng nhấn nút gọi:
```typescript
const handleCall = async () => {
  try {
    await useCallStore.getState().startCall(receiverId, 'VIDEO');
    // Chuyển đến trang cuộc gọi
    router.push('/call');
  } catch (error) {
    // Xử lý lỗi
  }
};
```

2. `CallService` gọi API tạo cuộc gọi:
```typescript
const response = await axios.post('/api/v1/calls', {
  initiatorId: currentUserId,
  receiverId,
  type: 'VIDEO',
});
```

#### Backend

1. `CallController` nhận request và chuyển đến `CallService`
2. `CallService` tạo bản ghi cuộc gọi mới trong database
3. `CallService` tạo router mediasoup mới
4. `CallService` phát sự kiện `call.incoming`
5. `CallGateway` gửi thông báo đến người nhận qua WebSocket

#### Frontend (Người nhận)

1. Nhận sự kiện `call:incoming`:
```typescript
window.addEventListener('call:incoming', (event: CustomEvent) => {
  // Hiển thị modal cuộc gọi đến
  setCallData(event.detail);
});
```

2. Hiển thị modal cuộc gọi đến:
```typescript
<CallModal
  type="incoming"
  callData={callData}
  onAccept={handleAccept}
  onReject={handleReject}
/>
```

### 2. Chấp nhận cuộc gọi

#### Frontend (Người nhận)

1. Người dùng nhấn nút chấp nhận:
```typescript
const handleAccept = async () => {
  try {
    await callService.acceptCall(callId);
    // Chuyển đến trang cuộc gọi
    router.push('/call');
  } catch (error) {
    // Xử lý lỗi
  }
};
```

2. `CallService` gọi API tham gia cuộc gọi:
```typescript
await axios.post('/api/v1/calls/join', {
  callId,
  userId: currentUserId,
});
```

#### Backend

1. `CallController` nhận request và chuyển đến `CallService`
2. `CallService` cập nhật trạng thái cuộc gọi thành `ONGOING`
3. `CallService` thêm người tham gia vào danh sách
4. `CallService` phát sự kiện `call.participant.joined`
5. `CallGateway` thông báo cho tất cả người tham gia

### 3. Thiết lập kết nối WebRTC

#### Frontend

1. Tham gia phòng WebRTC:
```typescript
socket.emit('joinRoom', { roomId });
```

2. Lấy RTP capabilities:
```typescript
socket.emit('getRtpCapabilities', { roomId }, async (data) => {
  const { rtpCapabilities } = data;
  await device.load({ routerRtpCapabilities: rtpCapabilities });
});
```

3. Tạo transport gửi và nhận:
```typescript
// Tạo transport gửi
const sendTransport = await createSendTransport(roomId);

// Tạo transport nhận
const recvTransport = await createRecvTransport(roomId);
```

4. Tạo producer cho audio/video:
```typescript
// Tạo producer cho audio
const audioProducer = await sendTransport.produce({
  track: localStream.getAudioTracks()[0],
  // ... các options khác
});

// Tạo producer cho video
const videoProducer = await sendTransport.produce({
  track: localStream.getVideoTracks()[0],
  // ... các options khác
});
```

5. Tạo consumer cho producer của đối phương:
```typescript
// Lấy danh sách producers
socket.emit('getProducers', { roomId }, async (data) => {
  const { producers } = data;
  
  // Tạo consumer cho mỗi producer
  for (const producer of producers) {
    const consumer = await recvTransport.consume({
      id: producer.id,
      producerId: producer.id,
      kind: producer.kind,
      rtpParameters: producer.rtpParameters,
    });

    // Tiếp tục consumer
    socket.emit('resumeConsumer', {
      consumerId: consumer.id,
    });
  }
});
```

### 4. Kết thúc cuộc gọi

#### Frontend

1. Người dùng nhấn nút kết thúc:
```typescript
const handleEndCall = async () => {
  try {
    await useCallStore.getState().endCall();
    // Quay lại trang trước đó
    router.back();
  } catch (error) {
    // Xử lý lỗi
  }
};
```

2. `CallService` gọi API kết thúc cuộc gọi:
```typescript
await axios.post('/api/v1/calls/end', {
  callId,
  userId: currentUserId,
});
```

#### Backend

1. `CallController` nhận request và chuyển đến `CallService`
2. `CallService` cập nhật trạng thái cuộc gọi thành `ENDED`
3. `CallService` tính toán thời lượng cuộc gọi
4. `CallService` đóng router và các kết nối liên quan
5. `CallService` phát sự kiện `call.ended`
6. `CallGateway` thông báo cho tất cả người tham gia

## Xử lý các trường hợp đặc biệt

### 1. Mất kết nối

```typescript
// Trong CallService
private handleDisconnect() {
  // Thử kết nối lại
  this.socket.connect();

  // Nếu đang trong cuộc gọi, thông báo cho người dùng
  if (this.isInCall) {
    // Hiển thị thông báo
    window.dispatchEvent(new CustomEvent('call:disconnected'));
  }
}

// Đăng ký lắng nghe sự kiện disconnect
this.socket.on('disconnect', this.handleDisconnect);
```

### 2. Chuyển đổi camera

```typescript
const switchCamera = async () => {
  try {
    const currentCamera = localStream.getVideoTracks()[0];
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: currentCamera.getSettings().facingMode === 'user' ? 'environment' : 'user',
      },
    });

    const newTrack = newStream.getVideoTracks()[0];
    await currentCamera.replaceTrack(newTrack);
  } catch (error) {
    console.error('Error switching camera:', error);
  }
};
```

### 3. Tắt/bật microphone

```typescript
const toggleMute = () => {
  const audioTrack = localStream.getAudioTracks()[0];
  audioTrack.enabled = !audioTrack.enabled;
  setIsMuted(!audioTrack.enabled);
};
```

### 4. Tắt/bật camera

```typescript
const toggleCamera = () => {
  const videoTrack = localStream.getVideoTracks()[0];
  videoTrack.enabled = !videoTrack.enabled;
  setIsCameraOff(!videoTrack.enabled);
};
```

## Tối ưu hiệu suất

### 1. Điều chỉnh chất lượng video

```typescript
const adjustVideoQuality = (quality: 'high' | 'medium' | 'low') => {
  const videoTrack = localStream.getVideoTracks()[0];
  const constraints = {
    high: {
      width: 1280,
      height: 720,
      frameRate: 30,
    },
    medium: {
      width: 640,
      height: 480,
      frameRate: 24,
    },
    low: {
      width: 320,
      height: 240,
      frameRate: 15,
    },
  };

  videoTrack.applyConstraints(constraints[quality]);
};
```

### 2. Xử lý băng thông

```typescript
const handleBandwidthChange = (bandwidth: number) => {
  if (bandwidth < 500000) { // 500kbps
    adjustVideoQuality('low');
  } else if (bandwidth < 1000000) { // 1Mbps
    adjustVideoQuality('medium');
  } else {
    adjustVideoQuality('high');
  }
};
```

## Kết luận

Tài liệu này đã hướng dẫn chi tiết cách tích hợp chức năng gọi điện và video call với Next.js, sử dụng module `@call` từ backend. Để triển khai thành công, hãy đảm bảo:

1. Cấu hình đúng các quyền truy cập camera và microphone
2. Xử lý các trường hợp đặc biệt như mất kết nối
3. Tối ưu hiệu suất bằng cách điều chỉnh chất lượng video
4. Xử lý các sự kiện WebSocket một cách đúng đắn
5. Quản lý trạng thái cuộc gọi thông qua Zustand store

Tham khảo thêm tài liệu chính thức của mediasoup và WebRTC để xử lý các trường hợp đặc biệt và tối ưu hiệu suất. 