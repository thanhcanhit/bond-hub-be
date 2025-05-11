# HƯỚNG DẪN SỬ DỤNG CHỨC NĂNG GỌI ĐIỆN VÀ VIDEO CALL

## Giới thiệu

Module Call cung cấp chức năng gọi điện và video call cho ứng dụng sử dụng mediasoup để xử lý truyền tải media qua WebRTC. Hướng dẫn này sẽ giúp bạn hiểu rõ về cách hoạt động, cách sử dụng và các khái niệm quan trọng liên quan đến chức năng gọi điện trong hệ thống.

## Tính năng

- Gọi điện 1-1 (audio only)
- Video call 1-1
- Video call nhóm
- Lịch sử cuộc gọi
- Thông báo cuộc gọi thời gian thực
- Khả năng mở rộng với nhiều worker mediasoup

## Các khái niệm cơ bản

### WebRTC

WebRTC (Web Real-Time Communication) là một công nghệ cho phép các ứng dụng web và mobile giao tiếp trực tiếp, theo thời gian thực mà không cần plugin bổ sung. WebRTC hỗ trợ truyền video, âm thanh và dữ liệu ngang hàng (peer-to-peer).

### Mediasoup

Mediasoup là một Selective Forwarding Unit (SFU) cho WebRTC, đóng vai trò trung tâm trong hệ thống gọi điện và video call:

- **SFU (Selective Forwarding Unit)**: Mediasoup hoạt động như một máy chủ trung gian nhận luồng media từ mỗi người tham gia và chuyển tiếp nó đến những người tham gia khác. Khác với MCU (Multipoint Control Unit) truyền thống, SFU không trộn các luồng media mà chỉ chuyển tiếp chúng, giúp giảm tải cho máy chủ và cải thiện chất lượng.

### Mô hình Worker-Router-Transport

Mediasoup sử dụng mô hình phân cấp:

- **Worker**: Quản lý tài nguyên CPU và xử lý media ở cấp thấp nhất. Thường mỗi CPU core sẽ chạy một worker.
- **Router**: Quản lý một phòng gọi điện, chứa các transport và xử lý định tuyến RTP.
- **Transport**: Quản lý kết nối WebRTC giữa client và server.
- **Producer**: Đại diện cho luồng media gửi từ client đến server.
- **Consumer**: Đại diện cho luồng media gửi từ server đến client.

### Các trạng thái cuộc gọi

- **RINGING**: Cuộc gọi đang đổ chuông, chờ người nhận trả lời.
- **ONGOING**: Cuộc gọi đang diễn ra.
- **ENDED**: Cuộc gọi đã kết thúc bình thường.
- **MISSED**: Cuộc gọi nhỡ (người nhận không trả lời).
- **REJECTED**: Cuộc gọi bị từ chối.

## Kiến trúc hệ thống

### CallService

Xử lý logic nghiệp vụ cho cuộc gọi, bao gồm:
- Tạo cuộc gọi
- Tham gia cuộc gọi
- Kết thúc cuộc gọi
- Từ chối cuộc gọi
- Quản lý trạng thái cuộc gọi
- Lịch sử cuộc gọi

### MediasoupService

Quản lý truyền tải media qua WebRTC sử dụng mediasoup, bao gồm:
- Tạo và quản lý mediasoup workers
- Tạo và quản lý mediasoup routers
- Tạo và quản lý WebRTC transports
- Tạo và quản lý producers và consumers

### CallGateway

Xử lý giao tiếp WebSocket cho tín hiệu cuộc gọi, bao gồm:
- Tín hiệu WebRTC (offer/answer, ICE candidates)
- Thông báo cuộc gọi
- Cập nhật trạng thái cuộc gọi

### CallController

Cung cấp các API REST để quản lý cuộc gọi, bao gồm:
- Tạo cuộc gọi
- Tham gia cuộc gọi
- Kết thúc cuộc gọi
- Từ chối cuộc gọi
- Lấy thông tin cuộc gọi
- Lấy lịch sử cuộc gọi

## Mô hình dữ liệu

### Call

