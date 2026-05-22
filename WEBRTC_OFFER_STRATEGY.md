# WebRTC Offer Initiation Strategy - Lexicographic Comparison

## 🎯 Problem

When two peers both go online:
- **Without strategy**: Both try to send offer → Race condition → Glitchy connection
- **Desired**: Only ONE side sends offer, OTHER side waits and responds

---

## ✅ Solution: Lexicographic String Comparison

### Rule
```
IF currentUsername > remoteUsername (alphabetically)
  ├─ You are: INITIATOR
  ├─ Action: Send offer
  └─ Other side will respond

ELSE (currentUsername < remoteUsername)
  ├─ You are: RESPONDER
  ├─ Action: Wait for offer
  └─ Do nothing - let other side initiate
```

### Example

| Scenario | Admin | Bob | Who sends? |
|----------|-------|-----|-----------|
| admin > bob | ✓ | - | **admin** sends offer |
| bob < admin | - | ✓ | **admin** sends offer (bob waits) |
| charlie > alice | ✓ | - | **charlie** sends offer |
| alice < charlie | - | ✓ | **alice** waits (charlie sends) |

---

## 🔄 Implementation

### Location 1: rtcMainLoop() - Regular Discovery

```javascript
// In rtcMainLoop(), for each online user:
for (const user of onlineUsers) {
    if (user.username === currentUsername) continue;
    
    const channel = webrtcChannels[user.username];
    
    // ✅ Only send offer if currentUsername > remoteUsername
    if (!channel.isConnected && !channel.offerSent && 
        currentUsername > user.username) {
        await rtcCreateAndSendOffer(user.username);
    }
}
```

### Location 2: rtcReconnect() - Reconnection After Failure

```javascript
// When reconnecting after disconnect:
rtcInitializeConnection(remoteUsername);

// ✅ Only send offer if currentUsername > remoteUsername
if (currentUsername > remoteUsername) {
    await rtcCreateAndSendOffer(remoteUsername);
    console.log(`[WebRTC] ✓ Offer sent to ${remoteUsername}`);
} else {
    console.log(`[WebRTC] ✓ Waiting for offer from ${remoteUsername}`);
}
```

---

## 🔐 Race Condition Prevention

### Scenario 1: Both Go Online Simultaneously
```
Time    User A (admin)              User B (bob)
────────────────────────────────────────────────
t0      getOnlineUsers() → [bob]   getOnlineUsers() → [admin]
        
t1      Check: admin > bob ✓       Check: bob > admin ✗
        │                          │
        ├─ Send offer              └─ Wait (do nothing)
        │
t2      bob receives offer         admin receives offer
        │                          │
        ├─ Send answer ←────────────┘
        │
t3      Connection established ✓✓
```

**Result**: No race condition ✓

### Scenario 2: One Reconnects After Failure
```
Time    User A (admin)              User B (bob)
────────────────────────────────────────────────
t0      Connection dies ✗          Connection dies ✗
        │                          │
        └─ rtcReconnect() ─────────→ rtcReconnect()
        
t1      Check: admin > bob ✓       Check: bob > admin ✗
        │                          │
        ├─ Send new offer          └─ Wait for offer
        │
t2      bob receives offer         admin receives offer
        │                          │
        ├─ Send answer ←────────────┘
        │
t3      Connection re-established ✓✓
```

**Result**: Consistent reconnection ✓

---

## 📊 Benefits

| Aspect | Benefit |
|--------|---------|
| **Deterministic** | Same pair always has same initiator |
| **No Race Condition** | Only one side sends offer |
| **No Polling** | Responder doesn't ask, just waits for offer |
| **Symmetric** | Works regardless of connection order |
| **Stable** | Reconnects use same initiator |

---

## 🔍 How It Works

### String Comparison in JavaScript

```javascript
"admin" > "bob"        // false (a < b)
"charlie" > "alice"    // true (c > a)
"zebra" > "apple"      // true (z > a)
"alice" > "alice"      // false (equal)
```

**Order**: Alphabetical (lexicographic) - standard Unicode comparison

### Why This Works

1. **Unique mapping**: For any pair of users, comparison always gives same result
2. **Asymmetric**: If A > B, then NOT (A < B)
3. **Deterministic**: Same input = same output
4. **No coordination needed**: Each side computes independently

---

## 🔧 Edge Cases

### Case 1: Same Username?
**Can't happen** - Current user filtered out:
```javascript
if (user.username === currentUsername) continue;
```

### Case 2: New Users Join?
**Handled automatically**:
- Next rtcMainLoop iteration sees them
- Applies same comparison logic
- Either sends offer or waits

### Case 3: User Renamed?
**Not supported** - No rename logic in this app

### Case 4: Offer Already Sent?
**Skipped**:
```javascript
if (!channel.offerSent && currentUsername > user.username) {
    // Only send if not already sent
}
```

---

## ✅ Verification Checklist

- [x] Offer sent only by higher lexicographic username
- [x] Responder waits (does nothing)
- [x] No race condition possible
- [x] Applied in both rtcMainLoop and rtcReconnect
- [x] Deterministic and symmetric
- [x] Current user filtered out
- [x] Already-sent offers skipped

---

## 📈 Flow Chart

```
User A                          User B
│                              │
├─ Go online ─────────────────→ Go online
│                              │
├─ rtcMainLoop()               ├─ rtcMainLoop()
│  │                           │  │
│  ├─ See B online             │  ├─ See A online
│  │                           │  │
│  ├─ Check: A > B ✓           │  ├─ Check: B > A ✗
│  │                           │  │
│  ├─ Send offer ──────────────→  Wait
│  │                           │
│  │                           ├─ Receive offer
│  │                           │
│  │                           ├─ Send answer
│  ←──────────────────────────┤
│                              │
├─ Connection ✓✓✓            ├─ Connection ✓✓✓
```

---

## 🎓 Summary

**Simple rule**: Only initiator sends offer based on username comparison. Responder waits. No communication needed - each side computes independently and arrives at same decision.
