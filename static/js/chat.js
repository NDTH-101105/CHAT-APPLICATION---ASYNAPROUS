// Get current time in HH:MM format
function getCurrentTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// Resolve channel key: "general" or "user1_user2" (sorted) or "group_xxx"
function resolveChannelKey(chatWith = currentChatWith, username = currentUsername) {
    if (chatWith === null || chatWith === '' || chatWith === 'general') {
        return 'general';
    }
    
    // If it's a group ID (starts with 'group_'), return it as-is
    if (typeof chatWith === 'string' && chatWith.startsWith('group_')) {
        return chatWith;
    }
    
    // Otherwise, it's a private chat between two users
    const users = [username || '', chatWith].sort();
    return `${users[0]}_${users[1]}`;
}

// Normalize messages by timestamp (oldest first)
function normalizeMessages(messages = []) {
    return [...messages].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
}

// Render entire channel from message array (for full refresh like switching channels)
function renderChannelFromMessages(messages = [], forceRerender = false) {
    const messagesArea = document.getElementById('messagesArea');
    const channelKey = resolveChannelKey();
    
    // Check if we need to do full re-render or just incremental update
    const currentDisplayed = displayedMessageIds[channelKey] || new Set();
    const normalizedMessages = normalizeMessages(messages);
    
    // If messages match and not forcing re-render, skip (prevents flicker)
    if (!forceRerender && 
        currentDisplayed.size === normalizedMessages.length && 
        normalizedMessages.every(msg => currentDisplayed.has(msg.id))) {
        return; // Already displayed, no need to re-render
    }
    
    // Clear only when truly needed (channel switch or new message not in display)
    messagesArea.innerHTML = '';
    displayedMessageIds[channelKey] = new Set();
    
    normalizedMessages.forEach(msg => {
        appendMessage(msg.from_user, msg.message, new Date(Number(msg.timestamp) * 1000));
        if (msg.id) {
            displayedMessageIds[channelKey].add(msg.id);
        }
    });
    
    // Auto-scroll to bottom
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

// Append only NEW messages (for polling - no full re-render)
function appendOnlyNewMessages(messages = []) {
    const messagesArea = document.getElementById('messagesArea');
    const channelKey = resolveChannelKey();
    
    if (!displayedMessageIds[channelKey]) {
        displayedMessageIds[channelKey] = new Set();
    }
    
    const scrollWasAtBottom = messagesArea.scrollTop >= messagesArea.scrollHeight - messagesArea.clientHeight - 10;
    
    let hasNewMessage = false;
    normalizeMessages(messages).forEach(msg => {
        if (msg.id && !displayedMessageIds[channelKey].has(msg.id)) {
            hasNewMessage = true;
            appendMessage(msg.from_user, msg.message, new Date(Number(msg.timestamp) * 1000));
            displayedMessageIds[channelKey].add(msg.id);
        }
    });
    
    // Only scroll if there were new messages and we were at bottom
    if (hasNewMessage && scrollWasAtBottom) {
        messagesArea.scrollTop = messagesArea.scrollHeight;
    }
}

// Get current channel snapshot from cache
function getCurrentChannelSnapshot() {
    const channelKey = resolveChannelKey();
    if (!channelCache[channelKey]) {
        channelCache[channelKey] = [];
    }
    return channelCache[channelKey];
}

// Add message to UI
function appendMessage(username, message, timestamp = null) {
    const messagesArea = document.getElementById('messagesArea');
    const messageDiv = document.createElement('div');
    messageDiv.className = username === currentUsername ? 'message own' : 'message';
    const avatarLetter = escapeHtml(username.charAt(0).toUpperCase() || 'U');
    const timeStr = timestamp ? getTimeFromDate(timestamp) : getCurrentTime();

    messageDiv.innerHTML = `
        <div class="message-avatar" style="background: linear-gradient(135deg, #7c5cfc, #5b3ef5);">${avatarLetter}</div>
        <div class="message-content">
            <div class="message-sender-time">
                <span>${escapeHtml(username)}</span>
                <span class="message-time">${timeStr}</span>
            </div>
            <div class="message-text">${escapeHtml(message)}</div>
        </div>
    `;

    messagesArea.appendChild(messageDiv);
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

// Get time from Date object
function getTimeFromDate(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

// Global state
let heartbeatInterval;
let messagePollingInterval;
let renderLoopInterval;
let currentUsername = '';
let currentChatWith = null; // null = general, otherwise username
let channelCache = { general: [] };
let isSending = false; // Prevent duplicate sends
let displayedMessageIds = {}; // Track displayed message IDs per channel
let lastRenderedChannelKey = null; // Track which channel was last rendered
let lastRenderedMessageCount = {}; // Track message count per channel to detect changes

/**
 * Render current channel from channelCache (independent render, not coupled to data updates)
 * This is called by the render loop, not directly from sendMessage/pollNewMessages
 * @param {boolean} forceRerender - force render even if channel appears unchanged (for channel switches)
 */
function renderCurrentChannel(forceRerender = false) {
    const channelKey = resolveChannelKey();
    const messages = channelCache[channelKey] || [];
    
    // Only render if channel changed or message count changed or forced
    if (forceRerender ||
        lastRenderedChannelKey !== channelKey || 
        (lastRenderedMessageCount[channelKey] || 0) !== messages.length) {
        
        console.log(`[Render Loop] Rendering channel: ${channelKey}, messages: ${messages.length}${forceRerender ? ' (forced)' : ''}`);
        renderChannelFromMessages(messages, forceRerender);
        
        lastRenderedChannelKey = channelKey;
        lastRenderedMessageCount[channelKey] = messages.length;
    }
}

// ============ PEER CHANNEL STORAGE ============
// Each browser is a peer. peerChannels mirrors server's _messages_storage
// with full channel metadata for future P2P usage.
//
// Format:
// {
//   'general': {
//       key: 'general',
//       type: 'group',
//       members: ['admin', 'user', 'guest'],
//       messages: [
//           { id, message_hash, timestamp, from_user, to_user, message, type }
//       ],
//       created_at: <unix timestamp>,
//       last_activity: <unix timestamp>,
//       message_count: <number>
//   },
//   'admin_user': {
//       key: 'admin_user',
//       type: 'private',
//       members: ['admin', 'user'],
//       messages: [...],
//       created_at: <unix timestamp>,
//       last_activity: <unix timestamp>,
//       message_count: <number>
//   }
// }
let peerChannels = {};

/**
 * Ensure a channel exists in peerChannels. Creates it if missing.
 * @param {string} channelKey - e.g. 'general' or 'admin_user'
 * @param {string} channelType - 'group' or 'private'
 * @param {string[]} members - array of usernames in this channel
 * @returns {object} the channel object
 */
function peerEnsureChannel(channelKey, channelType = 'group', members = []) {
    if (!peerChannels[channelKey]) {
        const now = Math.floor(Date.now() / 1000);
        peerChannels[channelKey] = {
            key: channelKey,
            type: channelType,
            members: [...members],
            messages: [],
            created_at: now,
            last_activity: now,
            message_count: 0
        };
        console.log('[Peer] Channel created:', channelKey, peerChannels[channelKey]);
    }
    // Merge any new members
    const ch = peerChannels[channelKey];
    members.forEach(m => {
        if (m && !ch.members.includes(m)) {
            ch.members.push(m);
        }
    });
    return ch;
}

/**
 * Add a single message to peerChannels with deduplication.
 * @param {string} channelKey
 * @param {object} msgObj - { id, message_hash, timestamp, from_user, to_user, message, type }
 * @returns {boolean} true if message was newly added, false if duplicate
 */
function peerAddMessage(channelKey, msgObj) {
    const ch = peerEnsureChannel(
        channelKey,
        msgObj.type === 'private' ? 'private' : 'group',
        [msgObj.from_user, msgObj.to_user].filter(Boolean)
    );

    // Dedup by message_hash first, then by id
    const hashKey = (msgObj.message_hash || '').trim();
    if (hashKey) {
        const idx = ch.messages.findIndex(m => (m.message_hash || '').trim() === hashKey);
        if (idx !== -1) {
            ch.messages[idx] = { ...msgObj };  // update existing
            return false;
        }
    }
    if (msgObj.id) {
        const idx = ch.messages.findIndex(m => m.id === msgObj.id);
        if (idx !== -1) {
            ch.messages[idx] = { ...msgObj };
            return false;
        }
    }

    ch.messages.push({ ...msgObj });
    ch.messages.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
    ch.last_activity = Math.max(ch.last_activity, Number(msgObj.timestamp) || 0);
    ch.message_count = ch.messages.length;
    return true;
}

/**
 * Sync an entire channel from server response (array of message objects).
 * Replaces the channel's messages with the server state.
 * @param {string} channelKey
 * @param {object[]} serverMessages - array of message objects from server
 */
function peerSyncFromServer(channelKey, serverMessages = []) {
    // Determine channel type and members from messages
    let channelType = 'group';
    const memberSet = new Set();
    serverMessages.forEach(msg => {
        if (msg.from_user) memberSet.add(msg.from_user);
        if (msg.to_user) memberSet.add(msg.to_user);
        if (msg.type === 'private') channelType = 'private';
    });
    if (channelKey !== 'general') channelType = 'private';

    const ch = peerEnsureChannel(channelKey, channelType, [...memberSet]);

    // Replace messages with server state
    ch.messages = serverMessages.map(msg => ({
        id: msg.id || '',
        message_hash: msg.message_hash || '',
        timestamp: Number(msg.timestamp) || 0,
        from_user: msg.from_user || '',
        to_user: msg.to_user || '',
        message: msg.message || '',
        type: msg.type || channelType
    }));
    ch.messages.sort((a, b) => a.timestamp - b.timestamp);
    ch.message_count = ch.messages.length;
    if (ch.messages.length > 0) {
        ch.last_activity = ch.messages[ch.messages.length - 1].timestamp;
    }

    console.log('[Peer] Channel synced:', channelKey,
        '| msgs:', ch.message_count,
        '| members:', ch.members);
}

/**
 * Get messages for a channel from peer storage.
 * @param {string} channelKey
 * @returns {object[]} sorted messages array
 */
function peerGetMessages(channelKey) {
    if (!peerChannels[channelKey]) return [];
    return [...peerChannels[channelKey].messages];
}

/**
 * Get full channel info from peer storage.
 * @param {string} channelKey
 * @returns {object|null} channel object or null
 */
function peerGetChannel(channelKey) {
    return peerChannels[channelKey] || null;
}

/**
 * List all channels this peer knows about.
 * @returns {object[]} array of channel summary objects
 */
function peerListChannels() {
    return Object.values(peerChannels).map(ch => ({
        key: ch.key,
        type: ch.type,
        members: [...ch.members],
        message_count: ch.message_count,
        last_activity: ch.last_activity,
        created_at: ch.created_at
    }));
}

/**
 * Handle incoming channel sync from WebRTC data channel
 * @param {string} remoteUsername - sender's username
 * @param {object} syncData - { channelKey, channel } with full channel data
 */
function rtcHandleChannelSync(remoteUsername, syncData) {
    if (!syncData || !syncData.channelKey || !syncData.channel) {
        console.warn(`[P2P] Invalid channel sync from ${remoteUsername}:`, syncData);
        return;
    }
    
    const channelKey = syncData.channelKey;
    const remoteChannel = syncData.channel;
    
    // Handle virtual ping channel
    if (channelKey.startsWith('_ping_')) {
        // Update connection health tracking
        const channel = webrtcChannels[remoteUsername];
        if (channel) {
            channel.lastPingTime = Date.now();
            channel.isAlive = true;
            console.log(`[P2P] Heart ping received from ${remoteUsername}`);
        }
        return; // Don't cache ping channels
    }
    
    console.log(`[P2P] Received channel sync from ${remoteUsername}: ${channelKey} (${remoteChannel.messages.length} messages)`);
    
    // Get local channel message count before merge
    const localChannel = peerGetChannel(channelKey);
    const localMessageCountBefore = localChannel ? localChannel.messages.length : 0;
    
    // Merge remote messages into local channel by hash check (avoid overwriting old messages)
    // This ensures deduplication at the message level, not replacing the entire channel
    remoteChannel.messages.forEach(remoteMsg => {
        peerAddMessage(channelKey, remoteMsg);
    });
    
    // Get updated local channel after merge
    const updatedChannel = peerGetChannel(channelKey);
    const updatedMessageCount = updatedChannel ? updatedChannel.messages.length : 0;
    
    // Check if there were new messages
    if (updatedMessageCount > localMessageCountBefore) {
        console.log(`[P2P] Channel ${channelKey} merged: ${localMessageCountBefore} → ${updatedMessageCount} messages (${updatedMessageCount - localMessageCountBefore} new)`);
    } else if (updatedMessageCount === localMessageCountBefore) {
        console.log(`[P2P] Channel ${channelKey} already in sync (${updatedMessageCount} messages)`);
    }
    
    // Always update cache to stay in sync
    channelCache[channelKey] = peerGetMessages(channelKey);
}

/**
 * Send entire channel via P2P (WebRTC data channel)
 * @param {string} to - target username (null/empty for broadcast to all)
 * @param {string} channelKey - channel to sync
 */
function rtcSendChannelSync(to, channelKey) {
    const channel = peerGetChannel(channelKey);
    if (!channel) {
        console.warn(`[P2P] Cannot send channel ${channelKey} - channel not found`);
        return;
    }
    
    const syncData = {
        type: 'channel_sync',
        channelKey,
        channel: {
            key: channel.key,
            type: channel.type,
            members: channel.members,
            messages: channel.messages,
            message_count: channel.message_count,
            last_activity: channel.last_activity
        }
    };
    
    if (to && to !== '') {
        // Send to specific user
        const peerChannel = webrtcChannels[to];
        if (!peerChannel || !peerChannel.isConnected) {
            console.warn(`[P2P] No active connection to ${to} for channel sync`);
            return;
        }
        
        try {
            const syncStr = JSON.stringify(syncData);
            peerChannel.dataChannel.send(syncStr);
            console.log(`[P2P] ✓ Channel ${channelKey} synced to ${to} (${channel.message_count} messages)`);
        } catch (err) {
            console.error(`[P2P] Error sending channel sync to ${to}:`, err);
        }
    } else {
        // Broadcast to all connected peers
        let broadcastCount = 0;
        for (const [username, peerChannel] of Object.entries(webrtcChannels)) {
            if (peerChannel.isConnected) {
                try {
                    const syncStr = JSON.stringify(syncData);
                    peerChannel.dataChannel.send(syncStr);
                    broadcastCount++;
                    console.log(`[P2P] ✓ Channel ${channelKey} synced to ${username}`);
                } catch (err) {
                    console.error(`[P2P] Error sending channel sync to ${username}:`, err);
                }
            }
        }
        if (broadcastCount === 0) {
            console.warn(`[P2P] No active connections to broadcast channel ${channelKey}`);
        } else {
            console.log(`[P2P] ✓ Channel ${channelKey} broadcasted to ${broadcastCount} peers (${channel.message_count} messages)`);
        }
    }
}

// Helper: sorted array
function sorted(arr) {
    return [...arr].sort();
}

// ============ FETCH FUNCTIONS (No apiRequest) ============


async function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();

    if (!message) return;
    if (isSending) return; // Prevent duplicate sends
    
    isSending = true;

    try {
        const currentTimestamp = Math.floor(Date.now() / 1000);
        const messageHash = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const channelKey = resolveChannelKey();
        const msgType = currentChatWith ? 'private' : 'group';

        // Build the message object (same structure as server)
        const newMsg = {
            id: messageHash,
            message_hash: messageHash,
            timestamp: currentTimestamp,
            from_user: currentUsername || 'You',
            to_user: currentChatWith || '',
            message,
            type: msgType
        };

        // ===== DATA UPDATE ONLY (NO RENDER, NO IMMEDIATE SEND) =====
        // Add to peer channel storage (local-first)
        peerAddMessage(channelKey, newMsg);

        // Update channelCache from peer storage
        const channelSnapshot = peerGetMessages(channelKey);
        channelCache[channelKey] = channelSnapshot;
        // NOTE: render loop will detect change and render automatically
        // NOTE: channel will be sent periodically by rtcChannelSyncLoop, not immediately
        // ====== END DATA UPDATE ======

    } catch (err) {
        console.error('[Chat] Send message failed:', err);
    } finally {
        isSending = false;
        input.value = '';
        input.focus();
    }
}

async function sendHeartbeat() {
    try {
        await fetch('/heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentUsername })
        });
    } catch (err) {
        console.error('[Chat] Heartbeat failed:', err);
        if (err.message.includes('401')) {
            clearInterval(heartbeatInterval);
            window.location.href = '/login.html';
        }
    }
}

async function getOnlineUsers() {
    try {
        const response = await fetch('/online', {
            method: 'GET',
            headers: {
                'X-Username': currentUsername
            }
        });
        if (!response.ok) return { online_users: [] };
        return await response.json();
    } catch (err) {
        console.error('[Chat] Get online users failed:', err);
        return { online_users: [] };
    }
}

async function getMessages(channelKey) {
    try {
        const response = await fetch('/messages', {
            method: 'GET',
            headers: {
                'X-Channel-Key': channelKey,
                'X-Username': currentUsername
            }
        });
        if (!response.ok) return { channel: [] };
        return await response.json();
    } catch (err) {
        console.error('[Chat] Get messages failed:', err);
        return { channel: [] };
    }
}

async function logoutUser() {
    try {
        return await fetch('/logout', {
            method: 'GET'
        });
    } catch (err) {
        console.error('[Chat] Logout failed:', err);
        throw err;
    }
}

async function getCurrentUser() {
    try {
        const response = await fetch('/whoami', {
            method: 'GET'
        });
        if (!response.ok) {
            window.location.href = '/login.html';
            return null;
        }
        return await response.json();
    } catch (err) {
        console.error('[Chat] Get current user failed:', err);
        window.location.href = '/login.html';
        return null;
    }
}

// ============ POLLING & HEARTBEAT ============

function startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        sendHeartbeat();
    }, 1000);
}

