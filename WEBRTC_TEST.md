# WebRTC Implementation Testing Guide

## Quick Start Testing

### Prerequisites
1. Two different browsers or browser profiles
2. Two user accounts (e.g., 'admin' and 'user')
3. Both users logged in to the chat application

### Test Steps

#### Test 1: Connection Establishment
1. Open Browser A and login as 'admin'
2. Open Browser B and login as 'user'
3. Wait 2-3 seconds
4. **Expected**: Toast notification appears in Browser A saying "Đã kết nối với user"
5. **Expected**: Toast notification appears in Browser B saying "Đã kết nối với admin"
6. **Verify**: Check browser console (F12 → Console tab):
   - Should see `[WebRTC] Received offer from ...` logs
   - Should see `[WebRTC] Connection state with ...: connected`
   - Should see `[WebRTC] **ASYNC** Messages` if handlers are async

#### Test 2: Connection Persistence
1. Complete Test 1
2. Wait 30 seconds without any action
3. **Expected**: No disconnections (check console)
4. **Expected**: See periodic ping messages in console `[WebRTC] Checking connection health`
5. **Verify**: WebRTC channel still shows in console

#### Test 3: Automatic Reconnection
1. Complete Test 1
2. Refresh Browser B (simulates connection loss)
3. Wait 5 seconds
4. **Expected**: Browser A attempts to reconnect
5. **Expected**: See new toast notification "Đã kết nối với user" again
6. **Verify**: Console shows reconnection attempt and new offer sent

#### Test 4: Multiple Users
1. Open Browser A, B, C with users: admin, user, guest
2. After connections establish, you should see:
   - Browser A: 2 notifications (user, guest)
   - Browser B: 2 notifications (admin, guest)
   - Browser C: 2 notifications (admin, user)
3. **Verify**: Each pair has established connection

#### Test 5: Logout Cleanup
1. Complete Test 1
2. Click logout in Browser A
3. **Expected**: No errors in console
4. **Expected**: Browser redirects to login
5. **Verify**: Check that webrtcChannels is cleared

### Browser Console Monitoring

Open console (F12) and filter by "[WebRTC]" to see all WebRTC logs:

```
[WebRTC] Initializing connection with username
[WebRTC] Received offer from username
[WebRTC] Offer sent to username
[WebRTC] Answer sent to username
[WebRTC] Received answer from username
[WebRTC] Connection state with username: connected
[WebRTC] Main loop (interval: 1000ms)
```

### Automatic Channel Status Logging (Every 5 Seconds)

The system automatically logs channel status every 5 seconds showing connection health:

```
[WebRTC] Channel Status: ✓ 2 ↻ 1 ✗ 0 (Total: 3)
┌─────────┬──────────────────┬───────────┬────────────────┬──────────┬───────────┐
│ (index) │      user        │   status  │ timeSincePing  │ offerSent│ answerSent│
├─────────┼──────────────────┼───────────┼────────────────┼──────────┼───────────┤
│    0    │    'admin'       │'✓CONNECTED'│    '234ms'    │   true   │   true    │
│    1    │    'user1'       │'✓CONNECTED'│    '567ms'    │   true   │   true    │
│    2    │    'user2'       │'↻CONNECTING'│   '1234ms'   │   true   │   false   │
└─────────┴──────────────────┴───────────┴────────────────┴──────────┴───────────┘
```

When there are failed connections:

```
[WebRTC] ⚠ Failed Connections:
  - user3: closed (Time since last ping: 5234ms)
  - user4: failed (Time since last ping: 3001ms)
```

**Legend:**
- ✓ CONNECTED: Successfully connected and active
- ↻ CONNECTING/WAITING_ANSWER/WAITING_OFFER: Connection in progress
- ✗ FAILED: Connection failed or disconnected
- timeSincePing: Time since last connection check

### Troubleshooting

#### Connections not establishing
- **Check 1**: Run `rtcDebugLogChannelStatus()` in console to see current state
- **Check 2**: Look for failed channels in console warnings
- **Check 3**: Verify both users can see each other in the online users list
- **Check 4**: Open Network tab (F12 → Network) and verify:
  - `/rtc/poll` returns 200 with signals
  - `/rtc/signal` returns 200
