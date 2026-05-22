# P2P Messaging Architecture - Browser-to-Browser Communication

## 🎯 Overview

Messaging system **completely moved from server to P2P**:
- ❌ **No server storage** - Server no longer stores message content
- ✅ **WebRTC Data Channel** - Messages sent peer-to-peer via data channel
- ✅ **Local Persistence** - Each browser stores its own conversation history
- ✅ **Works Offline** - Functions even if server is down
- ✅ **Deduplication** - Prevents duplicate messages using message hash

---

## 🔄 Message Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    USER A (Browser)                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. sendMessage()                                          │
│     ├─ Create message object                              │
│     ├─ Add to local peerChannels                          │
│     ├─ Update channelCache                               │
│     └─ Send via WebRTC data channel ────┐               │
│                                          │               │
│                          ┌───────────────┼───────────────┐
│                          ▼               ▼               ▼
│                       (Private)      (Group)         (P2P)
│                      rtcSendMessage  broadcast    via WebRTC
│                         (to_user)    (all peers)  data channel
└─────────────────────────────────────────────────────────────┘
                          │
                          │ WebRTC Data Channel
                          │ (JSON message)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    USER B (Browser)                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  2. rtcHandleIncomingMessage()                             │
│     ├─ Parse JSON message                                 │
│     ├─ Deduplicate (check message_hash)                  │
│     ├─ Add to local peerChannels                         │
│     ├─ Update channelCache                              │
│     └─ Render loop detects and displays                │
│                                                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 📨 Message Structure

```javascript
{
  id: "uuid-or-timestamp",
  message_hash: "md5-hash",                    // For deduplication
  timestamp: 1234567890,                      // Unix timestamp
  from_user: "alice",
  to_user: "bob" || "",                       // Empty = group chat
  message: "Hello!",
  type: "private" || "group"
}
```

---

## 🎯 Message Types

### 1. Private Message (1-to-1)
```javascript
if (currentChatWith) {
  // Send only to specific user
  rtcSendMessage(currentChatWith, msgObj);
}
```

- **Recipient**: Only the user in `to_user` field
- **Storage**: Both sides store in same private channel
- **Stored as**: `peerChannels['alice_bob']` (sorted usernames)

### 2. Group Message (Broadcast)
```javascript
else {
  // Broadcast to ALL connected peers
  for (const [username, channel] of Object.entries(webrtcChannels)) {
    if (channel.isConnected) {
      rtcSendMessage(username, msgObj);
    }
  }
}
```

- **Recipients**: All online peers
- **Storage**: `peerChannels['general']`
- **Duplicate handling**: Each peer deduplicates independently

---

## 🔐 Deduplication Logic

### Detection Method
```javascript
function peerAddMessage(channelKey, msgObj) {
  // Check 1: By message_hash (if available)
  if (hashKey = msgObj.message_hash) {
    if (exists) return false;  // DUPLICATE
  }
  
  // Check 2: By id (fallback)
  if (msgObj.id) {
    if (exists) return false;  // DUPLICATE
  }
  
  // Add message
  ch.messages.push(msgObj);
  return true;  // NEW
}
```

### Why It Works
1. **Sender sets** `message_hash = UUID` when creating
2. **Receiver checks** `message_hash` before adding
3. **Multiple receives** of same message → Only stored once
4. **Prevents duplicates** even if message sent multiple times

---

## 🚀 Implementation Details

### 1. Sending (sendMessage)
```javascript
// Create message
const newMsg = {
  id: messageHash,
  message_hash: messageHash,
  timestamp: currentTimestamp,
  from_user: currentUsername,
  to_user: currentChatWith || '',
  message: userInput,
  type: currentChatWith ? 'private' : 'group'
};

// Store locally first
peerAddMessage(channelKey, newMsg);
channelCache[channelKey] = peerGetMessages(channelKey);

// Send P2P
if (currentChatWith) {
  rtcSendMessage(currentChatWith, newMsg);  // Private
} else {
  // Broadcast to all
  for (const [username, channel] of Object.entries(webrtcChannels)) {
    if (channel.isConnected) {
      rtcSendMessage(username, newMsg);
    }
  }
}
```

### 2. Receiving (onmessage handler)
```javascript
dataChannel.onmessage = (event) => {
  try {
    const msgObj = JSON.parse(event.data);
    rtcHandleIncomingMessage(remoteUsername, msgObj);
  } catch (err) {
    console.error('[P2P] Parse error:', err);
  }
};
```

### 3. Processing (rtcHandleIncomingMessage)
```javascript
function rtcHandleIncomingMessage(remoteUsername, msgObj) {
  // Determine channel key
  let channelKey = 'general';
  if (msgObj.type === 'private') {
    const users = sorted([msgObj.from_user, msgObj.to_user]);
    channelKey = `${users[0]}_${users[1]}`;
  }
  
  // Deduplicate
  if (peerAddMessage(channelKey, msgObj) === false) {
    console.log('Duplicate, skipping');
    return;
  }
  
  // Update cache
  channelCache[channelKey] = peerGetMessages(channelKey);
}
```

---

## 📦 Storage Architecture

### peerChannels (Peer Storage)
```javascript
peerChannels = {
  'general': {
    key: 'general',
    type: 'group',
    members: ['alice', 'bob', 'charlie'],
    messages: [
      { id, message_hash, timestamp, from_user, message, ... },
      // ... all group messages
    ],
    created_at: 1234567890,
    last_activity: 1234567890,
    message_count: 42
  },
  
  'alice_bob': {
    key: 'alice_bob',
    type: 'private',
    members: ['alice', 'bob'],
    messages: [
      { ... },
      // ... alice-bob private messages
    ]
  }
}
```