async function pollNewMessages() {
    // ===== DEPRECATED: P2P-ONLY ARCHITECTURE =====
    // Messages now come via WebRTC data channel, not from server
    // Server no longer stores message content
    // This function is kept for backward compatibility but does nothing
    // 
    // Messages flow:
    // 1. Send: Local peerChannels → P2P WebRTC → Remote peerChannels
    // 2. Receive: P2P WebRTC → rtcHandleIncomingMessage → Remote peerChannels
    // 3. Display: Render loop reads from peerChannels → channelCache → UI
    // ====== END DEPRECATED ======
}
function startMessagePolling() {
    if (messagePollingInterval) clearInterval(messagePollingInterval);
    console.log('[Chat] Starting message polling');
    pollNewMessages();
    messagePollingInterval = setInterval(() => {
        pollNewMessages();
    }, 1000);
}

/**
 * Start independent render loop
 * Checks every 500ms if current channel data changed, and re-renders if needed
 * This is independent from data update logic (sendMessage, pollNewMessages)
 */
function startRenderLoop() {
    if (renderLoopInterval) clearInterval(renderLoopInterval);
    console.log('[Render Loop] Starting independent render loop');
    renderCurrentChannel(); // Render immediately on start
    renderLoopInterval = setInterval(() => {
        renderCurrentChannel();
    }, 500);
}

