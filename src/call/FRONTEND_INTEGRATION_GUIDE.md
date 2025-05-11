# HƯỚNG DẪN TÍCH HỢP CHỨC NĂNG GỌI ĐIỆN VỚI REACT NATIVE

## Giới thiệu

Tài liệu này hướng dẫn chi tiết cách tích hợp chức năng gọi điện và video call với ứng dụng React Native, sử dụng module `@call` từ backend. Hướng dẫn bao gồm các bước cài đặt, cấu hình, và triển khai các tính năng gọi điện trong ứng dụng React Native.

## Cài đặt các thư viện cần thiết

```bash
# Cài đặt mediasoup-client
npm install mediasoup-client

# Cài đặt socket.io-client
npm install socket.io-client

# Cài đặt react-native-webrtc (cho truy cập camera và microphone)
npm install react-native-webrtc

# Cài đặt các thư viện hỗ trợ
npm install axios
npm install react-native-permissions
```

## Cấu trúc thư mục

```
src/
  ├── call/
  │   ├── CallService.ts       # Service xử lý logic gọi điện
  │   ├── CallContext.tsx      # Context quản lý trạng thái cuộc gọi
  │   ├── CallProvider.tsx     # Provider cho CallContext
  │   ├── CallScreen.tsx       # Màn hình cuộc gọi
  │   ├── IncomingCallScreen.tsx # Màn hình cuộc gọi đến
  │   ├── CallControls.tsx     # Component điều khiển cuộc gọi
  │   └── types.ts             # Các type definitions
  └── ...
```

## Cấu hình WebRTC

### 1. Cấu hình quyền truy cập

Thêm các quyền sau vào file `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.INTERNET" />
```

Và trong `ios/YourApp/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>Ứng dụng cần quyền truy cập camera để thực hiện cuộc gọi video</string>
<key>NSMicrophoneUsageDescription</key>
<string>Ứng dụng cần quyền truy cập microphone để thực hiện cuộc gọi</string>
```

### 2. Khởi tạo WebRTC

```typescript
// src/call/CallService.ts
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
} from 'react-native-webrtc';
import { io, Socket } from 'socket.io-client';
import { Device } from 'mediasoup-client';

export class CallService {
  private socket: Socket;
  private device: Device;
  private peerConnection: RTCPeerConnection;
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
  }

  // Khởi tạo kết nối WebRTC
  private async initializeWebRTC() {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        // Thêm các STUN/TURN servers của bạn
      ],
    };

    this.peerConnection = new RTCPeerConnection(configuration);

    // Xử lý ICE candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('ice-candidate', {
          candidate: event.candidate,
        });
      }
    };

    // Xử lý remote stream
    this.peerConnection.ontrack = (event) => {
      this.remoteStream = event.streams[0];
      // Emit event để UI cập nhật
    };
  }
}
```

## Tích hợp với Backend

### 1. Khởi tạo CallService

```typescript
// src/call/CallService.ts
export class CallService {
  // ... các phương thức khác

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
      this.localStream = await mediaDevices.getUserMedia({
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

### 2. Tạo Context và Provider

```typescript
// src/call/CallContext.tsx
import React, { createContext, useContext, useState } from 'react';
import { CallService } from './CallService';

interface CallContextType {
  callService: CallService;
  isInCall: boolean;
  callType: 'AUDIO' | 'VIDEO' | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  startCall: (receiverId: string, type: 'AUDIO' | 'VIDEO') => Promise<void>;
  endCall: () => Promise<void>;
}

const CallContext = createContext<CallContextType | null>(null);

export const CallProvider: React.FC = ({ children }) => {
  const [callService] = useState(() => new CallService());
  const [isInCall, setIsInCall] = useState(false);
  const [callType, setCallType] = useState<'AUDIO' | 'VIDEO' | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const startCall = async (receiverId: string, type: 'AUDIO' | 'VIDEO') => {
    try {
      const call = await callService.initiateCall(receiverId, type);
      setIsInCall(true);
      setCallType(type);
      setLocalStream(callService.localStream);
    } catch (error) {
      console.error('Error starting call:', error);
      throw error;
    }
  };

  const endCall = async () => {
    try {
      await callService.endCall();
      setIsInCall(false);
      setCallType(null);
      setLocalStream(null);
      setRemoteStream(null);
    } catch (error) {
      console.error('Error ending call:', error);
      throw error;
    }
  };

  return (
    <CallContext.Provider
      value={{
        callService,
        isInCall,
        callType,
        localStream,
        remoteStream,
        startCall,
        endCall,
      }}
    >
      {children}
    </CallContext.Provider>
  );
};