- **Check 5**: Ensure session cookies are set (check Application tab → Cookies)

#### Failed Connections Detected
Look for warnings like:
```
[WebRTC] ⚠ Failed/Disconnected channels detected:
  - user1: state=closed, offerSent=true
  - user2: state=failed, offerSent=false
```

**Solutions:**
- If `offerSent=false`: Channel hasn't started negotiation yet (wait a few seconds)
- If `state=closed`: Connection was closed, will auto-reconnect
- If `state=failed`: ICE failed (check firewall, STUN server availability)

#### Toast notifications not showing
- **Check**: Element `#rtcToastContainer` exists in HTML
- **Check**: CSS styles are loaded (`chat.css` includes `.rtc-toast`)
- **Check**: Verify `currentUsername` is set correctly

#### Errors in console
- **"Unauthorized"**: Session expired or username not properly sent
  - Solution: Logout and login again
- **"Connection failed"**: Network issue or browser firewall
  - Solution: Check browser console for more details
- **"Channel already exists"**: This is normal (happens when reconnecting)

### Performance Notes

- WebRTC polling adds ~100-200ms overhead per request
- ICE gathering typically takes 1-3 seconds
- Connection establishment: 2-5 seconds total
- Memory footprint per connection: ~5-10 MB
- Debug logging overhead: ~1% CPU every 5 seconds

### Data Collected

The implementation collects the following data per user:
- RTCPeerConnection object
- Connection state (new, connecting, connected, disconnected, failed, closed)
- Last ping timestamp
- ICE gathering state
- Whether offer/answer was sent

### Manual Debug Commands (Browser Console)

```javascript
// Main debug function - get comprehensive channel status
rtcDebugLogChannelStatus()
// Logs formatted table and returns: {successCount, failureCount, connectingCount, total, channelStatus}

// List all channels with current state
console.table(Object.entries(webrtcChannels).map(([user, ch]) => ({
    user,
    connected: ch.isConnected,
    state: ch.peerConnection?.connectionState,
    lastPing: new Date(ch.lastPingTime).toLocaleTimeString(),
    offerSent: ch.offerSent,
    answerSent: ch.answerSent
})))

// Get specific connection state
console.log(webrtcChannels['username'].peerConnection.connectionState)

// Find and list failed connections
const failedConns = Object.entries(webrtcChannels)
    .filter(([_, ch]) => 
        ch.peerConnection?.connectionState === 'failed' || 
        ch.peerConnection?.connectionState === 'closed'
    )
    .map(([user, ch]) => ({ 
        user, 
        state: ch.peerConnection.connectionState,
        timeSincePing: Date.now() - ch.lastPingTime + 'ms'
    }))
console.warn('Failed connections:', failedConns)

// Find connecting channels (not yet connected)
const connectingConns = Object.entries(webrtcChannels)
    .filter(([_, ch]) => !ch.isConnected && ch.offerSent)
    .map(([user, ch]) => ({
        user,
        state: ch.peerConnection?.connectionState,
        offerSent: ch.offerSent,
        answerSent: ch.answerSent
    }))
console.log('Connecting:', connectingConns)

// List all local WebRTC stats
const pc = webrtcChannels['username'].peerConnection
pc.getStats().then(stats => {
    stats.forEach(report => {
        if (report.type === 'inbound-rtp' || report.type === 'outbound-rtp') {
            console.log(report)
        }
    })
})
```

## Expected Behavior Summary

| Action | Expected Result |
|--------|-----------------|
| User comes online | Browser detects via online users list |
| User adds to webrtcChannels | Channel created with new RTCPeerConnection |
| Connection established | Toast: "Đã kết nối với {user}" |
| Connected peer is idle | No changes (already connected) |
| Peer goes offline | Channel remains (non-destructive) |
| 3+ seconds no ping | Automatic reconnection attempt |
| User logs out | All channels closed, main loop stopped |

## Files That Support WebRTC

- `static/js/chat.js`: Main WebRTC implementation (~500 lines)
- `apps/sampleapp.py`: Signaling relay (`/rtc/signal`, `/rtc/poll`)
- `static/css/chat.css`: Toast notification styles
- `www/index.html`: Toast container element

---

For more details, see `/memories/session/webrtc_implementation.md`