function stopRenderLoop() {
    if (renderLoopInterval) {
        clearInterval(renderLoopInterval);
        console.log('[Render Loop] Stopped');
        renderLoopInterval = null;
    }
}

/**
 * Get effective online users by combining:
 * 1. Users reported online by server
 * 2. Users with active WebRTC connections
 * 
 * @returns {object[]} array of user objects with username
 */
function getEffectiveOnlineUsers() {
    // Start with server's online list
    let effectiveOnlineSet = new Set();
    let effectiveOnlineMap = {};
    
    // Helper to add user to set and map
    const addUser = (username) => {
        if (username && username !== currentUsername) {
            effectiveOnlineSet.add(username);
            if (!effectiveOnlineMap[username]) {
                effectiveOnlineMap[username] = { username };
            }
        }
    };
    
    // Option 1: Add users from server (async but we'll use cached data from last poll)
    // This is called from the polling/update cycle, so data should be recent
    try {
        // We can't do async here, so we assume caller will pass server data
        // For now, this will be handled in updateOnlineUsers directly
    } catch (err) {
        console.warn('[Chat] Could not get server online list:', err);
    }
    
    // Option 2: Add users with active WebRTC connections
    for (const [username, channel] of Object.entries(webrtcChannels)) {
        if (channel.isConnected) {
            addUser(username);
            console.log(`[Chat] Adding WebRTC-connected user to online list: ${username}`);
        }
    }
    
    return Object.values(effectiveOnlineMap);
}

async function updateOnlineUsers() {

    try {
        const data = await getOnlineUsers();
        const serverOnlineUsers = data.online_users || [];
        
        // ===== COMBINE SERVER + WEBRTC ONLINE STATUS =====
        let effectiveOnlineSet = new Set();
        let effectiveOnlineMap = {};
        
        // Add server-reported online users
        serverOnlineUsers.forEach(user => {
            if (user.username && user.username !== currentUsername) {
                effectiveOnlineSet.add(user.username);
                effectiveOnlineMap[user.username] = user;
            }
        });
        
        // Also add users with active WebRTC connections and alive ping (even if server says offline)
        for (const [username, channel] of Object.entries(webrtcChannels)) {
            if (channel.isConnected && channel.isAlive && username !== currentUsername) {
                if (!effectiveOnlineSet.has(username)) {
                    console.log(`[Chat] User ${username} is offline on server but has active WebRTC connection - showing as online`);
                    effectiveOnlineSet.add(username);
                    effectiveOnlineMap[username] = { username };
                }
            }
        }
        
        const effectiveOnlineUsers = Object.values(effectiveOnlineMap);
        // ===== END COMBINATION =====
        
        const sidebarHeader = document.querySelector('.sidebar-header p');
        if (sidebarHeader) {
            sidebarHeader.textContent = effectiveOnlineUsers.length + ' người đang trực tuyến';
        }
        
        if (currentChatWith === null) {
            const roomType = document.getElementById('roomType');
            if (roomType) {
                roomType.textContent = 'Công khai • ' + effectiveOnlineUsers.length + ' thành viên';
            }
        }
        
        const onlineList = document.getElementById('onlineUsers');
        onlineList.innerHTML = '';
        
        const filteredUsers = effectiveOnlineUsers.filter(user => user.username !== currentUsername);
        filteredUsers.forEach(user => {
            const userDiv = document.createElement('div');
            userDiv.className = 'user-item';
            userDiv.style.cursor = 'pointer';
            if (currentChatWith === user.username) {
                userDiv.classList.add('active');
            }
            
            // Check if user has active WebRTC connection with alive ping
            const hasWebRTC = webrtcChannels[user.username]?.isConnected && webrtcChannels[user.username]?.isAlive;
            const statusText = hasWebRTC ? 'Kết nối P2P' : 'Đang hoạt động';
            
            userDiv.innerHTML = `
                <div class="user-avatar" style="background: linear-gradient(135deg, #7c5cfc, #5b3ef5);">
                    ${user.username.charAt(0).toUpperCase()}
                </div>
                <div class="user-info">
                    <div class="user-name">${escapeHtml(user.username)}</div>
                    <div class="user-status">${statusText}</div>
                </div>
                <div class="online-dot"></div>
            `;
            userDiv.onclick = () => selectPrivateChat(userDiv, user.username);
            onlineList.appendChild(userDiv);
        });
    } catch (err) {
        console.error('[Chat] Update online users failed:', err);
    }
}

