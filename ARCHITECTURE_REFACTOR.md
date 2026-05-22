# Client-Server Architecture - Refactored

## 📋 Tóm tắt

Kiến trúc đã được refactor để **tách biệt hoàn toàn Data Layer và Render Layer**:

1. ✅ **UI render phụ thuộc hoàn toàn vào `channelCache`** - luồng độc lập
2. ✅ **Data update không render trực tiếp** - chỉ cập nhật `channelCache`

---

## 🏗️ Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    INDEPENDENT DATA LAYER                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  sendMessage()              pollNewMessages()  loadMessages()  │
│       ↓                            ↓                  ↓         │
│   Update peerChannels ────────────→ Sync with Server          │
│       ↓                            ↓                  ↓         │
│   Update channelCache ─────────────────────────────→ [notify]  │
│       (NO RENDER HERE)                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                             ↓
        Data changes detected by Render Loop
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                 INDEPENDENT RENDER LOOP (500ms)                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  renderCurrentChannel()                                        │
│       ↓                                                        │
│  Detect: channelKey changed OR messageCount changed           │
│       ↓                                                        │
│  renderChannelFromMessages() → appendChild() → UI              │
│       ↓                                                        │
│  Update tracking: lastRenderedChannelKey, lastRenderedCount  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Key Components

### 1. **Data Update Functions** (NO RENDER CALLS)
```javascript
async function sendMessage()        // Add local message → sync with server
async function pollNewMessages()    // Sync server data into channelCache
async function loadMessages()       // Load channel from server
```
- ✅ Update `channelCache` only
- ✅ Update `peerChannels` for offline state
- ❌ NO `renderChannelFromMessages()` calls
- ❌ NO direct DOM manipulation

### 2. **Independent Render Loop**
```javascript
function renderCurrentChannel()    // Detect changes and render
function startRenderLoop()         // Runs every 500ms
function stopRenderLoop()          // Cleanup on logout
```

**How it works:**
- Runs every 500ms
- Compares `currentChannelKey` and message count with previous state
- Only calls `renderChannelFromMessages()` if data changed
- Updates tracking variables (`lastRenderedChannelKey`, `lastRenderedMessageCount`)

### 3. **Channel State Tracking**
```javascript
let lastRenderedChannelKey = null;           // Track last rendered channel
let lastRenderedMessageCount = {};           // Track message count per channel
let displayedMessageIds = {};                // Track which messages were rendered
```

---

## 📝 Data Structure

### channelCache
```javascript
channelCache = {
  'general': [
    { id, message_hash, timestamp, from_user, to_user, message, type },
    // ...
  ],
  'user1_user2': [
    // private chat messages
  ]
}
```
- **Single source of truth** for messages to display
- Updated by: `sendMessage()`, `pollNewMessages()`, `loadMessages()`
- Used by: `renderCurrentChannel()` → `renderChannelFromMessages()`

### peerChannels
```javascript
peerChannels = {
  'general': {
    key: 'general',
    type: 'group',
    members: [...],
    messages: [...],          // local cache for offline
    created_at: unix_ts,
    last_activity: unix_ts,
    message_count: number
  }
}
```
- Local-first storage for offline support
- Synced with `channelCache` on update

---

## 🔀 Lifecycle Examples

### Example 1: Sending a Message

```
User types message and presses Enter
    ↓
sendMessage()
    ├─ Create message object
    ├─ peerAddMessage(channel, msg)       [update local storage]
    ├─ channelCache[channel] = [...]      [update render source]
    │  (RENDER LOOP DETECTS CHANGE)
    ├─ POST /message to server
    └─ (Wait for response, update channelCache with server state)
       (RENDER LOOP DETECTS CHANGE)
    
[Meanwhile, independently...]
    
Render Loop (runs every 500ms)
    ├─ Read channelCache[currentChannel]
    ├─ Detect: message count changed (5 → 6)
    ├─ Call renderChannelFromMessages()
    ├─ Update DOM
    └─ Update lastRenderedMessageCount[channel] = 6
```

### Example 2: Receiving Message (via polling)

```
Poll Interval (1000ms) triggers
    ↓
pollNewMessages()
    ├─ GET /messages?channel=general
    ├─ peerSyncFromServer(channel, serverMessages)  [sync peer storage]
    ├─ channelCache[channel] = serverMessages      [update render source]
    └─ (RENDER LOOP DETECTS CHANGE)

[Meanwhile, independently...]

Render Loop (runs every 500ms)
    ├─ Check if messages changed
    ├─ If yes: renderChannelFromMessages()
    └─ Update UI
```

### Example 3: Switching Channel

```
User clicks "private chat with alice"
    ↓
selectPrivateChat(alice)
    ├─ currentChatWith = 'alice'
    ├─ lastRenderedChannelKey = null      [force re-render]
    ├─ loadMessages()
    │   └─ channelCache['admin_alice'] = [...]
    └─ (RENDER LOOP DETECTS CHANNEL CHANGED)

[Meanwhile, independently...]

Render Loop
    ├─ Detect: lastRenderedChannelKey (null) !== currentChannel ('admin_alice')
    ├─ renderChannelFromMessages() → render alice's messages
    └─ Update lastRenderedChannelKey = 'admin_alice'
```

---

## ✅ Verification Checklist

- [x] **`sendMessage()` updates data only** - no `renderChannelFromMessages()` calls
- [x] **`pollNewMessages()` updates data only** - no `renderChannelFromMessages()` calls
- [x] **`loadMessages()` updates data only** - no `renderChannelFromMessages()` calls
- [x] **Render loop independent** - runs on its own interval (500ms)
- [x] **UI depends on `channelCache`** - not on message objects directly
- [x] **One source of truth** - `channelCache` is the only source for display
- [x] **Cleanup on logout** - all loops stopped properly

---

## 📊 Performance Improvements

1. **Debounced Rendering** - no flicker, max 500ms between renders
2. **Efficient Diff Detection** - only re-renders on actual data changes
3. **Decoupled Operations** - faster server communication, independent rendering
4. **No Cascading Renders** - send + receive don't trigger multiple renders

---

## 🔧 Debugging

### Check if render loop is running
```javascript
console.log(renderLoopInterval);  // Should not be null if running
```

### Monitor data updates
- Open DevTools Console
- Look for `[Render Loop] Rendering channel: ...` logs

### Verify channel cache
```javascript
console.log(channelCache);        // Inspect current state
console.log(peerChannels);        // Inspect peer storage
```

### Monitor rendering
```javascript
// Watch for these logs:
// [Chat] Message confirmed by server
// [Render Loop] Rendering channel: general, messages: 5
// [Chat] Poll failed
```
