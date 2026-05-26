# Chức năng Tạo Đoạn Hội Thoại Chung (Group Conversations)

## Tổng quan

Tính năng này cho phép người dùng tạo và quản lý các nhóm hội thoại. Mỗi nhóm có thể có nhiều thành viên, với người tạo nhóm là chủ nhóm (owner).

## Cấu trúc

### Backend (Python)
- **Tệp cơ sở dữ liệu**: `db/groups.txt` - lưu trữ thông tin nhóm
- **Tệp ứng dụng**: `apps/sampleapp.py` - xử lý logic nhóm

### Frontend (HTML/CSS/JavaScript)
- **Giao diện**: `www/index.html` - thêm phần tạo nhóm
- **Kiểu dáng**: `static/css/chat.css` - CSS cho nhóm
- **Logic**: `static/js/chat.js` - xử lý tương tác nhóm

## API Endpoints

### 1. Tạo nhóm mới
**Endpoint**: `POST /group/create`

**Yêu cầu**:
```json
{
    "username": "admin",
    "group_name": "Đội thiết kế",
    "members": ["user1", "user2", "user3"]
}
```

**Phản hồi**:
```json
{
    "success": true,
    "group": {
        "id": "group_abc123_1234567890",
        "name": "Đội thiết kế",
        "owner": "admin",
        "members": ["admin", "user1", "user2", "user3"],
        "created_at": 1234567890,
        "message_count": 0
    }
}
```

### 2. Liệt kê nhóm
**Endpoint**: `GET /group/list`

**Phản hồi**:
```json
{
    "user_groups": [
        {
            "id": "group_abc123_1234567890",
            "name": "Đội thiết kế",
            "owner": "admin",
            "members": ["admin", "user1", "user2"],
            "member_count": 3,
            "created_at": 1234567890
        }
    ],
    "all_groups": [...]
}
```

### 3. Lấy thông tin nhóm
**Endpoint**: `GET /group/info`

**Headers**:
- `X-Group-Id`: ID của nhóm

**Phản hồi**:
```json
{
    "group": {
        "id": "group_abc123_1234567890",
        "name": "Đội thiết kế",
        "owner": "admin",
        "members": ["admin", "user1", "user2"],
        "member_count": 3,
        "created_at": 1234567890
    }
}
```

### 4. Thêm thành viên vào nhóm
**Endpoint**: `POST /group/add-member`

**Yêu cầu**:
```json
{
    "username": "admin",
    "group_id": "group_abc123_1234567890",
    "new_member": "user4"
}
```

**Phản hồi**:
```json
{
    "success": true,
    "group": {...}
}
```

**Lưu ý**: Chỉ chủ nhóm mới có thể thêm thành viên

### 5. Xóa thành viên khỏi nhóm
**Endpoint**: `POST /group/remove-member`

**Yêu cầu**:
```json
{
    "username": "admin",
    "group_id": "group_abc123_1234567890",
    "member": "user2"
}
```

**Phản hồi**:
```json
{
    "success": true,
    "group": {...}
}
```

**Lưu ý**: Chỉ chủ nhóm hoặc chính thành viên đó mới có thể xóa

## Cách sử dụng

### Tạo nhóm

1. Đăng nhập vào ứng dụng
2. Nhấp vào nút **"+"** trong phần "Nhóm hội thoại" ở thanh bên
3. Nhập tên nhóm (ví dụ: "Đội thiết kế", "Dự án A", v.v.)
4. Chọn các thành viên từ danh sách người dùng trực tuyến
5. Nhấp "Tạo nhóm"

### Tham gia nhóm

1. Nhóm sẽ được hiển thị trong danh sách "Nhóm hội thoại" sau khi được tạo
2. Nhấp vào tên nhóm để chuyển sang cuộc trò chuyện của nhóm

### Gửi tin nhắn trong nhóm

1. Chọn nhóm từ danh sách
2. Gõ tin nhắn vào ô "Gõ tin nhắn của bạn..."
3. Nhấp nút gửi hoặc nhấn Enter
4. Tin nhắn sẽ được gửi đến tất cả thành viên của nhóm

### Quản lý thành viên

- Chỉ chủ nhóm mới có thể:
  - Thêm thành viên mới (thông qua API hoặc giao diện mở rộng trong tương lai)
  - Xóa thành viên khỏi nhóm

- Bất kỳ thành viên nào cũng có thể:
  - Rời khỏi nhóm (xóa chính mình)

## Cấu trúc Dữ Liệu

### Tệp `db/groups.txt`

Định dạng:
```
group_id|group_name|owner|members|created_at|is_active
```

Ví dụ:
```
# Group conversations database
# Format: group_id|group_name|owner|members|created_at|is_active
# members format: username1,username2,username3

group_abc123_1234567890|Đội thiết kế|admin|admin,user1,user2|1234567890|1
group_def456_1234567891|Dự án A|user1|user1,admin,user3|1234567891|1
```

### Lưu trữ Tin Nhắn

Tin nhắn từ nhóm được lưu trữ trong `_messages_storage` ở `sampleapp.py`:
- Khóa: `group_id` (ví dụ: `group_abc123_1234567890`)
- Giá trị: Mảng các đối tượng tin nhắn

Mỗi tin nhắn có cấu trúc:
```json
{
    "id": "msg_id",
    "message_hash": "hash_value",
    "timestamp": 1234567890,
    "from_user": "username",
    "to_user": "",  // Trống cho nhóm
    "message": "Nội dung tin nhắn",
    "type": "group"
}
```

## Ưu điểm của Tính năng

1. **Giao diện trực quan** - Dễ dàng tạo và quản lý nhóm
2. **Quản lý thành viên** - Chủ nhóm có toàn quyền kiểm soát
3. **Dễ mở rộng** - Hỗ trợ dễ dàng thêm các tính năng khác
4. **Tương thích với P2P** - Hoạt động với kiến trúc WebRTC
5. **Lưu trữ bền vững** - Thông tin nhóm được lưu trong tệp

## Các Cải tiến Tương Lai

1. **Giao diện quản lý thành viên** - Bố trí giao diện để thêm/xóa thành viên từ UI
2. **Quyền hạn nhóm** - Thêm các cấp độ quyền hạn khác nhau
3. **Hồ sơ nhóm** - Cho phép chỉnh sửa mô tả, ảnh đại diện nhóm
4. **Thông báo nhóm** - Thông báo khi có tin nhắn mới từ nhóm
5. **Lịch sử nhóm** - Lưu trữ lâu dài các tin nhắn trên server

## Khắc phục Sự Cố

### Nhóm không xuất hiện trong danh sách
- Tải lại trang (F5)
- Kiểm tra xem bạn có phải là thành viên của nhóm không
- Kiểm tra tệp `db/groups.txt` để đảm bảo dữ liệu nhóm đã được lưu

### Không thể gửi tin nhắn
- Kiểm tra kết nối mạng
- Đảm bảo bạn đã chọn một nhóm hợp lệ
- Kiểm tra server có đang chạy không

### Lỗi "Unauthorized"
- Đảm bảo bạn đã đăng nhập
- Kiểm tra session cookie có hợp lệ không
- Thử đăng xuất và đăng nhập lại

## Lưu ý Kỹ Thuật

- Tin nhắn nhóm được lưu trữ trong RAM, sẽ mất khi khởi động lại server
- Thông tin nhóm được lưu trữ trong `db/groups.txt` và sẽ tồn tại sau khi khởi động lại
- Hỗ trợ tối đa là 1000+ thành viên trên nhóm (tuỳ thuộc vào tài nguyên máy chủ)