function selectPrivateChat(element, username) {
    document.querySelectorAll('.user-item').forEach(item => {
        item.classList.remove('active');
    });
    element.classList.add('active');
    currentChatWith = username;
    console.log('[Chat] Switched to private chat with:', username);
    
    // Clear displayed messages cache for this channel (force full re-render on next render loop)
    const channelKey = resolveChannelKey(username, currentUsername);
    delete displayedMessageIds[channelKey];
    lastRenderedChannelKey = null; // Force render loop to detect channel change
    
    // Ensure the private channel exists in peer storage (even if empty)
    peerEnsureChannel(channelKey, 'private', [currentUsername, username]);
    
    const chatTitle = document.querySelector('.chat-title');
    chatTitle.innerHTML = `${escapeHtml(username)}<br><span class="room-type">Chat riêng</span>`;
    
    loadMessages();
    renderCurrentChannel(true); // Force render immediately, even if channel is empty
}

async function loadMessages() {
    try {
        const channelKey = resolveChannelKey();
        const chatLabel = currentChatWith || 'general';
        console.log('[Chat] Loading messages for', chatLabel);
        
        // ===== P2P ONLY: Load from local peer storage =====
        // Messages are stored locally in peerChannels, not on server
        const messages = peerGetMessages(channelKey);
        
        // Ensure channel exists
        peerEnsureChannel(channelKey, currentChatWith ? 'private' : 'group', [currentUsername, currentChatWith].filter(Boolean));
        
        // Update channel cache from peer storage
        channelCache[channelKey] = messages;
        console.log(`[P2P] Loaded ${messages.length} messages for ${chatLabel}`);
        // NOTE: render loop will detect change and render automatically
        // ====== END P2P LOAD ======
    } catch (err) {
        console.error('[Chat] Load messages failed:', err);
    }
}

function selectChat(element, chatId) {
    document.querySelectorAll('.user-item').forEach(item => {
        item.classList.remove('active');
    });
    element.classList.add('active');

    if (chatId === 'general') {
        currentChatWith = null;
        console.log('[Chat] Switched to general chat');
        
        // Clear displayed messages cache for general channel (force full re-render on next render loop)
        delete displayedMessageIds['general'];
        lastRenderedChannelKey = null; // Force render loop to detect channel change
        
        const chatTitle = document.querySelector('.chat-title');
        
        getOnlineUsers().then(data => {
            const onlineCount = data.online_users ? data.online_users.length : 0;
            chatTitle.innerHTML = `Hội thoại chung<br><span class="room-type" id="roomType">Công khai • ${onlineCount+1} thành viên</span>`;
        }).catch(() => {
            chatTitle.innerHTML = `Hội thoại chung<br><span class="room-type" id="roomType">Công khai • Tất cả thành viên</span>`;
        });
        
        loadMessages();
        renderCurrentChannel(true); // Force render immediately, even if channel is empty
    }
}