### channelCache (Display Cache)
```javascript
channelCache = {
  'general': [ /* sorted messages for display */ ],
  'alice_bob': [ /* sorted messages for display */ ]
}
```

**Relationship**: 
- `peerChannels[key].messages` = authoritative storage
- `channelCache[key]` = display copy, updated by render loop

---

## 🔌 Server Role (Minimal)

Server **no longer** handles:
- ❌ Storing message content
- ❌ Message delivery
- ❌ Message synchronization

Server **still** handles:
- ✅ User authentication (session cookies)
- ✅ Online status tracking (heartbeat)
- ✅ WebRTC signal relay (offer/answer/candidates)
- ✅ User list (GET /online)

### Server Endpoints Used
```
POST /login          - Authenticate
GET /whoami           - Get current user
POST /heartbeat       - Keep session alive
GET /online           - Get online users list

POST /rtc/signal      - Relay WebRTC signals (SDP, candidates)
GET /rtc/poll         - Get pending WebRTC signals
```

### Removed Endpoints (Not Used Anymore)
```
❌ POST /message      - Client no longer sends messages here
❌ GET /messages      - Client no longer polls messages from server
```

---

## 🛡️ Resilience

### Scenario 1: Server Down While Chatting
```
Before: Chat stops (server unavailable)
After: Chat continues! (peer-to-peer only)

Why: All messages go P2P via WebRTC data channel
     Server only needed for signal relay (already negotiated)
```

### Scenario 2: Network Glitch (One Message Lost)
```
User A sends: msg1, msg2, msg3
Network drops msg2

User B receives: msg1, msg3
msg2 never arrives (P2P doesn't have delivery guarantee)

But: msg1 and msg3 are stored correctly
     User B doesn't see gap (no indication something was lost)
```

### Scenario 3: Same Message Received Twice
```
User A sends msg via WebRTC
msg received by User B ✓

Network hiccup causes retransmit
msg received by User B again

But: message_hash deduplication catches it
     Only stored once ✓
```

---

## 🔄 Polling Disabled

### Before (Server-centric)
```javascript
// Every 1 second:
pollNewMessages()
  ├─ GET /messages from server
  └─ Sync into peerChannels
```

### After (P2P)
```javascript
// pollNewMessages() now does nothing
// Messages arrive automatically via:
//   - dataChannel.onmessage events
//   - Automatically triggers storage update
//   - Render loop detects and displays
```

**Benefit**: 
- 🚀 Lower latency (no polling delay)
- 📉 Less server load
- ⚡ Real-time P2P (as fast as WebRTC)

---

## 📈 Offline Support

### Online Peer
```
User A → sends message → WebRTC → User B (receives immediately)
```

### Offline Peer
```
User A → sends message → WebRTC → User B (offline, unreachable)
         └─ Stored locally ✓

User B comes online later
├─ WebRTC connection re-established
├─ Can receive NEW messages from that point
└─ But doesn't get old messages from when offline
   (No sync mechanism, no server to retrieve from)
```

**Note**: This is P2P limitation - no message queue for offline users.

---

## 🧪 Testing P2P Messaging

### Test 1: Private Message
```
1. User A opens chat, selects User B
2. A types "Hello" → sends
3. B receives message in P2P chat
4. B types "Hi" → sends
5. A receives message in P2P chat
✓ Both sides see conversation
```

### Test 2: Group Broadcast
```
1. User A in general chat, types "Hello everyone"
2. Message broadcast via P2P to B, C, D
3. Each receives in their general channel
✓ All see message
```

### Test 3: Deduplication
```
1. A sends message to B
2. Message arrives, stored (message_count = 1)
3. Resend from A (user clicks send twice)
4. Message arrives again, dedup check catches it
5. Still stored once (message_count = 1)
✓ No duplicates
```

### Test 4: Server Down
```
1. Chat running normally (P2P)
2. Kill server
3. Users can still message each other via WebRTC
4. But new users can't login (auth needed)
✓ Existing peers unaffected
```

---

## ✅ Verification Checklist

- [x] sendMessage() sends via P2P (not POST /message)
- [x] rtcHandleIncomingMessage() processes received messages
- [x] Deduplication by message_hash
- [x] Private messages go to specific user
- [x] Group messages broadcast to all online peers
- [x] pollNewMessages() disabled (no server polling)
- [x] loadMessages() uses local peerChannels
- [x] Message stored in peerChannels before sending
- [x] Render loop detects and displays from channelCache
- [x] Works offline (if WebRTC already established)
- [x] Server stores only signal relay, not messages

---

## 📝 Message Flow Diagram

```
┌──────────────┐                           ┌──────────────┐
│   User A     │                           │   User B     │
│  (Browser)   │                           │  (Browser)   │
└──────┬───────┘                           └──────┬───────┘
       │                                          │
       │ 1. sendMessage()                         │
       ├─ Create msgObj                          │
       ├─ peerAddMessage()                       │
       ├─ Update channelCache                    │
       │                                          │
       ├─ rtcSendMessage() ─────────────────────→ 2. dataChannel.onmessage()
       │   (JSON via WebRTC)                     ├─ JSON.parse()
       │                                          ├─ rtcHandleIncomingMessage()
       │                                          ├─ peerAddMessage()
       │                                          ├─ Update channelCache
       │                                          │
       │                                          └─ 3. Render loop detects
       │                                             ├─ renderCurrentChannel()
       │                                             └─ Displays message
       │
       └─ 3. Render loop detects
          ├─ renderCurrentChannel()
          └─ Displays message sent
```

---

## 🎯 Summary

**Old Model (Server-centric)**:
- Server stores all messages
- Client polls regularly
- Dependency on server

**New Model (P2P)**:
- Each browser stores local conversations
- Messages sent directly peer-to-peer
- Works without server
- Lower latency
- Real-time via WebRTC
