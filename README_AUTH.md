# Authentication & Cookie System Documentation

## Overview
Hệ thống authentication và cookie management đã được triển khai toàn bộ cho dự án CO3094-asynaprous. Hệ thống này bao gồm:

1. **Session Management** (`db/sessions.txt`)
2. **Request Authentication** (`daemon/request.py`)
3. **Response Authorization** (`daemon/response.py`)
4. **Frontend Login** (`static/js/login.js`)

---

## 1. Session Database (`db/sessions.txt`)

### Format
```
username|password_hash|session_id|expiration_time|created_time|is_active
```

### Fields
- **username**: Tên đăng nhập
- **password_hash**: SHA256 hash của mật khẩu (không lưu mật khẩu gốc)
- **session_id**: UUID của session hiện tại
- **expiration_time**: Unix timestamp khi session hết hạn
- **created_time**: Unix timestamp khi session được tạo
- **is_active**: 1 = session hoạt động, 0 = session bị thu hồi

### Demo Accounts
```
admin    | password: 123456 | SHA256: 8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918
user     | password: password | SHA256: 5e884898da28047151d0e56f8dc62927751991b86eae41c4a8edd7f3fda60939
guest    | password: guest | SHA256: e4d909c290d0fb1ca068ffaddf22cbd0da2a97667d1d60f42c28c937c2165ea0
```

### Tính SHA256 Hash
```bash
# Trong Python:
import hashlib
hashlib.sha256(b'password_here').hexdigest()
```

---

## 2. Request Authentication (`daemon/request.py`)

### Các hàm chính

#### `load_users_db()`
Đọc file `db/sessions.txt` và trả về dictionary chứa thông tin user.

#### `hash_password(password)`
Mã hóa mật khẩu dùng SHA256.

#### `verify_password(username, password)`
Xác minh username và password với database. Trả về `True` nếu đúng, `False` nếu sai.

#### `generate_session_id(username)`
- Tạo UUID mới cho session
- Lưu vào database
- Set thời gian hết hạn = hiện tại + 3600 giây (1 tiếng)
- Trả về `(session_id, expiration_time)`

#### `validate_session_cookie(cookie_value)`
Kiểm tra cookie có hợp lệ không. Trả về `(is_valid, username, expiration)`.
- Cookie format: `sessionid=<uuid>`
- Kiểm tra xem session có tồn tại, hoạt động, và chưa hết hạn không

#### `prepare_cookies()`
Gọi từ hàm `prepare()`. Xử lý:
1. Nếu có Authorization header (Basic auth): verify username/password, tạo session mới
2. Nếu có Cookie header: validate session
3. Trả về cookie value hoặc None

---

## 3. Response Authorization (`daemon/response.py`)

### Các hàm chính

#### `validate_session_cookie(cookie_value)`
- Kiểm tra cookie format
- Đọc database để xác minh session
- Trả về `(is_valid, username, expiration)`

#### `check_authentication(request)`
Xác định nếu request được phép:
- Trả về `(is_authenticated, should_redirect)`
- Public paths (không cần auth):
  - `/login.html`
  - `/css/login.css`
  - `/js/login.js`
  - `/images/*`

#### `build_response(request, envelop_content=None)`
Sửa đổi:
- Kiểm tra authentication trước khi phục vụ tài nguyên
- Nếu cookie không hợp lệ → redirect (302) đến `/login.html`
- Nếu hợp lệ → phục vụ tài nguyên bình thường
- Nếu session vừa tạo → thêm `Set-Cookie` header

---

## 4. Frontend Login (`static/js/login.js`)

### Các hàm mới

#### `encodeBasicAuth(username, password)`
Mã hóa `username:password` thành Base64.
```javascript
const basicAuth = encodeBasicAuth('admin', '123456');
// Result: "YWRtaW46MTIzNDU2"
```

#### Form Submission Flow
1. **Input Validation**: Kiểm tra username & password không trống
2. **Encoding**: Mã hóa `username:password` → Base64
3. **Send Request**:
   ```javascript
   fetch('/index.html', {
       method: 'GET',
       headers: {
           'Authorization': 'Basic YWRtaW46MTIzNDU2',
           'Content-Type': 'application/json'
       },
       credentials: 'include'  // Include cookies
   })
   ```
4. **Handle Response**:
   - Status 302 → Redirect detected → Authentication failed
   - Status 200 → Success → Show animation → Redirect to `/index.html`
5. **Set-Cookie**: Trình duyệt tự động xử lý cookie từ response

#### Error Handling
- Hiển thị thông báo lỗi
- Shake animation
- Mascot looks sad

#### Success Handling
- Mascot jumps
- Show success overlay
- Auto-redirect to `/index.html`