export const useCall = () => {
  const context = useContext(CallContext);
  if (!context) {
    throw new Error('useCall must be used within a CallProvider');
  }
  return context;
};
```

### 3. Tạo màn hình cuộc gọi

```typescript
// src/call/CallScreen.tsx
import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { useCall } from './CallContext';
import CallControls from './CallControls';

export const CallScreen: React.FC = () => {
  const {
    isInCall,
    callType,
    localStream,
    remoteStream,
    endCall,
  } = useCall();

  if (!isInCall) {
    return null;
  }

  return (
    <View style={styles.container}>
      {callType === 'VIDEO' && (
        <>
          <RTCView
            streamURL={remoteStream?.toURL()}
            style={styles.remoteVideo}
          />
          <RTCView
            streamURL={localStream?.toURL()}
            style={styles.localVideo}
          />
        </>
      )}
      <CallControls onEndCall={endCall} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  remoteVideo: {
    flex: 1,
  },
  localVideo: {
    position: 'absolute',
    top: 20,
    right: 20,
    width: 100,
    height: 150,
    backgroundColor: '#fff',
  },
});
```

### 4. Tạo component điều khiển cuộc gọi

```typescript
// src/call/CallControls.tsx
import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';

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
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.button, styles.muteButton]}
        onPress={onToggleMute}
      >
        <Icon
          name={isMuted ? 'mic-off' : 'mic'}
          size={24}
          color="#fff"
        />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, styles.endCallButton]}
        onPress={onEndCall}
      >
        <Icon name="call-end" size={24} color="#fff" />
      </TouchableOpacity>

      {onToggleCamera && (
        <TouchableOpacity
          style={[styles.button, styles.cameraButton]}
          onPress={onToggleCamera}
        >
          <Icon
            name={isCameraOff ? 'videocam-off' : 'videocam'}
            size={24}
            color="#fff"
          />
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 30,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  button: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 10,
  },
  muteButton: {
    backgroundColor: '#666',
  },
  endCallButton: {
    backgroundColor: '#f44336',
  },
  cameraButton: {
    backgroundColor: '#666',
  },
});
```

## Luồng hoạt động chi tiết

### 1. Khởi tạo cuộc gọi

#### Frontend (React Native)

1. Người dùng nhấn nút gọi:
```typescript
const handleCall = async () => {
  try {
    await startCall(receiverId, 'VIDEO');
    // Chuyển đến màn hình cuộc gọi
    navigation.navigate('Call');
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
socket.on('call:incoming', (data) => {
  // Hiển thị màn hình cuộc gọi đến
  navigation.navigate('IncomingCall', data);
});
```

2. Hiển thị màn hình cuộc gọi đến:
```typescript
// src/call/IncomingCallScreen.tsx
export const IncomingCallScreen: React.FC = () => {
  const { callId, initiatorId, type } = route.params;
  const { acceptCall, rejectCall } = useCall();

  return (
    <View style={styles.container}>
      <Text>Cuộc gọi đến từ {initiatorId}</Text>
      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.button, styles.acceptButton]}
          onPress={() => acceptCall(callId)}
        >
          <Icon name="call" size={24} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.rejectButton]}
          onPress={() => rejectCall(callId)}
        >
          <Icon name="call-end" size={24} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
};
```

### 2. Chấp nhận cuộc gọi

#### Frontend (Người nhận)

1. Người dùng nhấn nút chấp nhận:
```typescript
const handleAccept = async () => {
  try {
    await acceptCall(callId);
    // Chuyển đến màn hình cuộc gọi
    navigation.navigate('Call');
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
    await endCall();
    // Quay lại màn hình trước đó
    navigation.goBack();
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
    Alert.alert(
      'Mất kết nối',
      'Đang thử kết nối lại...',
      [{ text: 'OK' }]
    );
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
    const newStream = await mediaDevices.getUserMedia({
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

Tài liệu này đã hướng dẫn chi tiết cách tích hợp chức năng gọi điện và video call với React Native, sử dụng module `@call` từ backend. Để triển khai thành công, hãy đảm bảo:

1. Cấu hình đúng các quyền truy cập camera và microphone
2. Xử lý các trường hợp đặc biệt như mất kết nối
3. Tối ưu hiệu suất bằng cách điều chỉnh chất lượng video
4. Xử lý các sự kiện WebSocket một cách đúng đắn
5. Quản lý trạng thái cuộc gọi thông qua Context API

Tham khảo thêm tài liệu chính thức của mediasoup và WebRTC để xử lý các trường hợp đặc biệt và tối ưu hiệu suất. 