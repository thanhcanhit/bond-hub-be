# Module AI (AI Integration)

Module này cung cấp các chức năng tích hợp AI vào ứng dụng, sử dụng Google Gemini API thông qua AI SDK.

## Cấu trúc Module

```
src/ai/
├── dto/                  # Data Transfer Objects
│   └── ai-request.dto.ts
├── ai.controller.ts      # API Controller
├── ai.service.ts         # Business Logic
├── ai.module.ts          # Module Definition
├── index.ts              # Exports
└── README.md             # Documentation
```

## Cấu hình

Module này yêu cầu cấu hình API key của Google AI trong file .env:

```
GOOGLE_AI_API_KEY=your_google_ai_api_key
```

## API Endpoints

### 1. Generate AI Response

- **Endpoint**: `POST /api/v1/ai/generate`
- **Mô tả**: Tạo phản hồi từ mô hình AI dựa trên prompt được cung cấp
- **Request Body**:
  ```json
  {
    "prompt": "Giải thích khái niệm về kiến trúc hướng sự kiện",
    "systemPrompt": "Bạn là một trợ lý hữu ích giải thích các khái niệm kỹ thuật một cách rõ ràng và ngắn gọn.",
    "imageUrls": ["https://example.com/image1.jpg"]
  }
  ```
- **Response**:
  ```json
  {
    "response": "Kiến trúc hướng sự kiện (Event-Driven Architecture - EDA) là một mô hình thiết kế phần mềm..."
  }
  ```

### 2. Generate Streaming AI Response

- **Endpoint**: `POST /api/v1/ai/generate/stream`
- **Mô tả**: Tạo phản hồi dạng stream từ mô hình AI
- **Request Body**: Giống như endpoint `/generate`
- **Response**: Server-Sent Events (SSE) stream

## Tích hợp với các Module khác

Module AI có thể được tích hợp với các module khác trong hệ thống để cung cấp các tính năng thông minh như:

1. **Message Module**: Phân tích nội dung tin nhắn, tạo phản hồi tự động
2. **User Module**: Đề xuất kết bạn, phân tích hành vi người dùng
3. **Group Module**: Đề xuất nhóm, phân tích tương tác nhóm

## Mô hình AI

Module này sử dụng mô hình Gemini 1.5 Pro của Google, hỗ trợ:

- Xử lý ngôn ngữ tự nhiên
- Phân tích hình ảnh (multimodal)
- Tạo nội dung sáng tạo
- Trả lời câu hỏi dựa trên kiến thức

## Bảo mật

- Tất cả các yêu cầu đến API AI đều yêu cầu xác thực JWT
- Các prompt và phản hồi được ghi log cho mục đích giám sát
- Các biện pháp an toàn được áp dụng để ngăn chặn nội dung có hại
