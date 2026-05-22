# Online Status Integration - Server + WebRTC

## 📋 Tóm tắt

UI danh sách online hiện tại **kết hợp cả hai nguồn**:
- ✅ **Server online list** - users reported online by server heartbeat
- ✅ **WebRTC connections** - users with active peer-to-peer connections

**Một user được hiển thị "online" nếu**:
```
User is Online IF: (Server says online) OR (Has active WebRTC connection)
```

---

## 🔄 Online Status Logic

### Data Sources

```
┌─────────────────────────────────────────────┐
│  updateOnlineUsers() - runs every 1 second  │
├─────────────────────────────────────────────┤
│                                             │
│  1. Get from Server                        │
│     └─ GET /online                         │
│        └─ data.online_users = [...]        │
│                                             │
│  2. Get from WebRTC                        │
│     └─ Check webrtcChannels[user].isConnected
│        └─ All connected peers              │
│                                             │
│  3. Merge & Deduplicate                    │
│     └─ effectiveOnlineMap                  │
│                                             │
│  4. Render to UI                           │
│     └─ Update sidebar with merged list     │
│                                             │
└─────────────────────────────────────────────┘
```

### Implementation

```javascript
// Step 1: Get server online list
const serverOnlineUsers = data.online_users || [];

// Step 2: Add to set (deduplicate)
serverOnlineUsers.forEach(user => {
    effectiveOnlineMap[user.username] = user;
});

// Step 3: Add WebRTC-connected peers
for (const [username, channel] of Object.entries(webrtcChannels)) {
    if (channel.isConnected && username !== currentUsername) {
        if (!effectiveOnlineSet.has(username)) {
            // User offline on server but has WebRTC → show as online
            effectiveOnlineMap[username] = { username };
        }
    }
}

// Step 4: Render
const effectiveOnlineUsers = Object.values(effectiveOnlineMap);
// → Render to UI
```

---

## 🎯 Scenarios

### Scenario 1: Normal Online (Server Only)
```
Server says: user1 is online ✓
WebRTC: no connection to user1
─────────────────────────────────
Result: user1 shown as "Đang hoạt động"
```

### Scenario 2: WebRTC Connected (Server Offline)
```
Server says: user2 is offline ✗
WebRTC: isConnected=true ✓
─────────────────────────────────
Result: user2 shown as "Kết nối P2P"
Why: Network is unreliable, WebRTC says we have active connection
```

### Scenario 3: Both Online (Server + WebRTC)
```
Server says: user3 is online ✓
WebRTC: isConnected=true ✓
─────────────────────────────────
Result: user3 shown with WebRTC status "Kết nối P2P"
```

### Scenario 4: Actually Offline
```
Server says: user4 is offline ✗
WebRTC: no connection ✗
─────────────────────────────────
Result: user4 NOT shown in online list
```

---

## 📊 Status Display in UI

When rendering each user in sidebar:

```
┌─ User Avatar ─┐
│      A        │  ← First letter of username
├───────────────┤
│ Alice         │  ← Username (escaped for XSS)
│ Kết nối P2P   │  ← Status badge
│ 🟢 (dot)      │  ← Online indicator
└───────────────┘
```

**Status text logic:**
```javascript
const hasWebRTC = webrtcChannels[user.username]?.isConnected;
const statusText = hasWebRTC ? 'Kết nối P2P' : 'Đang hoạt động';
```

**Status meanings:**
- `"Đang hoạt động"` = User online on server (normal heartbeat)
- `"Kết nối P2P"` = User has active WebRTC connection (P2P direct link)

---

## 🔐 Resilience Benefits

### Problem
- Server heartbeat might be delayed or network unreliable
- User appears offline even though we have active P2P connection

### Solution
- Keep showing user as online if WebRTC still has data channel open
- WebRTC connection = direct proof of network link

### Flow
```
Network unreliable:
  Server list update delayed ➜ Server says offline ✗
  WebRTC connection alive ➜ We still can communicate ✓
  ──────────────────────────────────────────────
  Result: Show as online (WebRTC is source of truth)
```

---

## 🔄 Update Frequency

```
updateOnlineUsers()
│
├─ Runs: setInterval(..., 1000)
│  └─ Every 1 second from loadCurrentUser()
│
├─ Checks:
│  ├─ GET /online (server heartbeat list)
│  └─ webrtcChannels (local peer connections)
│
└─ Updates UI:
   ├─ Sidebar header count
   ├─ Room type text
   └─ Online user list rendering
```

---

## 🛡️ XSS Prevention

User rendering includes proper escaping:

```javascript
// Username escaped to prevent XSS injection
${escapeHtml(user.username)}

// Avatar uses first character (uppercase)
${user.username.charAt(0).toUpperCase()}
```

---

## 📈 Future Improvements

Possible enhancements:

1. **Confidence scoring**
   ```
   online_confidence = (isServerOnline * 0.7) + (isWebRTCConnected * 0.3)
   ```

2. **Last seen timestamp**
   ```
   Show: "user1 • Last seen 2 minutes ago"
   ```

3. **Connection quality indicator**
   ```
   🟢 Direct P2P | 🟡 Server relay | ⚪ Offline
   ```

4. **Typing indicators**
   ```
   Send via WebRTC data channel when user starts typing
   ```

---

## ✅ Verification Checklist

- [x] Server online list fetched via GET /online
- [x] WebRTC connections tracked in webrtcChannels
- [x] Merge logic: (server OR webrtc)
- [x] Status text reflects connection type
- [x] UI updates every 1 second
- [x] XSS prevention with escapeHtml()
- [x] Duplicate users removed (Set + Map)
- [x] Current user filtered out