Đại diện cho một phiên gọi với các trường sau:
- `id`: Định danh duy nhất cho cuộc gọi
- `initiatorId`: ID người dùng khởi tạo cuộc gọi
- `groupId`: ID nhóm cho cuộc gọi nhóm (tùy chọn)
- `type`: Loại cuộc gọi (AUDIO hoặc VIDEO)
- `status`: Trạng thái cuộc gọi (RINGING, ONGOING, ENDED, MISSED, REJECTED)
- `startedAt`: Thời điểm cuộc gọi bắt đầu
- `endedAt`: Thời điểm cuộc gọi kết thúc (tùy chọn)
- `duration`: Thời lượng cuộc gọi tính bằng giây (tùy chọn)
- `roomId`: Định danh duy nhất cho phòng mediasoup
- `participants`: Danh sách người tham gia cuộc gọi

### CallParticipant

Đại diện cho một người tham gia trong cuộc gọi với các trường sau:
- `id`: Định danh duy nhất cho người tham gia
- `callId`: ID cuộc gọi
- `userId`: ID người dùng
- `joinedAt`: Thời điểm người tham gia tham gia
- `leftAt`: Thời điểm người tham gia rời đi (tùy chọn)
- `status`: Trạng thái người tham gia (connected, disconnected)

### CallRoom (Trong bộ nhớ)

Đại diện cho một phòng gọi trong bộ nhớ với các thông tin sau:
- `id`: Định danh phòng (roomId)
- `callId`: ID cuộc gọi liên kết
- `participants`: Map các người tham gia trong phòng

### CallRoomParticipant (Trong bộ nhớ)

Đại diện cho người tham gia trong phòng gọi với các thông tin sau:
- `id`: Định danh người tham gia
- `userId`: ID người dùng
- `producerIds`: Danh sách ID của các producer
- `consumerIds`: Danh sách ID của các consumer
- `rtpCapabilities`: Khả năng RTP của người tham gia
- `joined`: Trạng thái đã tham gia đầy đủ hay chưa

## Luồng hoạt động của cuộc gọi

### Cuộc gọi 1-1

#### Bắt đầu cuộc gọi

1. **Người dùng A bắt đầu cuộc gọi với người dùng B**:
   - Frontend của A gọi API `POST /api/v1/calls` với thông tin người nhận (B) và loại cuộc gọi (AUDIO/VIDEO)
   - `CallController` nhận yêu cầu và chuyển nó đến `CallService`

2. **CallService xử lý yêu cầu tạo cuộc gọi**:
   - Tạo bản ghi cuộc gọi mới trong database với trạng thái `RINGING`
   - Tạo một roomId duy nhất cho cuộc gọi
   - Thêm người khởi tạo (A) vào danh sách người tham gia
   - Yêu cầu `MediasoupService` tạo một router mới cho cuộc gọi
   - Phát sự kiện `call.incoming` thông qua `EventService`

3. **EventService phát sự kiện**:
   - `CallGateway` lắng nghe sự kiện `call.incoming`
   - Gửi thông báo cuộc gọi đến người nhận (B) thông qua WebSocket

4. **Người dùng B nhận thông báo cuộc gọi**:
   - Frontend của B hiển thị thông báo cuộc gọi đến
   - B có thể chọn chấp nhận hoặc từ chối cuộc gọi

#### Chấp nhận cuộc gọi

5. **Người dùng B chấp nhận cuộc gọi**:
   - Frontend của B gọi API `POST /api/v1/calls/join`
   - `CallController` nhận yêu cầu và chuyển nó đến `CallService`

6. **CallService xử lý yêu cầu tham gia cuộc gọi**:
   - Cập nhật trạng thái cuộc gọi thành `ONGOING`
   - Thêm B vào danh sách người tham gia
   - Phát sự kiện `call.participant.joined`

7. **Thiết lập kết nối WebRTC**:
   - Cả A và B kết nối đến `CallGateway` thông qua WebSocket
   - Mỗi client gửi sự kiện `joinRoom` để tham gia phòng gọi
   - `CallGateway` yêu cầu `MediasoupService` cung cấp RTP capabilities của router
   - Mỗi client tạo transport gửi và nhận thông qua sự kiện `createWebRtcTransport`
   - Mỗi client kết nối transport thông qua sự kiện `connectWebRtcTransport`
   - Mỗi client tạo producer cho audio/video thông qua sự kiện `produce`
   - Mỗi client tạo consumer cho producer của đối phương thông qua sự kiện `consume`

