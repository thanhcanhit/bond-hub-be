# Module Quản Lý Nhóm (Group Management)

Module này cung cấp các chức năng quản lý nhóm trong ứng dụng, bao gồm tạo nhóm, thêm/xóa thành viên, quản lý vai trò, và tham gia nhóm qua link.

## Cấu trúc Module

```
src/group/
├── dto/                  # Data Transfer Objects
│   ├── add-member.dto.ts
│   ├── create-group.dto.ts
│   ├── group-info.dto.ts
│   ├── join-group.dto.ts
│   ├── update-group.dto.ts
│   └── index.ts
├── group.controller.ts   # API Controller
├── group.gateway.ts      # WebSocket Gateway
├── group.module.ts       # Module Definition
├── group.service.ts      # Business Logic
├── group-api-tests.postman_collection.json  # Postman Collection
└── README.md             # Documentation
```

## Mô hình dữ liệu

### Group
```typescript
model Group {
  id        String       @id @default(uuid())
  name      String
  creatorId String
  avatarUrl String?
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt
  members   GroupMember[]
}
```

### GroupMember
```typescript
model GroupMember {
  id        String    @id @default(uuid())
  groupId   String
  userId    String
  role      GroupRole @default(MEMBER)
  addedById String
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  group     Group     @relation(fields: [groupId], references: [id])
  user      User      @relation(fields: [userId], references: [id])
}
```

### GroupRole
```typescript
enum GroupRole {
  LEADER
  CO_LEADER
  MEMBER
}
```

## API Endpoints

| Method | Endpoint | Mô tả | Quyền hạn |
|--------|----------|-------|-----------|
| POST | `/groups` | Tạo nhóm mới (hỗ trợ upload ảnh đại diện) | Đã xác thực |
| GET | `/groups/:id` | Lấy thông tin nhóm | Thành viên nhóm |
| GET | `/groups/:id/info` | Lấy thông tin công khai của nhóm | Không yêu cầu xác thực |
| PATCH | `/groups/:id` | Cập nhật thông tin nhóm | Leader hoặc Co-leader |
| DELETE | `/groups/:id` | Xóa nhóm | Leader |
| GET | `/groups/user` | Lấy danh sách nhóm của người dùng | Đã xác thực |
| POST | `/groups/:groupId/members` | Thêm thành viên vào nhóm | Leader hoặc Co-leader |
| DELETE | `/groups/:groupId/members/:userId` | Xóa thành viên khỏi nhóm | Leader hoặc Co-leader |
| PATCH | `/groups/:groupId/members/:userId/role` | Thay đổi vai trò thành viên | Leader hoặc Co-leader |
| POST | `/groups/:groupId/leave` | Rời khỏi nhóm | Thành viên nhóm (trừ Leader) |
| POST | `/groups/join` | Tham gia nhóm qua link | Đã xác thực |
| PATCH | `/groups/:id/avatar` | Cập nhật ảnh đại diện nhóm | Leader hoặc Co-leader |

## WebSocket Events

### Sự kiện từ server đến client

| Sự kiện | Mô tả | Dữ liệu |
|---------|-------|---------|
| `groupUpdated` | Thông tin nhóm được cập nhật | `{ groupId, data, updatedBy, timestamp }` |
| `memberAdded` | Thành viên mới được thêm vào nhóm | `{ groupId, member, addedBy, timestamp }` |
| `memberRemoved` | Thành viên bị xóa khỏi nhóm | `{ groupId, userId, removedBy, timestamp }` |
| `roleChanged` | Vai trò thành viên được thay đổi | `{ groupId, userId, role, updatedBy, timestamp }` |
| `avatarUpdated` | Ảnh đại diện nhóm được cập nhật | `{ groupId, avatarUrl, updatedBy, timestamp }` |

## Quy tắc phân quyền

### Vai trò trong nhóm