document.getElementById('messageInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

async function logout() {
    try {
        console.log('[Chat] Initiating logout...');
        
        // Stop all loops
        stopRenderLoop();
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        if (messagePollingInterval) clearInterval(messagePollingInterval);
        
        // Stop WebRTC main loop
        rtcStopMainLoop();
        
        // Close all WebRTC peer connections
        for (const [username, channel] of Object.entries(webrtcChannels)) {
            if (channel && channel.peerConnection) {
                try {
                    channel.peerConnection.close();
                } catch (err) {
                    console.error(`[WebRTC] Error closing connection with ${username}:`, err);
                }
            }
        }
        webrtcChannels = {};
        
        await logoutUser();
    } catch (error) {
        console.error('[Chat] Logout error:', error);
    }
    window.location.href = '/login.html';
}

async function loadCurrentUser() {
    try {
        const userData = await getCurrentUser();
        if (!userData || !userData.username) {
            window.location.href = '/login.html';
            return;
        }

        currentUsername = userData.username;
        console.log('[Chat] Logged in as:', currentUsername);
        
        // Update sidebar current user profile card
        const avatarLetter = document.getElementById('currentUserAvatarLetter');
        if (avatarLetter) {
            avatarLetter.textContent = currentUsername.charAt(0).toUpperCase();
        }
        const displayName = document.getElementById('currentUserDisplayName');
        if (displayName) {
            displayName.textContent = currentUsername;
        }
        
        console.log('[Chat] Starting heartbeat and polling systems');
        startHeartbeat();
        startMessagePolling();
        startRenderLoop(); // Start independent render loop
        rtcStartMainLoop(); // Start WebRTC peer connection management
        
        updateOnlineUsers();
        setInterval(updateOnlineUsers, 2500);
        
        console.log('[Chat] General chat initialized (messages empty until user clicks)');
        // Initialize the general channel in peer storage
        peerEnsureChannel('general', 'group', [currentUsername]);
        channelCache['general'] = [];
        // NOTE: render loop will render automatically, do not call renderChannelFromMessages here
        console.log('[Peer] Initialized. Channels:', peerListChannels());
        console.log('[WebRTC] Initialized. Channels:', Object.keys(webrtcChannels));
    } catch (error) {
        console.error('[Chat] Could not load current user:', error);
        window.location.href = '/login.html';
    }
}

// ============ WEBRTC PEER MANAGEMENT ============
/**
 * WebRTC Channel Storage
 * Each key is a username, value is the WebRTC connection metadata
 * Format:
 * {
 *   'username': {
 *       peerConnection: RTCPeerConnection,
 *       dataChannel: RTCDataChannel (optional),
 *       lastPingTime: <unix timestamp>,
 *       lastPingSentTime: <unix timestamp>,
 *       isConnected: boolean,
 *       offerSent: boolean,
 *       answerSent: boolean,
 *       iceGatheringState: string,
 *       isAlive: boolean
 *   }
 * }
 */
let webrtcChannels = {};

// Ping configuration
const PING_TIMEOUT = 5000; // 5 seconds - if no ping received in this time, consider connection dead

/**
 * Counter for rtcMainLoop to track iterations (for periodic logging)
 * @type {number}
 */
let rtcMainLoopCounter = 0;

/**
 * Initialize WebRTC connection for a specific peer
 * @param {string} remoteUsername - username of the remote peer
 */
function rtcInitializeConnection(remoteUsername) {
    if (!remoteUsername || remoteUsername === currentUsername) return;
    
    if (webrtcChannels[remoteUsername]) {
        console.log(`[WebRTC] Connection already exists for ${remoteUsername}`);
        return webrtcChannels[remoteUsername];
    }

    console.log(`[WebRTC] Initializing connection with ${remoteUsername}`);
    
    const peerConnection = new RTCPeerConnection({
        iceServers: [
            { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
        ]
    });

    // Create data channel immediately (like your friend's code)
    const dataChannel = peerConnection.createDataChannel('chat');
    console.log(`[WebRTC] Data channel created for ${remoteUsername}`);

    const channel = {
        peerConnection,
        dataChannel,
        lastPingTime: Date.now(),
        lastPingSentTime: Date.now(),
        isConnected: false,
        offerSent: false,
        answerSent: false,
        iceGatheringState: 'new',
        isAlive: false
    };

    // Setup data channel events
    dataChannel.onopen = () => {
        console.log(`[WebRTC] Data channel opened with ${remoteUsername}`);
        channel.isConnected = true;
        channel.isAlive = true;
        channel.lastPingTime = Date.now();
        
        // Create virtual ping channel for this peer
        const pingChannelKey = `_ping_${remoteUsername}`;
        peerEnsureChannel(pingChannelKey, 'private', [currentUsername, remoteUsername]);
        console.log(`[P2P] Virtual ping channel created: ${pingChannelKey}`);
    };
    
    // ===== MESSAGE HANDLER: Receive channel syncs from P2P =====
    dataChannel.onmessage = (event) => {
        try {
            const syncData = JSON.parse(event.data);
            if (syncData.type === 'channel_sync') {
                rtcHandleChannelSync(remoteUsername, syncData);
            } else {
                console.warn(`[P2P] Unknown message type from ${remoteUsername}:`, syncData.type);
            }
        } catch (err) {
            console.error(`[P2P] Error parsing message from ${remoteUsername}:`, err, event.data);
        }
    };
    // ===== END MESSAGE HANDLER =====
    
    dataChannel.onclose = () => {
        console.log(`[WebRTC] Data channel closed with ${remoteUsername}`);
        channel.isConnected = false;
        // Trigger reconnect when data channel closes
        console.log(`[WebRTC] Reconnecting due to data channel close...`);
        rtcReconnect(remoteUsername);
    };
    
    dataChannel.onerror = (err) => {
        console.error(`[WebRTC] Data channel error with ${remoteUsername}:`, err);
        channel.isConnected = false;
        // Trigger reconnect when data channel has error
        console.log(`[WebRTC] Reconnecting due to data channel error...`);
        rtcReconnect(remoteUsername);
    };

    // Handle ICE candidates - fire and forget (don't await like your friend's code)
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log(`[WebRTC] ICE candidate generated for ${remoteUsername}:`, event.candidate);
            rtcSendCandidate(remoteUsername, event.candidate);
        } else {
            console.log(`[WebRTC] ICE gathering complete for ${remoteUsername}`);
        }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
        console.log(`[WebRTC] Connection state with ${remoteUsername}: ${peerConnection.connectionState}`);
        if (peerConnection.connectionState === 'connected') {
            channel.isConnected = true;
            rtcShowNotification(`Đã kết nối với ${remoteUsername}`);
        } else if (peerConnection.connectionState === 'failed' || 
                   peerConnection.connectionState === 'disconnected' ||
                   peerConnection.connectionState === 'closed') {
            channel.isConnected = false;
        }
    };

    // Handle ICE gathering state
    peerConnection.onicegatheringstatechange = () => {
        channel.iceGatheringState = peerConnection.iceGatheringState;
        console.log(`[WebRTC] ICE gathering state with ${remoteUsername}: ${peerConnection.iceGatheringState}`);
    };

    // Handle remote data channel (when receiving data channel from initiator)
    peerConnection.ondatachannel = (event) => {
        const remoteDataChannel = event.channel;
        console.log(`[WebRTC] Remote data channel received from ${remoteUsername}:`, remoteDataChannel);
        channel.dataChannel = remoteDataChannel;
        
        remoteDataChannel.onopen = () => {
            console.log(`[WebRTC] Remote data channel opened with ${remoteUsername}`);
            channel.isConnected = true;
        };
        
        // ===== MESSAGE HANDLER: Receive channel syncs from P2P =====
        remoteDataChannel.onmessage = (event) => {
            try {
                const syncData = JSON.parse(event.data);
                if (syncData.type === 'channel_sync') {
                    rtcHandleChannelSync(remoteUsername, syncData);
                } else {
                    console.warn(`[P2P] Unknown message type from ${remoteUsername}:`, syncData.type);
                }
            } catch (err) {
                console.error(`[P2P] Error parsing message from ${remoteUsername}:`, err, event.data);
            }
        };
        // ===== END MESSAGE HANDLER =====
        
        remoteDataChannel.onclose = () => {
            console.log(`[WebRTC] Remote data channel closed with ${remoteUsername}`);
            channel.isConnected = false;
            // Trigger reconnect when remote data channel closes
            console.log(`[WebRTC] Reconnecting due to remote data channel close...`);
            rtcReconnect(remoteUsername);
        };
        
        remoteDataChannel.onerror = (err) => {
            console.error(`[WebRTC] Remote data channel error with ${remoteUsername}:`, err);
            channel.isConnected = false;
            // Trigger reconnect when remote data channel has error
            console.log(`[WebRTC] Reconnecting due to remote data channel error...`);
            rtcReconnect(remoteUsername);
        };
    };

    webrtcChannels[remoteUsername] = channel;
    return channel;
}

/**
 * Create and send an offer to establish connection
 * @param {string} remoteUsername
 */
async function rtcCreateAndSendOffer(remoteUsername) {
    if (!remoteUsername || remoteUsername === currentUsername) return;
    
    let channel = webrtcChannels[remoteUsername];
    if (!channel) {
        channel = rtcInitializeConnection(remoteUsername);
    }

    if (channel.offerSent || channel.isConnected) {
        console.log(`[WebRTC] Offer already sent or connected with ${remoteUsername}`);
        return;
    }

    try {
        const offer = await channel.peerConnection.createOffer();
        await channel.peerConnection.setLocalDescription(offer);
        channel.offerSent = true;

        // Send offer - fire and forget (don't await)
        rtcSendSignal(remoteUsername, 'offer', offer);
        console.log(`[WebRTC] Offer sent to ${remoteUsername}`);
    } catch (err) {
        console.error(`[WebRTC] Error creating offer for ${remoteUsername}:`, err);
    }
}

/**
 * Handle incoming offer from remote peer
 * @param {string} remoteUsername
 * @param {object} offer - RTCSessionDescription
 */
async function rtcHandleOffer(remoteUsername, offer) {
    if (!remoteUsername || remoteUsername === currentUsername) return;
    
    let channel = webrtcChannels[remoteUsername];
    if (!channel) {
        channel = rtcInitializeConnection(remoteUsername);
    }

    try {
        const offerDesc = new RTCSessionDescription(offer);
        await channel.peerConnection.setRemoteDescription(offerDesc);

        const answer = await channel.peerConnection.createAnswer();
        await channel.peerConnection.setLocalDescription(answer);
        channel.answerSent = true;

        // Send answer - fire and forget (don't await)
        rtcSendSignal(remoteUsername, 'answer', answer);
        console.log(`[WebRTC] Answer sent to ${remoteUsername}`);
    } catch (err) {
        console.error(`[WebRTC] Error handling offer from ${remoteUsername}:`, err);
    }
}