8. **Truyền tải media**:
   - A gửi luồng audio/video đến mediasoup thông qua producer
   - Mediasoup chuyển tiếp luồng này đến B thông qua consumer
   - B gửi luồng audio/video đến mediasoup thông qua producer
   - Mediasoup chuyển tiếp luồng này đến A thông qua consumer
   - Cả A và B có thể nhìn và nghe nhau

#### Kết thúc cuộc gọi

9. **Một trong hai người dùng kết thúc cuộc gọi**:
   - Frontend gọi API `POST /api/v1/calls/end`
   - `CallService` cập nhật trạng thái cuộc gọi thành `ENDED`
   - Tính toán thời lượng cuộc gọi
   - Đóng router và các kết nối liên quan
   - Phát sự kiện `call.ended`
   - `CallGateway` thông báo cho tất cả người tham gia về việc cuộc gọi kết thúc

### Cuộc gọi nhóm

Cuộc gọi nhóm hoạt động tương tự như cuộc gọi 1-1, với một số khác biệt:

1. **Khởi tạo cuộc gọi**:
   - Người dùng cung cấp `groupId` thay vì `receiverId`
   - `CallService` gửi thông báo đến tất cả thành viên nhóm

2. **Cơ chế truyền tải media**:
   - Khi có nhiều người tham gia, mỗi người tham gia sẽ tạo producer cho audio/video của họ
   - Mediasoup tạo consumer cho mỗi cặp producer-người tham gia
   - Mỗi người tham gia nhận được luồng media từ tất cả người tham gia khác

3. **Quản lý tài nguyên**:
   - Hệ thống sử dụng nhiều worker mediasoup để phân phối tải
   - Router cho mỗi cuộc gọi được phân bổ cho worker theo cơ chế round-robin

## API REST

Module Call cung cấp các API REST sau:

### Tạo cuộc gọi

```
POST /api/v1/calls
```

Request body:
```json
{
  "initiatorId": "user-id",
  "receiverId": "receiver-id", // Cho cuộc gọi 1-1
  "groupId": "group-id", // Cho cuộc gọi nhóm (chỉ cung cấp một trong hai)
  "type": "AUDIO" // hoặc "VIDEO"
}
```

### Tham gia cuộc gọi

```
POST /api/v1/calls/join
```

Request body:
```json
{
  "callId": "call-id",
  "userId": "user-id"
}
```

### Kết thúc cuộc gọi

```
POST /api/v1/calls/end
```

Request body:
```json
{
  "callId": "call-id",
  "userId": "user-id"
}
```

### Từ chối cuộc gọi

```
POST /api/v1/calls/:callId/reject
```

### Lấy thông tin cuộc gọi

```
GET /api/v1/calls/:callId
```

### Lấy cuộc gọi đang hoạt động

```
GET /api/v1/calls/user/active
```

### Lấy lịch sử cuộc gọi

```
GET /api/v1/calls/user/history
```

## Sự kiện WebSocket

### Client đến Server

- `joinRoom`: Tham gia phòng gọi
- `createWebRtcTransport`: Tạo transport WebRTC
- `connectWebRtcTransport`: Kết nối transport WebRTC
- `produce`: Tạo producer
- `consume`: Tạo consumer
- `resumeConsumer`: Tiếp tục consumer
- `getProducers`: Lấy tất cả producers trong phòng
- `setRtpCapabilities`: Đặt RTP capabilities cho người tham gia
- `finishJoining`: Hoàn thành việc tham gia phòng

### Server đến Client

- `call:incoming`: Thông báo cho người dùng về cuộc gọi đến
- `call:initiated`: Thông báo cho người khởi tạo rằng cuộc gọi đã được khởi tạo
- `call:rejected`: Thông báo cho người khởi tạo rằng cuộc gọi đã bị từ chối
- `call:ended`: Thông báo cho tất cả người tham gia rằng cuộc gọi đã kết thúc
- `call:participant:joined`: Thông báo cho tất cả người tham gia rằng một người tham gia mới đã tham gia
- `call:participant:left`: Thông báo cho tất cả người tham gia rằng một người tham gia đã rời đi
- `newProducer`: Thông báo cho người tham gia về một producer mới
- `participantJoined`: Thông báo cho người tham gia rằng một người tham gia đã tham gia