#### Leader
- Người tạo nhóm hoặc người được chuyển quyền
- Có toàn quyền quản lý nhóm
- Không thể rời nhóm (phải chuyển quyền trước)
- Chỉ có thể có một Leader trong nhóm

#### Co-leader
- Được chỉ định bởi Leader
- Có thể thêm/xóa thành viên, cập nhật thông tin nhóm
- Không thể xóa nhóm hoặc xóa Leader
- Có thể rời nhóm

#### Member
- Thành viên thông thường
- Chỉ có thể xem thông tin nhóm và gửi tin nhắn
- Có thể rời nhóm

### Quy tắc chuyển quyền

- Chỉ Leader có thể chuyển quyền Leader cho người khác
- Khi chuyển quyền, Leader cũ trở thành Co-leader
- Không thể có hai Leader cùng lúc

## Tham gia nhóm qua link

### Luồng tham gia nhóm qua link

1. **Tạo và chia sẻ link**:
   - Link có dạng: `https://your-app.com/groups/{groupId}/join`
   - Người dùng có thể chia sẻ link này với người khác

2. **Xem thông tin nhóm**:
   - Người nhận link truy cập và xem thông tin công khai của nhóm
   - Frontend gọi `GET /groups/{groupId}/info` để lấy thông tin

3. **Tham gia nhóm**:
   - Người dùng nhấn nút "Tham gia"
   - Frontend gọi `POST /groups/join` với `groupId`
   - Backend thêm người dùng vào nhóm với vai trò Member
   - Backend thông báo qua WebSocket và phát sự kiện

## Kiểm thử API

Để kiểm thử các API của module Group, bạn có thể sử dụng Postman Collection đã được cung cấp trong file `group-api-tests.postman_collection.json`.

### Thiết lập ban đầu

