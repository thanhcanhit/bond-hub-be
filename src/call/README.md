# Module Gọi Điện và Video Call

Module này cung cấp chức năng gọi điện và video call cho ứng dụng sử dụng mediasoup để xử lý truyền tải media qua WebRTC.

## Tính năng

- Gọi điện 1-1 (audio)
- Video call 1-1
- Video call nhóm
- Lịch sử cuộc gọi
- Thông báo cuộc gọi thời gian thực

## Kiến trúc

Module Call bao gồm các thành phần sau:

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

Module Call sử dụng các mô hình dữ liệu sau:

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

## Sự kiện WebSocket

Module Call sử dụng các sự kiện WebSocket sau:

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

## API REST

Module Call cung cấp các API REST sau:

- `POST /calls`: Tạo cuộc gọi mới
- `POST /calls/join`: Tham gia cuộc gọi
- `POST /calls/end`: Kết thúc cuộc gọi
- `POST /calls/:callId/reject`: Từ chối cuộc gọi
- `GET /calls/:callId`: Lấy thông tin cuộc gọi
- `GET /calls/user/active`: Lấy cuộc gọi đang hoạt động cho người dùng hiện tại
- `GET /calls/user/history`: Lấy lịch sử cuộc gọi cho người dùng hiện tại

## Cách sử dụng

### Tạo cuộc gọi

Để tạo cuộc gọi mới, gửi yêu cầu POST đến `/calls` với nội dung sau:

```json
{
  "initiatorId": "user-id",
  "receiverId": "receiver-id", // Cho cuộc gọi 1-1
  "groupId": "group-id", // Cho cuộc gọi nhóm
  "type": "AUDIO" // hoặc "VIDEO"
}
```

### Tham gia cuộc gọi

Để tham gia cuộc gọi, gửi yêu cầu POST đến `/calls/join` với nội dung sau:

```json
{
  "callId": "call-id",
  "userId": "user-id"
}
```

### Kết thúc cuộc gọi

Để kết thúc cuộc gọi, gửi yêu cầu POST đến `/calls/end` với nội dung sau:

```json
{
  "callId": "call-id",
  "userId": "user-id"
}
```

### Từ chối cuộc gọi

Để từ chối cuộc gọi, gửi yêu cầu POST đến `/calls/:callId/reject`.

### Lấy thông tin cuộc gọi

Để lấy thông tin về cuộc gọi, gửi yêu cầu GET đến `/calls/:callId`.

### Lấy cuộc gọi đang hoạt động

Để lấy cuộc gọi đang hoạt động cho người dùng hiện tại, gửi yêu cầu GET đến `/calls/user/active`.

### Lấy lịch sử cuộc gọi

Để lấy lịch sử cuộc gọi cho người dùng hiện tại, gửi yêu cầu GET đến `/calls/user/history`.

## Cách hoạt động của hệ thống gọi điện và video call

### Vai trò của mediasoup

Mediasoup là một Selective Forwarding Unit (SFU) cho WebRTC, đóng vai trò trung tâm trong hệ thống gọi điện và video call:

- **SFU (Selective Forwarding Unit)**: Mediasoup hoạt động như một máy chủ trung gian nhận luồng media từ mỗi người tham gia và chuyển tiếp nó đến những người tham gia khác. Khác với MCU (Multipoint Control Unit) truyền thống, SFU không trộn các luồng media mà chỉ chuyển tiếp chúng, giúp giảm tải cho máy chủ và cải thiện chất lượng.

- **Mô hình Worker-Router-Transport**: Mediasoup sử dụng mô hình phân cấp:
  - **Worker**: Quản lý tài nguyên CPU và xử lý media ở cấp thấp nhất
  - **Router**: Quản lý một phòng gọi điện, chứa các transport và xử lý định tuyến RTP
  - **Transport**: Quản lý kết nối WebRTC giữa client và server
  - **Producer**: Đại diện cho luồng media gửi từ client đến server
  - **Consumer**: Đại diện cho luồng media gửi từ server đến client

- **Khả năng mở rộng**: Mediasoup cho phép tạo nhiều worker trên nhiều CPU core, giúp hệ thống có thể xử lý nhiều cuộc gọi đồng thời.

### Luồng hoạt động của cuộc gọi 1-1

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

### Luồng hoạt động của cuộc gọi nhóm

Cuộc gọi nhóm hoạt động tương tự như cuộc gọi 1-1, nhưng có một số khác biệt:

#### Bắt đầu cuộc gọi nhóm

1. **Người dùng A bắt đầu cuộc gọi nhóm**:
   - Frontend của A gọi API `POST /api/v1/calls` với thông tin nhóm (groupId) và loại cuộc gọi
   - `CallService` kiểm tra xem A có phải là thành viên của nhóm không
   - Tạo bản ghi cuộc gọi mới với trạng thái `RINGING`
   - Thêm A vào danh sách người tham gia
   - Tạo router cho cuộc gọi
   - Phát sự kiện `call.incoming` cho tất cả thành viên nhóm

2. **Các thành viên nhóm nhận thông báo**:
   - `CallGateway` gửi thông báo đến từng thành viên nhóm
   - Mỗi thành viên có thể chọn tham gia hoặc bỏ qua cuộc gọi

#### Tham gia cuộc gọi nhóm

3. **Các thành viên tham gia cuộc gọi**:
   - Mỗi thành viên gọi API `POST /api/v1/calls/join`
   - `CallService` thêm họ vào danh sách người tham gia
   - Phát sự kiện `call.participant.joined` cho mỗi người tham gia mới