## Tích hợp với Frontend

### Khởi tạo kết nối Socket.IO

```javascript
// Kết nối đến CallGateway
const socket = io('/call', {
  auth: {
    token: 'jwt-token' // Token xác thực
  },
  transports: ['websocket', 'polling'],
});

// Lắng nghe sự kiện cuộc gọi đến
socket.on('call:incoming', (data) => {
  // Hiển thị UI cuộc gọi đến
  // data: { callId, initiatorId, type, roomId, isGroupCall }
});

// Lắng nghe các sự kiện khác
socket.on('call:rejected', (data) => { /* ... */ });
socket.on('call:ended', (data) => { /* ... */ });
socket.on('call:participant:joined', (data) => { /* ... */ });
socket.on('call:participant:left', (data) => { /* ... */ });
```

### Quy trình xử lý cuộc gọi

```javascript
// Khi người dùng khởi tạo cuộc gọi
async function initiateCall(receiverId, type) {
  // 1. Gọi API tạo cuộc gọi
  const response = await axios.post('/api/v1/calls', {
    initiatorId: currentUserId,
    receiverId,
    type, // 'AUDIO' hoặc 'VIDEO'
  });

  const { callId, roomId } = response.data;

  // 2. Chuẩn bị khởi tạo cuộc gọi WebRTC
  await joinCall(callId, roomId);
}

// Khi người dùng tham gia cuộc gọi
async function joinCall(callId, roomId) {
  // 1. Gọi API tham gia cuộc gọi
  await axios.post('/api/v1/calls/join', {
    callId,
    userId: currentUserId,
  });

  // 2. Tham gia phòng WebRTC
  socket.emit('joinRoom', { roomId });

  // 3. Lấy RTP capabilities
  socket.emit('getRtpCapabilities', { roomId }, async (data) => {
    const { rtpCapabilities } = data;
    
    // 4. Khởi tạo device WebRTC
    await device.load({ routerRtpCapabilities: rtpCapabilities });
    
    // 5. Tạo transport gửi
    socket.emit('createWebRtcTransport', {
      roomId,
      direction: 'send',
    }, async (data) => {
      // Xử lý dữ liệu transport gửi
      // ...
    });
    
    // 6. Tạo transport nhận
    socket.emit('createWebRtcTransport', {
      roomId,
      direction: 'recv',
    }, async (data) => {
      // Xử lý dữ liệu transport nhận
      // ...
    });
  });
}

// Khi người dùng kết thúc cuộc gọi
async function endCall(callId) {
  // Gọi API kết thúc cuộc gọi
  await axios.post('/api/v1/calls/end', {
    callId,
    userId: currentUserId,
  });
  
  // Đóng kết nối WebRTC
  // ...
}
```

## Các vấn đề cần lưu ý

### Bảo mật

- Sử dụng JWT để xác thực kết nối WebSocket
- Kiểm tra quyền truy cập vào cuộc gọi (Chỉ những người được mời mới có thể tham gia)
- Mã hóa kết nối WebRTC với DTLS

### Hiệu năng

- Sử dụng nhiều Worker mediasoup để tận dụng tất cả CPU core
- Mediasoup SFU giúp giảm tải cho server trong các cuộc gọi nhóm
- Theo dõi sử dụng băng thông và điều chỉnh chất lượng dynamically

### Khả năng mở rộng

- Kiến trúc hiện tại hỗ trợ mở rộng theo chiều ngang (horizontal scaling)
- Có thể triển khai nhiều instance mediasoup trên nhiều máy chủ
- Cần cơ chế đồng bộ trạng thái giữa các instance (Redis, RabbitMQ...)

## Kết luận

Module gọi điện và video call cung cấp một giải pháp đầy đủ cho giao tiếp thời gian thực trong ứng dụng. Với kiến trúc dựa trên mediasoup và WebRTC, hệ thống có khả năng xử lý cuộc gọi 1-1 và cuộc gọi nhóm với hiệu suất cao và khả năng mở rộng tốt.

Để triển khai thành công, hãy đảm bảo cả phía backend và frontend đều được cấu hình đúng, và tham khảo thêm tài liệu chính thức của mediasoup và WebRTC để xử lý các trường hợp đặc biệt và tối ưu hiệu suất. 