/**
 * Handle incoming answer from remote peer
 * @param {string} remoteUsername
 * @param {object} answer - RTCSessionDescription
 */
async function rtcHandleAnswer(remoteUsername, answer) {
    if (!remoteUsername || remoteUsername === currentUsername) return;
    
    const channel = webrtcChannels[remoteUsername];
    if (!channel) {
        console.warn(`[WebRTC] No channel for ${remoteUsername} when handling answer`);
        return;
    }

    try {
        const answerDesc = new RTCSessionDescription(answer);
        if (channel.peerConnection.signalingState !== 'stable') {
            await channel.peerConnection.setRemoteDescription(answerDesc);
        }
        console.log(`[WebRTC] Answer received from ${remoteUsername}`);
    } catch (err) {
        console.error(`[WebRTC] Error handling answer from ${remoteUsername}:`, err);
    }
}

/**
 * Handle incoming ICE candidate
 * @param {string} remoteUsername
 * @param {object} candidate - RTCIceCandidate
 */
async function rtcHandleCandidate(remoteUsername, candidate) {
    if (!remoteUsername || remoteUsername === currentUsername) return;
    
    const channel = webrtcChannels[remoteUsername];
    if (!channel) {
        console.warn(`[WebRTC] No channel for ${remoteUsername} when handling candidate`);
        return;
    }

    try {
        const candidateObj = new RTCIceCandidate(candidate);
        if (channel.peerConnection.remoteDescription) {
            console.log(`[WebRTC] Adding ICE candidate from ${remoteUsername}:`, candidate);
            await channel.peerConnection.addIceCandidate(candidateObj);
            console.log(`[WebRTC] ✓ ICE candidate from ${remoteUsername} added`);
        } else {
            console.warn(`[WebRTC] No remoteDescription yet for ${remoteUsername}, candidate queued:`, candidate);
        }
    } catch (err) {
        console.error(`[WebRTC] Error adding ICE candidate from ${remoteUsername}:`, err);
    }
}

/**
 * Send WebRTC signal via server (fire and forget)
 * @param {string} to - target username
 * @param {string} type - 'offer', 'answer', or 'candidate'
 * @param {object} data - signal data
 */
function rtcSendSignal(to, type, data) {
    console.log(`[WebRTC] Sending ${type} signal to ${to}`);
    
    // Fire and forget - don't await
    fetch('/rtc/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: currentUsername,
            type,
            to,
            data
        })
    }).then(response => {
        if (!response.ok) {
            console.error(`[WebRTC] Failed to send ${type} signal to ${to}: HTTP ${response.status}`);
        } else {
            console.log(`[WebRTC] ✓ ${type} signal sent to ${to}`);
        }
    }).catch(err => {
        console.error(`[WebRTC] Error sending ${type} signal to ${to}:`, err);
    });
}

/**
 * Send ICE candidate via server (fire and forget, don't await)
 * @param {string} to - target username
 * @param {RTCIceCandidate} candidate
 */
function rtcSendCandidate(to, candidate) {
    // Convert candidate to plain object for JSON serialization
    const candidateObj = {
        candidate: candidate.candidate,
        sdpMLineIndex: candidate.sdpMLineIndex,
        sdpMid: candidate.sdpMid
    };
    console.log(`[WebRTC] Sending candidate to ${to}:`, candidateObj);
    
    // Fire and forget - don't await like your friend's code
    fetch('/rtc/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: currentUsername,
            type: 'candidate',
            to,
            data: candidateObj
        })
    }).catch(err => console.error(`[WebRTC] Error sending candidate to ${to}:`, err));
}

/**
 * Poll WebRTC signals from server
 * Receives all pending offers, answers, and candidates
 */
