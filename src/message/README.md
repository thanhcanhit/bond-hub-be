# Module Tin Nhắn (Message Module)

Module này cung cấp các chức năng quản lý tin nhắn trong ứng dụng, bao gồm tin nhắn trực tiếp giữa người dùng và tin nhắn nhóm.

## Tính Năng Chính

### Danh Sách Cuộc Trò Chuyện (Conversation List)

Endpoint: `GET /messages/conversations`

Tính năng này trả về danh sách tất cả các cuộc trò chuyện của người dùng, bao gồm:
- Cuộc trò chuyện trực tiếp với người dùng khác
- Cuộc trò chuyện nhóm

**Đặc điểm quan trọng:**
- Danh sách nhóm sẽ được hiển thị ngay cả khi chưa có tin nhắn nào
- Các nhóm chưa có tin nhắn sẽ được sắp xếp theo thời gian tạo nhóm
- Các cuộc trò chuyện có tin nhắn sẽ được sắp xếp theo thời gian tin nhắn mới nhất

### Tin Nhắn Trực Tiếp

- Tạo tin nhắn mới: `POST /messages/user`
- Lấy lịch sử tin nhắn: `GET /messages/user/:userIdB`
- Tìm kiếm tin nhắn: `GET /messages/user/:userIdB/search`

### Tin Nhắn Nhóm

- Tạo tin nhắn nhóm: `POST /messages/group`
- Lấy lịch sử tin nhắn nhóm: `GET /messages/group/:groupId`
- Tìm kiếm tin nhắn trong nhóm: `GET /messages/group/:groupId/search`

### Quản Lý Tin Nhắn

- Thu hồi tin nhắn: `PATCH /messages/recall/:messageId`
- Đánh dấu đã đọc: `PATCH /messages/read/:messageId`
- Đánh dấu chưa đọc: `PATCH /messages/unread/:messageId`
- Xóa tin nhắn (phía người dùng): `DELETE /messages/deleted-self-side/:messageId`

### Phản Ứng Tin Nhắn

- Thêm phản ứng: `POST /messages/reaction`
- Xóa phản ứng: `DELETE /messages/reaction/:messageId`

### Tệp Đính Kèm

- Tải lên tệp đính kèm: `POST /messages/media`

### Chuyển Tiếp Tin Nhắn

- Chuyển tiếp tin nhắn: `POST /messages/forward`

## Cấu Trúc Dữ Liệu

### Conversation Item

```typescript
export class ConversationItemDto {
  id: string;
  type: 'USER' | 'GROUP';
  user?: ConversationUserDto;
  group?: ConversationGroupDto;
  lastMessage?: LastMessageDto;
  unreadCount: number;
  updatedAt: Date;
}
```

### Conversation List Response

```typescript
export class ConversationListResponseDto {
  conversations: ConversationItemDto[];
  totalCount: number;
}
```

## Tương Tác Với Các Module Khác

### Group Module

- Khi một nhóm được tạo, nó sẽ xuất hiện trong danh sách cuộc trò chuyện ngay cả khi chưa có tin nhắn nào
- Khi một người dùng được thêm vào nhóm, họ sẽ thấy nhóm trong danh sách cuộc trò chuyện của mình
- Khi một người dùng rời khỏi nhóm, nhóm sẽ không còn xuất hiện trong danh sách cuộc trò chuyện của họ

### User Module

- Thông tin người dùng (tên, ảnh đại diện) được hiển thị trong danh sách cuộc trò chuyện
- Trạng thái trực tuyến và thời gian hoạt động cuối cùng của người dùng được hiển thị trong danh sách cuộc trò chuyện

## WebSocket Events

Module này sử dụng WebSocket để cung cấp cập nhật thời gian thực cho các tin nhắn và cuộc trò chuyện:

- `newUserMessage`: Khi có tin nhắn mới từ người dùng
- `newGroupMessage`: Khi có tin nhắn mới trong nhóm
- `messageRecalled`: Khi tin nhắn bị thu hồi
- `messageRead`: Khi tin nhắn được đánh dấu đã đọc
- `messageDeleted`: Khi tin nhắn bị xóa
- `messageReactionUpdated`: Khi phản ứng tin nhắn được cập nhật