---

## 5. Authentication Flow

### Login Flow
```
User nhập credentials
    ↓
Client mã hóa: Base64(username:password)
    ↓
Client gửi: GET /index.html + Authorization: Basic <base64>
    ↓
Server xác minh username:password
    ↓
Password đúng?
    ├─ YES → Tạo session, gửi Set-Cookie
    │        Response: 200 OK + Set-Cookie: sessionid=<uuid>
    │        Client nhận → Lưu cookie
    └─ NO  → Gửi redirect
             Response: 302 Found + Location: /login.html
             Client nhận → Hiển thị error
```

### Subsequent Requests Flow
```
User truy cập tài nguyên (VD: /index.html)
    ↓
Browser tự động gửi: Cookie: sessionid=<uuid>
    ↓
Server kiểm tra session:
    ├─ Valid & not expired → Phục vụ tài nguyên (200)
    └─ Invalid/expired → Redirect (302) → /login.html
```

---

## 6. Public vs Protected Resources

### Public (Không cần auth)
- `/login.html` - Trang đăng nhập
- `/css/login.css` - CSS cho login
- `/js/login.js` - JavaScript cho login
- `/images/*` - Hình ảnh
- `/` - Root (redirect đến login.html)

### Protected (Cần auth)
- `/index.html` - Trang chính
- `/` - Tất cả các tài nguyên khác

---

## 7. Security Notes

### Current Implementation
✅ Hash password using SHA256 (không lưu mật khẩu gốc)
✅ Session ID using UUID (không predictable)
✅ Set-Cookie: HttpOnly flag (không access qua JavaScript)
✅ Session expiration (1 hour)

### Future Improvements
- [ ] HTTPS/TLS (hiện tại là HTTP)
- [ ] CSRF protection
- [ ] Rate limiting (brute force protection)
- [ ] Log authentication attempts
- [ ] Add refresh token mechanism
- [ ] Database encryption

---

## 8. Testing

### Test Case 1: Correct Credentials
```
1. Truy cập http://localhost:port/
2. Nhập: username=admin, password=123456
3. Kỳ vọng: Redirect to /index.html, cookie saved
```

### Test Case 2: Wrong Password
```
1. Truy cập http://localhost:port/
2. Nhập: username=admin, password=wrong
3. Kỳ vọng: Error message, shake animation
```

### Test Case 3: Invalid Username
```
1. Truy cập http://localhost:port/
2. Nhập: username=invalid, password=123456
3. Kỳ vọng: Error message, shake animation
```

### Test Case 4: Session Expiration
```
1. Login thành công, cookie saved
2. Wait > 1 hour
3. Truy cập protected resource
4. Kỳ vọng: Redirect to login (session expired)
```

### Test Case 5: Cookie Tampering
```
1. Login thành công
2. Browser DevTools → Modify cookie value
3. Refresh /index.html
4. Kỳ vọng: Redirect to login (invalid cookie)
```

---

## 9. Troubleshooting

### Issue: Session not saved
- Kiểm tra file `db/sessions.txt` có writable
- Kiểm tra đường dẫn file trong `load_users_db()`

### Issue: Login always fails
- Kiểm tra SHA256 hash có đúng không
- Kiểm tra base64 encoding có chính xác không
- Xem console log để debug

### Issue: Cookie not sent
- Kiểm tra `credentials: 'include'` trong fetch
- Kiểm tra cookie domain/path settings

### Issue: Redirect loop
- Kiểm tra `/login.html` là public path
- Kiểm tra session creation logic

---

## 10. Files Modified/Created

✅ Created: `db/sessions.txt` - Session database
✅ Modified: `daemon/request.py` - Authentication logic
✅ Modified: `daemon/response.py` - Authorization logic
✅ Modified: `static/js/login.js` - Frontend login form
✅ Created: `README_AUTH.md` - This file

---

## Quick Reference

### Login with curl
```bash
# Base64 encode: admin:123456 = YWRtaW46MTIzNDU2
curl -i -H "Authorization: Basic YWRtaW46MTIzNDU2" http://localhost:8000/index.html

# Or using -u option
curl -i -u admin:123456 http://localhost:8000/index.html
```

### Generate SHA256 hash
```python
import hashlib
password = "123456"
hash_value = hashlib.sha256(password.encode()).hexdigest()
print(hash_value)  # 8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918
```

### Base64 encode/decode
```python
import base64

# Encode
credentials = "admin:123456"
encoded = base64.b64encode(credentials.encode()).decode()
print(encoded)  # YWRtaW46MTIzNDU2

# Decode
decoded = base64.b64decode(encoded).decode()
print(decoded)  # admin:123456
```