4. **Thiết lập kết nối WebRTC cho nhiều người**:
   - Mỗi người tham gia thiết lập transport gửi và nhận
   - Mỗi người tham gia tạo producer cho audio/video của họ
   - Mỗi người tham gia tạo consumer cho producer của tất cả người tham gia khác
   - Khi một người tham gia mới tham gia, họ tạo consumer cho tất cả producer hiện có
   - Khi một người tham gia mới tạo producer, tất cả người tham gia hiện có tạo consumer cho producer đó

5. **Truyền tải media trong nhóm**:
   - Mỗi người tham gia gửi một luồng audio/video đến mediasoup
   - Mediasoup chuyển tiếp luồng này đến tất cả người tham gia khác
   - Mỗi người tham gia nhận nhiều luồng audio/video từ tất cả người tham gia khác

#### Rời khỏi cuộc gọi nhóm

6. **Một thành viên rời khỏi cuộc gọi**:
   - Frontend gọi API `POST /api/v1/calls/end`
   - `CallService` cập nhật trạng thái người tham gia thành `disconnected`
   - Đóng transport, producer và consumer của người tham gia đó
   - Phát sự kiện `call.participant.left`
   - Cuộc gọi vẫn tiếp tục với các thành viên còn lại

7. **Kết thúc cuộc gọi nhóm**:
   - Khi người khởi tạo kết thúc cuộc gọi hoặc khi không còn người tham gia nào
   - `CallService` cập nhật trạng thái cuộc gọi thành `ENDED`
   - Đóng router và tất cả kết nối liên quan
   - Phát sự kiện `call.ended`

### Sự khác biệt giữa cuộc gọi audio và video

Sự khác biệt chính giữa cuộc gọi audio và video nằm ở loại media được truyền tải:

- **Cuộc gọi audio (AUDIO)**:
  - Chỉ tạo producer và consumer cho luồng audio
  - Sử dụng ít băng thông hơn
  - Phù hợp cho kết nối mạng yếu

- **Cuộc gọi video (VIDEO)**:
  - Tạo producer và consumer cho cả luồng audio và video
  - Sử dụng nhiều băng thông hơn
  - Cung cấp trải nghiệm giao tiếp phong phú hơn

### Tương tác giữa các thành phần

#### CallController và CallService

- `CallController` nhận các yêu cầu HTTP từ client và chuyển chúng đến `CallService`
- `CallService` xử lý logic nghiệp vụ và tương tác với database thông qua `PrismaService`
- `CallService` quản lý trạng thái cuộc gọi và người tham gia trong bộ nhớ

#### CallService và MediasoupService

- `CallService` yêu cầu `MediasoupService` tạo và quản lý router cho mỗi cuộc gọi
- `MediasoupService` quản lý các worker, router, transport, producer và consumer
- `CallService` lưu trữ thông tin về người tham gia và các producer/consumer của họ

#### CallGateway và MediasoupService

- `CallGateway` nhận các sự kiện WebSocket từ client và chuyển chúng đến `MediasoupService`
- `MediasoupService` thực hiện các thao tác WebRTC như tạo transport, producer, consumer
- `CallGateway` gửi thông tin cấu hình WebRTC từ `MediasoupService` về client

#### EventService và các thành phần khác

- `EventService` cung cấp cơ chế giao tiếp giữa các thành phần thông qua sự kiện
- `CallService` phát các sự kiện như `call.incoming`, `call.ended`
- `CallGateway` lắng nghe các sự kiện này và gửi thông báo đến client thông qua WebSocket

### Luồng dữ liệu media trong mediasoup

Mediasoup xử lý luồng dữ liệu media như sau:

1. **Từ client đến server**:
   - Client tạo một `RTCPeerConnection` và thêm luồng media local vào nó
   - Client tạo một transport gửi thông qua sự kiện `createWebRtcTransport`
   - Client kết nối transport thông qua sự kiện `connectWebRtcTransport`
   - Client tạo một producer thông qua sự kiện `produce`
   - Luồng media được gửi từ client đến mediasoup thông qua WebRTC

2. **Xử lý trong server**:
   - Mediasoup nhận luồng media thông qua producer
   - Router định tuyến luồng media đến các consumer tương ứng
   - Không có việc giải mã hoặc mã hóa lại, giúp giảm tải cho CPU

3. **Từ server đến client**:
   - Client tạo một transport nhận thông qua sự kiện `createWebRtcTransport`
   - Client kết nối transport thông qua sự kiện `connectWebRtcTransport`
   - Client tạo một consumer cho mỗi producer thông qua sự kiện `consume`
   - Luồng media được gửi từ mediasoup đến client thông qua WebRTC

## Luồng WebRTC

1. Client tham gia phòng bằng cách gửi sự kiện `joinRoom`
2. Server phản hồi với RTP capabilities của router
3. Client tải mediasoup device với RTP capabilities
4. Client tạo transport gửi và nhận bằng cách gửi sự kiện `createWebRtcTransport`
5. Client kết nối transport bằng cách gửi sự kiện `connectWebRtcTransport`
6. Client tạo producer cho audio và video bằng cách gửi sự kiện `produce`
7. Client lấy producer hiện có trong phòng bằng cách gửi sự kiện `getProducers`
8. Client tạo consumer cho mỗi producer bằng cách gửi sự kiện `consume`
9. Client tiếp tục mỗi consumer bằng cách gửi sự kiện `resumeConsumer`
10. Client hoàn thành việc tham gia bằng cách gửi sự kiện `finishJoining`

## Cấu hình

Cấu hình mediasoup có thể được tùy chỉnh trong lớp `MediasoupService`. Các biến môi trường sau được sử dụng:

- `MEDIASOUP_ANNOUNCED_IP`: Địa chỉ IP công khai của máy chủ (mặc định: 127.0.0.1)

## Phụ thuộc

- mediasoup: WebRTC SFU
- socket.io: Thư viện WebSocket
- uuid: Để tạo ID duy nhất