1. **Import Collection**: Import file `group-api-tests.postman_collection.json` vào Postman
2. **Tạo Environment**: Tạo một environment mới với biến `baseUrl` (ví dụ: http://localhost:3000)

### Thứ tự thực hiện các request

1. **Đăng nhập**: Thực hiện các request đăng nhập để lấy accessToken cho 3 người dùng
   - Login - User 1 (Lê Hoàng Khang)
   - Login - User 2 (Nguyễn Thanh Cảnh)
   - Login - User 3 (Hồ Thị Như Tâm)

2. **Quản lý nhóm**: Thực hiện các request theo thứ tự
   - Create Group: Tạo nhóm mới
   - Get Group Info: Lấy thông tin nhóm
   - Get Public Group Info: Lấy thông tin công khai của nhóm
   - Update Group Info: Cập nhật thông tin nhóm
   - Add Member: Thêm User 2 vào nhóm
   - Add Another Member: Thêm User 3 vào nhóm
   - Update Member Role: Thay đổi vai trò của User 2 thành CO_LEADER
   - Get User Groups: Lấy danh sách nhóm của người dùng
   - Join Group via Link: User 3 tham gia nhóm qua link
   - Remove Member: Xóa User 3 khỏi nhóm
   - Leave Group: User 2 rời khỏi nhóm
   - Delete Group: Xóa nhóm

### Lưu ý

1. Các request đã được thiết lập để tự động lưu các biến cần thiết như `accessToken`, `userId`, `groupId`
2. Mỗi request đều có test script để kiểm tra kết quả
3. Các request đã được sắp xếp theo thứ tự logic để test đầy đủ các tính năng
4. Dữ liệu người dùng được lấy từ file seed.ts

## Tương tác với Module Khác

### Tương tác với Message Module

#### Khi thêm thành viên vào nhóm:
1. GroupService gọi `addMember()`
2. GroupService phát sự kiện `emitGroupMemberAdded()`
3. MessageGateway lắng nghe sự kiện và thêm người dùng vào room WebSocket của nhóm
4. Người dùng bắt đầu nhận tin nhắn nhóm real-time

#### Khi xóa thành viên khỏi nhóm:
1. GroupService gọi `removeMember()`
2. GroupService phát sự kiện `emitGroupMemberRemoved()`
3. MessageGateway lắng nghe sự kiện và xóa người dùng khỏi room WebSocket của nhóm
4. Người dùng không còn nhận tin nhắn nhóm real-time

### Tương tác với Storage Module

#### Khi tạo nhóm với ảnh đại diện:
1. GroupController nhận file upload qua `FileInterceptor('file')`
2. GroupService gọi `create()` với file ảnh được truyền vào
3. GroupService sử dụng StorageService để upload file vào bucket `group-avatars`
4. GroupService lưu trữ URL ảnh đại diện trong database
5. Sau khi tạo nhóm, file ảnh được chuyển từ thư mục tạm sang thư mục chính với ID nhóm

#### Cách gửi dữ liệu form data để tạo nhóm với ảnh đại diện:

```
POST /api/v1/groups
Content-Type: multipart/form-data

- name: "Tên nhóm"
- creatorId: "user-id-123"
- initialMembers: "[{\"userId\":\"user-id-456\",\"addedById\":\"user-id-123\"},{\"userId\":\"user-id-789\",\"addedById\":\"user-id-123\"}]"
- file: [file binary data]
```

**Lưu ý quan trọng**:
- Trường `initialMembers` phải được gửi dưới dạng chuỗi JSON, không phải mảng đối tượng. Backend sẽ tự động chuyển đổi chuỗi JSON này thành mảng đối tượng.
- Nhóm phải có ít nhất 2 thành viên bổ sung (tổng cộng 3 người bao gồm người tạo).
- Trường `file` là tùy chọn, nếu không có file, nhóm sẽ được tạo mà không có ảnh đại diện.

**Xử lý lỗi**:
- Nếu chuỗi JSON không hợp lệ, hệ thống sẽ trả về lỗi "Invalid initialMembers format".
- Nếu không có trường initialMembers, hệ thống sẽ trả về lỗi "initialMembers is required".

#### Khi cập nhật ảnh đại diện nhóm:
1. GroupController nhận file upload qua `FileInterceptor('file')`
2. GroupService gọi `updateGroupAvatar()`
3. GroupService sử dụng StorageService để upload file vào bucket `group-avatars`
4. GroupService cập nhật URL ảnh đại diện trong database
5. GroupService thông báo qua GroupGateway và phát sự kiện

## Kiến trúc Event-Driven

Module Group sử dụng kiến trúc event-driven để giao tiếp với các module khác:

1. **EventService**: Trung tâm phát sự kiện
2. **GroupService**: Xử lý logic nghiệp vụ và phát sự kiện khi có thay đổi
3. **GroupGateway**: Lắng nghe sự kiện và gửi thông báo qua WebSocket

### Luồng xử lý sự kiện

Khi có thay đổi từ backend (ví dụ: cập nhật ảnh đại diện nhóm), luồng xử lý như sau:

1. **Controller** nhận request từ client
2. **Service** xử lý logic nghiệp vụ (cập nhật database)
3. **Service** gọi `GroupGateway.notifyXXX()` để thông báo trực tiếp
4. **Service** gọi `EventService.emitXXX()` để phát sự kiện
5. **Gateway** lắng nghe sự kiện và gửi thông báo qua WebSocket

## Người đóng góp

- Lê Hoàng Khang
- Nguyễn Thanh Cảnh
- Hồ Thị Như Tâm
- Trần Đình Kiên

## Phiên bản

- 1.0.0: Phiên bản ban đầu
- 1.1.0: Thêm tính năng tham gia nhóm qua link
- 1.2.0: Hỗ trợ upload ảnh đại diện khi tạo nhóm
- 1.2.1: Sửa lỗi xử lý form data khi tạo nhóm với ảnh đại diện
- 1.2.2: Cải tiến xử lý form data trong controller để tạo nhóm với ảnh đại diện