async function rtcPollSignals() {
    try {
        const response = await fetch('/rtc/poll', {
            method: 'GET',
            headers: {
                'X-Username': currentUsername,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            if (response.status === 401) {
                console.error('[WebRTC] Unauthorized - need to re-login');
                rtcStopMainLoop();
                return;
            }
            console.error('[WebRTC] Poll failed with status:', response.status);
            return;
        }

        const signals = await response.json();
        
        // Process offers
        for (const offer of (signals.offers || [])) {
            const from = offer.from;
            console.log(`[WebRTC] Received offer from ${from}`);
            await rtcHandleOffer(from, offer.data);
        }

        // Process answers
        for (const answer of (signals.answers || [])) {
            const from = answer.from;
            console.log(`[WebRTC] Received answer from ${from}`);
            await rtcHandleAnswer(from, answer.data);
        }

        // Process candidates
        for (const candidate of (signals.candidates || [])) {
            const from = candidate.from;
            console.log(`[WebRTC] Received candidate from ${from}`);
            await rtcHandleCandidate(from, candidate.data);
        }
    } catch (err) {
        console.error('[WebRTC] Error polling signals:', err);
    }
}


/**
 * Check connection health and clean up dead connections
 * - Checks peer connection state
 * - Checks data channel state (must be 'open')
 * - Checks for stale connections (no ping received)
 * - Automatically reconnects if any failures detected
 */
function rtcCheckConnectionHealth() {
    const now = Date.now();
    const failedChannels = [];
    const dataChannelIssues = [];
    const timeoutChannels = [];

    for (const [username, channel] of Object.entries(webrtcChannels)) {
        const peerState = channel.peerConnection?.connectionState || 'unknown';
        const dataChannelState = channel.dataChannel?.readyState || 'unknown';
        const timeSinceLastPing = now - channel.lastPingTime;
        
        // Check for failed peer connections
        if (peerState === 'failed' || peerState === 'closed' || peerState === 'disconnected') {
            failedChannels.push({ username, peerState, offerSent: channel.offerSent });
            console.warn(`[WebRTC] ⚠ Peer connection with ${username} failed: ${peerState}`);
            rtcReconnect(username);
        }
        
        // Check for data channel issues (must be 'open' for connected channels)
        if (channel.isConnected && dataChannelState !== 'open') {
            dataChannelIssues.push({ username, dataChannelState });
            console.warn(`[WebRTC] ⚠ Data channel with ${username} is ${dataChannelState} (expected: open)`);
            rtcReconnect(username);
        }
        
        // Check for ping timeout (if connected but no ping received)
        if (channel.isConnected && timeSinceLastPing > PING_TIMEOUT) {
            timeoutChannels.push({ username, timeSinceLastPing });
            channel.isAlive = false;
            console.warn(`[WebRTC] ⚠ Ping timeout with ${username} (${timeSinceLastPing}ms) - marking as dead`);
            rtcReconnect(username);
        }
    }
    
    // Log summary of all issues
    if (failedChannels.length > 0) {
        console.warn('[WebRTC] ⚠ Failed peer connections detected:');
        failedChannels.forEach(ch => {
            console.warn(`  - ${ch.username}: state=${ch.peerState}`);
        });
    }
    
    if (dataChannelIssues.length > 0) {
        console.warn('[WebRTC] ⚠ Data channel issues detected:');
        dataChannelIssues.forEach(ch => {
            console.warn(`  - ${ch.username}: readyState=${ch.dataChannelState}`);
        });
    }
    
    if (timeoutChannels.length > 0) {
        console.warn('[WebRTC] ⚠ Ping timeout detected:');
        timeoutChannels.forEach(ch => {
            console.warn(`  - ${ch.username}: no ping for ${ch.timeSinceLastPing}ms`);
        });
    }
}


/**
 * Attempt to reconnect to a peer
 * Closes existing connection and initiates a new one
 * @param {string} remoteUsername
 */
async function rtcReconnect(remoteUsername) {
    console.log(`[WebRTC] 🔄 Reconnecting with ${remoteUsername}...`);
    
    const channel = webrtcChannels[remoteUsername];
    if (channel) {
        // Close data channel if exists
        if (channel.dataChannel) {
            try {
                console.log(`[WebRTC] Closing data channel with ${remoteUsername}`);
                channel.dataChannel.close();
            } catch (err) {
                console.error(`[WebRTC] Error closing data channel:`, err);
            }
        }
        
        // Close peer connection
        if (channel.peerConnection) {
            try {
                console.log(`[WebRTC] Closing peer connection with ${remoteUsername}`);
                channel.peerConnection.close();
            } catch (err) {
                console.error(`[WebRTC] Error closing peer connection:`, err);
            }
        }
    }

    // Reset channel state
    console.log(`[WebRTC] Resetting channel state for ${remoteUsername}`);
    delete webrtcChannels[remoteUsername];
    
    // Small delay before reconnecting to avoid immediate failure
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Initiate new connection
    rtcInitializeConnection(remoteUsername);
    console.log(`[WebRTC] ✓ New connection initialized with ${remoteUsername}`);
    
    // Send offer immediately (only if we should be the initiator)
    // Only send offer if currentUsername > remoteUsername (lexicographically)
    if (currentUsername > remoteUsername) {
        await rtcCreateAndSendOffer(remoteUsername);
        console.log(`[WebRTC] ✓ Offer sent to ${remoteUsername}`);
    } else {
        console.log(`[WebRTC] ✓ Waiting for offer from ${remoteUsername}`);
    }
}

/**
 * Show WebRTC toast notification in bottom-right corner
 * @param {string} message - notification text
 * @param {number} duration - milliseconds to show (default 3000)
 */
function rtcShowNotification(message, duration = 3000) {
    const container = document.getElementById('rtcToastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'rtc-toast';
    toast.textContent = message;
    
    container.appendChild(toast);

    // Auto-remove after duration
    setTimeout(() => {
        toast.classList.add('rtc-toast-fade');
        setTimeout(() => {
            container.removeChild(toast);
        }, 350);
    }, duration);
}

/**
 * Debug: Log WebRTC channel statuses
 * Shows all channels with connection state, failures, etc.
 */
function rtcDebugLogChannelStatus() {
    const channelStatus = [];
    let successCount = 0;
    let failureCount = 0;
    let connectingCount = 0;
    
    for (const [username, channel] of Object.entries(webrtcChannels)) {
        const state = channel.peerConnection?.connectionState || 'unknown';
        const isConnected = channel.isConnected;
        const offerSent = channel.offerSent;
        const answerSent = channel.answerSent;
        
        let status = 'unknown';
        if (isConnected) {
            status = '✓ CONNECTED';
            successCount++;
        } else if (state === 'failed' || state === 'closed' || state === 'disconnected') {
            status = '✗ FAILED (' + state + ')';
            failureCount++;
        } else if (state === 'connecting') {
            status = '↻ CONNECTING';
            connectingCount++;
        } else if (offerSent && !answerSent) {
            status = '↻ WAITING_ANSWER';
            connectingCount++;
        } else if (!offerSent) {
            status = '↻ WAITING_OFFER';
            connectingCount++;
        } else {
            status = '? ' + state;
        }
        
        channelStatus.push({
            user: username,
            status,
            state,
            offerSent,
            answerSent
        });
    }
    
    // Sort by status: connected first, then connecting, then failed
    channelStatus.sort((a, b) => {
        const order = { '✓ CONNECTED': 0, '↻ CONNECTING': 1, '↻ WAITING_ANSWER': 1, '↻ WAITING_OFFER': 1, '✗ FAILED': 2 };
        const orderA = order[a.status.split(' ')[0] + ' ' + a.status.split(' ')[1]] || 99;
        const orderB = order[b.status.split(' ')[0] + ' ' + b.status.split(' ')[1]] || 99;
        return orderA - orderB;
    });
    
    const total = channelStatus.length;
    console.log(
        '[WebRTC] Channel Status: %c✓ ' + successCount + ' %c↻ ' + connectingCount + ' %c✗ ' + failureCount + ' %c(Total: ' + total + ')',
        'color: green; font-weight: bold',
        'color: orange; font-weight: bold',
        'color: red; font-weight: bold',
        'color: gray'
    );
    
    if (channelStatus.length > 0) {
        console.table(channelStatus);
    } else {
        console.log('[WebRTC] No channels active');
    }
    
    // Log failed channels separately with details
    const failedChannels = channelStatus.filter(ch => ch.status.includes('FAILED'));
    if (failedChannels.length > 0) {
        console.warn('[WebRTC] ⚠ Failed Connections:');
        failedChannels.forEach(ch => {
            console.warn('  - ' + ch.user + ': ' + ch.state);
        });
    }
    
    return { successCount, failureCount, connectingCount, total, channelStatus };
}

/**
 * Channel sync loop - runs every 1 second
 * - Syncs all local channels to connected peers
 * - Uses WebRTC data channels to broadcast entire channels
 * - Deduplication happens at channel level (messages are synced as complete channel)
 */
async function rtcChannelSyncLoop() {
    try {
        // Send ping channels to all connected peers
        for (const [username, channel] of Object.entries(webrtcChannels)) {
            if (channel.isConnected) {
                const pingChannelKey = `_ping_${username}`;
                rtcSendChannelSync(username, pingChannelKey);
                channel.lastPingSentTime = Date.now();
            }
        }
        
        // Sync all local channels to connected peers
        for (const [channelKey, channel] of Object.entries(peerChannels)) {
            // Sync to specific user if private channel
            // Skip virtual ping channels - they're handled above
            if (channelKey.startsWith('_ping_')) continue;
            
            if (channel.type === 'private') {
                // For private channel like 'user1_user2', find the other user
                const users = channelKey.split('_').filter(u => u && u !== currentUsername);
                if (users.length > 0) {
                    const otherUser = users[0];
                    rtcSendChannelSync(otherUser, channelKey);
                }
            } else {
                // For group channel (general), broadcast to all connected peers
                rtcSendChannelSync(null, channelKey);
            }
        }
    } catch (err) {
        console.error('[P2P Sync] Error in channel sync loop:', err);
    }
}

/**
 * Main WebRTC loop - runs every 1 second
 * - Polls for incoming signals
 * - Maintains connections with all online users
 * - Checks connection health
 */
async function rtcMainLoop() {
    // Poll for incoming signals (offers, answers, candidates)
    await rtcPollSignals();

    // Get online users and ensure we have channels with all of them
    try {
        const data = await getOnlineUsers();
        const onlineUsers = data.online_users || [];
        
        for (const user of onlineUsers) {
            if (user.username === currentUsername) continue;
            
            // Ensure channel exists
            if (!webrtcChannels[user.username]) {
                rtcInitializeConnection(user.username);
            }
            
            const channel = webrtcChannels[user.username];
            
            // Try to establish connection if not already connected
            // Only send offer if currentUsername > remoteUsername (lexicographically)
            // This prevents both sides from sending offers simultaneously
            if (!channel.isConnected && !channel.offerSent && currentUsername > user.username) {
                await rtcCreateAndSendOffer(user.username);
            }
        }
        
        // Keep non-online users' channels (don't delete them as per requirement)
        // This maintains historical connection data in case server is unreliable
        
    } catch (err) {
        console.error('[WebRTC] Error in main loop:', err);
    }

    // Check connection health
    rtcCheckConnectionHealth();
    
    // Debug log every 5 seconds (on iteration 5, 10, 15, ...)
    if (!rtcMainLoopCounter) rtcMainLoopCounter = 0;
    rtcMainLoopCounter++;
    if (rtcMainLoopCounter % 5 === 0) {
        rtcDebugLogChannelStatus();
    }
}


/**
 * Start WebRTC main loop
 * Runs every 1 second
 */
let rtcLoopInterval = null;
let rtcChannelSyncInterval = null;

function rtcStartMainLoop() {
    if (rtcLoopInterval) {
        clearInterval(rtcLoopInterval);
    }
    if (rtcChannelSyncInterval) {
        clearInterval(rtcChannelSyncInterval);
    }
    
    console.log('[WebRTC] Starting main loop (interval: 1000ms)');
    rtcMainLoop(); // Run immediately first time
    rtcLoopInterval = setInterval(rtcMainLoop, 1000);
    
    console.log('[P2P Sync] Starting channel sync loop (interval: 1000ms)');
    rtcChannelSyncLoop(); // Run immediately first time
    rtcChannelSyncInterval = setInterval(rtcChannelSyncLoop, 1000);
}

function rtcStopMainLoop() {
    if (rtcLoopInterval) {
        clearInterval(rtcLoopInterval);
        rtcLoopInterval = null;
        console.log('[WebRTC] Main loop stopped');
    }
    if (rtcChannelSyncInterval) {
        clearInterval(rtcChannelSyncInterval);
        rtcChannelSyncInterval = null;
        console.log('[P2P Sync] Channel sync loop stopped');
    }
}

// ============ GROUP CONVERSATIONS ============

let allGroups = [];
let userGroups = [];

/**
 * Load groups from the server
 */
async function loadGroups() {
    try {
        const response = await fetch('/group/list', {
            method: 'GET',
            headers: {
                'X-Username': currentUsername
            }
        });
        if (!response.ok) {
            console.error('[Groups] Failed to load groups:', response.status);
            return;
        }
        const data = await response.json();
        userGroups = data.user_groups || [];
        allGroups = data.all_groups || [];
        displayGroups();
    } catch (err) {
        console.error('[Groups] Error loading groups:', err);
    }
}

/**
 * Display groups in the sidebar
 */
function displayGroups() {
    const groupsList = document.getElementById('groupsList');
    if (!groupsList) return;
    
    groupsList.innerHTML = '';
    
    if (userGroups.length === 0) {
        groupsList.innerHTML = '<div style="padding: 10px; font-size: 12px; color: var(--text-muted); text-align: center;">Chưa tham gia nhóm nào</div>';
        return;
    }
    
    userGroups.forEach(group => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'group-item';
        groupDiv.onclick = () => selectGroupChat(groupDiv, group.id);
        
        // Check if group is currently selected
        if (currentChatWith === group.id) {
            groupDiv.classList.add('active');
        }
        
        const avatar = String(group.name.charAt(0)).toUpperCase();
        groupDiv.innerHTML = `
            <div class="group-avatar">${avatar}</div>
            <div class="group-info">
                <div class="group-name">${escapeHtml(group.name)}</div>
                <div class="group-members-count">${group.member_count} thành viên</div>
            </div>
        `;
        
        groupsList.appendChild(groupDiv);
    });
}

/**
 * Select a group chat
 */
function selectGroupChat(element, groupId) {
    document.querySelectorAll('.group-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelectorAll('.user-item').forEach(item => {
        item.classList.remove('active');
    });
    element.classList.add('active');
    
    currentChatWith = groupId;
    console.log('[Chat] Switched to group:', groupId);
    
    // Clear displayed messages cache for this channel
    delete displayedMessageIds[groupId];
    lastRenderedChannelKey = null;
    
    // Ensure the group channel exists in peer storage
    const group = userGroups.find(g => g.id === groupId);
    if (group) {
        peerEnsureChannel(groupId, 'group', group.members);
        
        const chatTitle = document.querySelector('.chat-title');
        chatTitle.innerHTML = `${escapeHtml(group.name)}<br><span class="room-type">${group.member_count} thành viên</span>`;
    }
    
    loadMessages();
    renderCurrentChannel(true);
}

/**
 * Open create group modal
 */
function openCreateGroupModal() {
    const modal = document.getElementById('createGroupModal');
    if (!modal) return;
    
    modal.style.display = 'flex';
    
    // Load online users for member selection
    loadOnlineUsersForGroupCreation();
}

/**
 * Close create group modal
 */
function closeCreateGroupModal() {
    const modal = document.getElementById('createGroupModal');
    if (!modal) return;
    
    modal.style.display = 'none';
    document.getElementById('groupNameInput').value = '';
    document.getElementById('membersCheckboxContainer').innerHTML = '';
}

// Close modal when clicking outside of it
window.addEventListener('click', function(event) {
    const modal = document.getElementById('createGroupModal');
    if (modal && event.target === modal) {
        closeCreateGroupModal();
    }
});

/**
 * Load online users for group creation
 */
function loadOnlineUsersForGroupCreation() {
    getOnlineUsers().then(data => {
        const onlineUsers = data.online_users || [];
        const container = document.getElementById('membersCheckboxContainer');
        container.innerHTML = '';
        
        onlineUsers.forEach(user => {
            if (user.username !== currentUsername) {
                const checkboxDiv = document.createElement('div');
                checkboxDiv.className = 'member-checkbox';
                
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = user.username;
                checkbox.id = 'member_' + user.username;
                
                const label = document.createElement('label');
                label.htmlFor = 'member_' + user.username;
                label.textContent = escapeHtml(user.username);
                label.style.margin = '0';
                
                checkboxDiv.appendChild(checkbox);
                checkboxDiv.appendChild(label);
                container.appendChild(checkboxDiv);
            }
        });
    });
}

/**
 * Create a new group
 */
async function createNewGroup() {
    const groupName = document.getElementById('groupNameInput').value.trim();
    if (!groupName) {
        alert('Vui lòng nhập tên nhóm');
        return;
    }
    
    // Get selected members
    const checkboxes = document.querySelectorAll('#membersCheckboxContainer input[type="checkbox"]:checked');
    const members = [];
    checkboxes.forEach(checkbox => {
        members.push(checkbox.value);
    });
    
    if (members.length === 0) {
        alert('Vui lòng chọn ít nhất một thành viên');
        return;
    }
    
    try {
        const response = await fetch('/group/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Username': currentUsername
            },
            body: JSON.stringify({
                username: currentUsername,
                group_name: groupName,
                members: members
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            alert('Lỗi tạo nhóm: ' + (errorData.error || 'Không xác định'));
            return;
        }
        
        const data = await response.json();
        console.log('[Groups] Group created:', data.group);
        
        // Close modal
        closeCreateGroupModal();
        
        // Reload groups
        loadGroups();
        
        // Select the newly created group
        setTimeout(() => {
            const newGroup = document.querySelector(`.group-item[data-group-id="${data.group.id}"]`);
            if (newGroup) {
                newGroup.click();
            }
        }, 100);
        
        alert('Nhóm đã được tạo thành công!');
    } catch (err) {
        console.error('[Groups] Error creating group:', err);
        alert('Lỗi tạo nhóm: ' + err.message);
    }
}

/**
 * Handle message send for groups
 * Override the original sendMessage to handle group channel key
 */
const originalSendMessage = sendMessage;

window.addEventListener('load', function() {
    loadCurrentUser();
    loadGroups();
    const messagesArea = document.getElementById('messagesArea');
    messagesArea.scrollTop = messagesArea.scrollHeight;
});
