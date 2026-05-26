#
# Copyright (C) 2026 pdnguyen of HCMC University of Technology VNU-HCM.
# All rights reserved.
# This file is part of the CO3093/CO3094 course,
# and is released under the "MIT License Agreement". Please see the LICENSE
# file that should have been included as part of this package.
#
# AsynapRous release
#
# The authors hereby grant to Licensee personal permission to use
# and modify the Licensed Source Code for the sole purpose of studying
# while attending the course
#


"""
app.sampleapp
~~~~~~~~~~~~~~~~~

"""

import sys
import os
import importlib.util
import json
import time
import hashlib

from   daemon import AsynapRous
from   daemon.request import Request

app = AsynapRous()

# Global message storage in RAM
# Format: {'general': [...], 'user1_user2': [...]}
_messages_storage = {}
_message_counter = 0


def _to_payload_dict(body):
    """Framework may already parse JSON body to dict; keep string fallback for compatibility."""
    if isinstance(body, dict):
        return body
    if isinstance(body, str):
        try:
            parsed = json.loads(body)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return {}
    return {}


def _extract_username(headers, body):
    """Extract explicit username from request payload or headers."""
    payload = _to_payload_dict(body)
    username = None
    if isinstance(payload, dict):
        username = payload.get('username')
    if not username and headers and isinstance(headers, dict):
        username = headers.get('x-username') or headers.get('X-Username')
    if isinstance(username, str):
        username = username.strip()
    return username or None


def _authenticate_request(headers, body, require_explicit=False):
    """Validate session cookie and prefer explicit username from client."""
    cookie_header = ''
    if headers and isinstance(headers, dict):
        cookie_header = headers.get('cookie', '')

    req = Request()
    session_user = None
    is_valid = False
    if cookie_header:
        is_valid, session_user, expiration = req.validate_session_cookie(cookie_header)

    if not is_valid:
        return None, req

    username = _extract_username(headers, body)
    if username:
        if session_user and username != session_user:
            return None, req
        return username, req

    if require_explicit:
        return None, req

    return session_user, req


def _hash_message(msg_obj):
    """Generate hash for a message to detect duplicates."""
    # Hash key: from_user|message|timestamp (content-based)
    key = f"{msg_obj.get('from_user', '')}|{msg_obj.get('message', '')}|{msg_obj.get('timestamp', '')}"
    return hashlib.md5(key.encode()).hexdigest()

@app.route('/login', methods=['POST'])
def login(headers="guest", body="anonymous"):
    """
    Handle user login using Basic Auth and issue a session cookie.
    """
    req = Request()
    username, password = req.prepare_auth(headers.get('authorization', '') if isinstance(headers, dict) else '')

    if not username or not password:
        return {
            'body': json.dumps({'error': 'Unauthorized'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 401, 'reason': 'Unauthorized'}
        }

    if not req.verify_password(username, password):
        return {
            'body': json.dumps({'error': 'Unauthorized'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 401, 'reason': 'Unauthorized'}
        }

    session_id, session_expiration = req.generate_session_id(username)

    return {
        'body': json.dumps({'username': username, 'message': 'Login successful'}),
        'header': {
            'Content-Type': 'application/json',
            'Set-Cookie': f'sessionid={session_id}; Path=/; HttpOnly'
        },
        'first_line': {'code': 200, 'reason': 'OK'}
    }

@app.route('/whoami', methods=['GET'])
def whoami(headers="guest", body="anonymous"):
    """
    Return the current username based on the session cookie.
    """
    cookie_header = ''
    if headers and isinstance(headers, dict):
        cookie_header = headers.get('cookie', '')

    if not cookie_header:
        return {
            'body': json.dumps({'error': 'Unauthorized'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 401, 'reason': 'Unauthorized'}
        }

    req = Request()
    is_valid, username, expiration = req.validate_session_cookie(cookie_header)
    if not is_valid or not username:
        return {
            'body': json.dumps({'error': 'Unauthorized'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 401, 'reason': 'Unauthorized'}
        }

    return {
        'body': json.dumps({'username': username}),
        'header': {'Content-Type': 'application/json'},
        'first_line': {'code': 200, 'reason': 'OK'}
    }

@app.route('/message', methods=['POST'])
def message(headers="guest", body="anonymous"):
    """
    Receive a chat message and infer the current user from the session cookie.
    Save message to storage and return confirmation.
    """
    global _messages_storage, _message_counter
    
    username, req = _authenticate_request(headers, body, require_explicit=True)
    if not username:
        return {
            'body': json.dumps({'error': 'Unauthorized'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 401, 'reason': 'Unauthorized'}
        }

    payload = _to_payload_dict(body)
    message_hash = str(payload.get('message_hash', '') or '').strip()
    message_text = str(payload.get('message', '')).strip()
    to_user = str(payload.get('to_user', '')).strip()  # Empty for group chat
    msg_type = 'private' if to_user else 'group'
    incoming_channel = payload.get('channel_messages', [])

    if not message_text:
        return {
            'body': json.dumps({'error': 'No message provided'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 400, 'reason': 'Bad Request'}
        }

    if not message_hash:
        message_hash = str(_message_counter + 1)
        return {
            'body': json.dumps({'error': 'No message provided'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 400, 'reason': 'Bad Request'}
        }

    # Save message to RAM storage
    current_time = int(time.time())
    _message_counter += 1
    message_id = message_hash or str(_message_counter)
    
    # Determine channel key
    if msg_type == 'group':
        channel_key = 'general'
    else:
        # For private messages, use consistent key: sort usernames
        users = sorted([username, to_user])
        channel_key = '{}_{}'.format(users[0], users[1])
    
    # Initialize channel if not exists
    if channel_key not in _messages_storage:
        _messages_storage[channel_key] = []
    
    # Create server message object
    msg_obj = {
        'id': message_id,
        'message_hash': message_hash,
        'timestamp': current_time,
        'from_user': username,
        'to_user': to_user or '',
        'message': message_text,
        'type': msg_type
    }
    
    # If browser sends incoming channel, process with deduplication
    if isinstance(incoming_channel, list) and len(incoming_channel) > 0:
        normalized_channel = _messages_storage[channel_key]
        for item in incoming_channel:
            if not isinstance(item, dict):
                continue
            incoming_text = str(item.get('message', '')).strip()
            incoming_from = str(item.get('from_user', '')).strip()
            if not incoming_text or not incoming_from:
                continue
            try:
                incoming_ts = int(item.get('timestamp', current_time))
            except (ValueError, TypeError):
                incoming_ts = current_time

            msg_candidate = {
                'id': str(item.get('id', '')) or str(len(normalized_channel) + 1),
                'message_hash': str(item.get('message_hash', '') or '').strip(),
                'timestamp': incoming_ts,
                'from_user': incoming_from,
                'to_user': str(item.get('to_user', '')).strip(),
                'message': incoming_text,
                'type': str(item.get('type', msg_type)).strip() or msg_type
            }
            
            # Deduplicate by message hash if present, otherwise by content hash
            if msg_candidate['message_hash']:
                existing_index = next((idx for idx, m in enumerate(normalized_channel)
                                       if str(m.get('message_hash', '') or '').strip() == msg_candidate['message_hash']), None)
                if existing_index is not None:
                    normalized_channel[existing_index] = msg_candidate
                    continue
            msg_hash = _hash_message(msg_candidate)
            if msg_hash not in normalized_channel:
                normalized_channel.append(msg_candidate)
        
        _messages_storage[channel_key] = normalized_channel
    
    if message_hash:
        existing_index = next((idx for idx, m in enumerate(_messages_storage[channel_key])
                               if str(m.get('message_hash', '') or '').strip() == message_hash), None)
        if existing_index is not None:
            _messages_storage[channel_key][existing_index] = msg_obj
        else:
            _messages_storage[channel_key].append(msg_obj)
    else:
        # Check if server's new message is already in the channel (dedup check)
        new_msg_hash = _hash_message(msg_obj)
        is_duplicate = any(_hash_message(msg) == new_msg_hash for msg in _messages_storage[channel_key])
        if not is_duplicate:
            _messages_storage[channel_key].append(msg_obj)
    
    # Sort by timestamp
    _messages_storage[channel_key].sort(key=lambda x: x.get('timestamp', 0))
    
    return {
        'body': json.dumps({
            'username': username, 
            'message': message_text,
            'to_user': to_user,
            'type': msg_type,
            'channel': _messages_storage[channel_key]
        }),
        'header': {'Content-Type': 'application/json'},
        'first_line': {'code': 200, 'reason': 'OK'}
    }

@app.route('/heartbeat', methods=['POST'])
def heartbeat(headers="guest", body="anonymous"):
    """
    Update user's online status. Called every second by client.
    """
    username, req = _authenticate_request(headers, body, require_explicit=True)
    if not username:
        return {
            'body': json.dumps({'error': 'Unauthorized'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 401, 'reason': 'Unauthorized'}
        }

    # Update online status
    req.update_online_status(username)
    
    # Extend session expiration (add 60 seconds to current expiration)
    current_time = int(time.time())
    new_expiration = current_time + 3600  # 1 hour from now
    
    # Update session in database
    db_users = req.load_users_db()
    if username in db_users:
        db_users[username]['expiration'] = new_expiration
        # Save updated sessions
        req._save_sessions_to_file(db_users)
    
    return {
        'body': json.dumps({'status': 'online', 'username': username}),
        'header': {'Content-Type': 'application/json'},
        'first_line': {'code': 200, 'reason': 'OK'}
    }

@app.route('/online', methods=['GET'])
def get_online_users(headers="guest", body="anonymous"):
    """
    Get list of currently online users.
    """
    username, req = _authenticate_request(headers, body, require_explicit=True)
    if not username:
        return {
            'body': json.dumps({'error': 'Unauthorized'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 401, 'reason': 'Unauthorized'}
        }

    online_users = req.get_online_users()
    
    return {
        'body': json.dumps({'online_users': online_users}),
        'header': {'Content-Type': 'application/json'},
        'first_line': {'code': 200, 'reason': 'OK'}
    }




@app.route('/messages', methods=['GET'])
def get_messages(headers="guest", body="anonymous"):
    """
    Get chat messages for a channel. Parameters from headers:
    - X-Channel-Key: channel key (e.g., "general", "alice_bob")
    """
    global _messages_storage
    
    username, req = _authenticate_request(headers, body, require_explicit=True)
    if not username:
        return {
            'body': json.dumps({'error': 'Unauthorized'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 401, 'reason': 'Unauthorized'}
        }

    # Get channel key from headers
    channel_key = 'general'
    if headers and isinstance(headers, dict):
        channel_key = headers.get('x-channel-key', 'general').strip()
    
    if not channel_key:
        channel_key = 'general'
    
    # Get messages from RAM storage
    messages = []
    if channel_key in _messages_storage:
        for msg in _messages_storage[channel_key]:
            messages.append(msg)
    
    # Sort by timestamp (oldest first) for full channel rendering from the top.
    messages.sort(key=lambda x: x['timestamp'])
    
    return {
        'body': json.dumps({'messages': messages, 'channel': messages}),
        'header': {'Content-Type': 'application/json'},
        'first_line': {'code': 200, 'reason': 'OK'}
    }

@app.route('/logout', methods=['GET'])
def logout(headers="guest", body="anonymous"):
    """
    Handle user logout via GET request.
    
    This route clears the session cookie and returns a redirect response to login.
    It also revokes the session in the database.
    
    :param headers (str): The request headers.
    :param body (str): The request body.
    """
    # Extract session ID from Cookie header and revoke it
    session_id = None
    if headers and isinstance(headers, dict):
        cookie_header = headers.get('cookie', '')
        if cookie_header:
            for part in cookie_header.split(';'):
                part = part.strip()
                if part.startswith('sessionid='):
                    session_id = part.split('=', 1)[1].strip()
                    break
    
    # Revoke session in database
    if session_id:
        req = Request()
        username, success = req.revoke_session(session_id)
        if success:
            print("[SampleApp] Session revoked for user: {}".format(username))
        else:
            print("[SampleApp] Failed to revoke session in database")
    
    # Return response with Set-Cookie header to delete the cookie
    # Using Max-Age=0 to delete the cookie immediately
    response_data = {
        'body': '',
        'header': {
            'Set-Cookie': 'sessionid=; Path=/; HttpOnly; Max-Age=0',
            'Location': '/login.html',
            'Content-Type': 'text/html'
        },
        'first_line': {
            'code': 302,
            'reason': 'Found'
        }
    }
    
    return response_data

# ============ WEBRTC SIGNALING BUFFER ============
_rtc_signals = {}
# Format: { 'target_username': { 'offers': [...], 'answers': [...], 'candidates': [...] } }

@app.route('/rtc/signal', methods=['POST'])
def rtc_signal(headers="guest", body="anonymous"):
    """Relay a WebRTC signal (offer/answer/candidate) to a target user."""
    username, req = _authenticate_request(headers, body, require_explicit=True)
    if not username:
        return {
            'body': json.dumps({'error': 'Unauthorized'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 401, 'reason': 'Unauthorized'}
        }

    payload = _to_payload_dict(body)
    signal_type = str(payload.get('type', '')).strip()
    target = str(payload.get('to', '')).strip()
    data = payload.get('data')

    if not signal_type or not target or data is None:
        return {
            'body': json.dumps({'error': 'Missing type, to, or data'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 400, 'reason': 'Bad Request'}
        }

    if target not in _rtc_signals:
        _rtc_signals[target] = {'offers': [], 'answers': [], 'candidates': []}

    entry = {'from': username, 'data': data, 'timestamp': int(time.time())}
    buf = _rtc_signals[target]

    if signal_type == 'offer':
        buf['offers'] = [o for o in buf['offers'] if o['from'] != username]
        buf['offers'].append(entry)
    elif signal_type == 'answer':
        buf['answers'] = [a for a in buf['answers'] if a['from'] != username]
        buf['answers'].append(entry)
    elif signal_type == 'candidate':
        buf['candidates'].append(entry)
        print("[SampleApp] RTC candidate received: {} -> {}, Candidate data: {}, Total in buffer: {}".format(
            username, target, data, len(buf['candidates'])
        ))
    else:
        return {
            'body': json.dumps({'error': 'Invalid signal type'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 400, 'reason': 'Bad Request'}
        }

    if signal_type != 'candidate':
        print("[SampleApp] RTC signal: {} -> {} ({})".format(username, target, signal_type))
    return {
        'body': json.dumps({'status': 'ok'}),
        'header': {'Content-Type': 'application/json'},
        'first_line': {'code': 200, 'reason': 'OK'}
    }


@app.route('/rtc/poll', methods=['GET'])
def rtc_poll(headers="guest", body="anonymous"):
    """Poll and consume all pending WebRTC signals for the current user."""
    username, req = _authenticate_request(headers, body, require_explicit=True)
    if not username:
        return {
            'body': json.dumps({'error': 'Unauthorized'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 401, 'reason': 'Unauthorized'}
        }

    signals = _rtc_signals.pop(username, {'offers': [], 'answers': [], 'candidates': []})
    print("[SampleApp] RTC poll - User: {}, Offers: {}, Answers: {}, Candidates: {}".format(
        username, len(signals['offers']), len(signals['answers']), len(signals['candidates'])
    ))
    if signals['candidates']:
        print("[SampleApp]   Candidate buffer: {}".format(signals['candidates']))
    return {
        'body': json.dumps(signals),
        'header': {'Content-Type': 'application/json'},
        'first_line': {'code': 200, 'reason': 'OK'}
    }


# ============ GROUP CONVERSATIONS MANAGEMENT ============
def _load_groups():
    """Load groups from db/groups.txt file."""
    groups = {}
    db_path = os.path.join(os.path.dirname(__file__), '..', 'db', 'groups.txt')
    
    if not os.path.exists(db_path):
        return groups
    
    try:
        with open(db_path, 'r') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                
                parts = line.split('|')
                if len(parts) >= 6:
                    group_id = parts[0]
                    group_name = parts[1]
                    owner = parts[2]
                    members_str = parts[3]
                    created_at = int(parts[4])
                    is_active = int(parts[5])
                    
                    if is_active:
                        members = [m.strip() for m in members_str.split(',') if m.strip()]
                        groups[group_id] = {
                            'id': group_id,
                            'name': group_name,
                            'owner': owner,
                            'members': members,
                            'created_at': created_at,
                            'message_count': 0
                        }
    except Exception as e:
        print("[SampleApp] Error loading groups: {}".format(e))
    
    return groups


def _save_groups(groups):
    """Save groups to db/groups.txt file."""
    db_path = os.path.join(os.path.dirname(__file__), '..', 'db', 'groups.txt')
    
    try:
        with open(db_path, 'w') as f:
            f.write('# Group conversations database\n')
            f.write('# Format: group_id|group_name|owner|members|created_at|is_active\n')
            f.write('# members format: username1,username2,username3\n\n')
            
            for group_id, group in groups.items():
                members_str = ','.join(group['members'])
                is_active = 1
                line = '{}|{}|{}|{}|{}|{}\n'.format(
                    group_id, group['name'], group['owner'],
                    members_str, group['created_at'], is_active
                )
                f.write(line)
    except Exception as e:
        print("[SampleApp] Error saving groups: {}".format(e))


@app.route('/group/create', methods=['POST'])
def create_group(headers="guest", body="anonymous"):
    """
    Create a new group conversation.
    Expected payload: {'group_name': 'Team A', 'members': ['user1', 'user2']}
    """
    username, req = _authenticate_request(headers, body, require_explicit=True)
    if not username:
        return {
            'body': json.dumps({'error': 'Unauthorized'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 401, 'reason': 'Unauthorized'}
        }

    payload = _to_payload_dict(body)
    group_name = str(payload.get('group_name', '')).strip()
    members = payload.get('members', [])
    
    if not group_name:
        return {
            'body': json.dumps({'error': 'Group name is required'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 400, 'reason': 'Bad Request'}
        }
    
    if not isinstance(members, list) or len(members) == 0:
        return {
            'body': json.dumps({'error': 'At least one member is required'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 400, 'reason': 'Bad Request'}
        }
    
    # Ensure creator is in the members list
    if username not in members:
        members.append(username)
    
    # Remove duplicates
    members = list(set(members))
    
    # Generate group ID
    group_id = 'group_{}_{}'.format(hashlib.md5(group_name.encode()).hexdigest()[:8], int(time.time()))
    
    # Load existing groups
    groups = _load_groups()
    
    # Create new group
    current_time = int(time.time())
    groups[group_id] = {
        'id': group_id,
        'name': group_name,
        'owner': username,
        'members': members,
        'created_at': current_time,
        'message_count': 0
    }
    
    # Initialize message storage for this group
    if group_id not in _messages_storage:
        _messages_storage[group_id] = []
    
    # Save groups to file
    _save_groups(groups)
    
    return {
        'body': json.dumps({
            'success': True,
            'group': groups[group_id]
        }),
        'header': {'Content-Type': 'application/json'},
        'first_line': {'code': 201, 'reason': 'Created'}
    }


@app.route('/group/list', methods=['GET'])
def list_groups(headers="guest", body="anonymous"):
    """
    Get list of all groups and groups the current user is a member of.
    """
    username, req = _authenticate_request(headers, body, require_explicit=True)
    if not username:
        return {
            'body': json.dumps({'error': 'Unauthorized'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 401, 'reason': 'Unauthorized'}
        }

    groups = _load_groups()
    
    # Filter groups where user is a member
    user_groups = []
    all_groups = []
    
    for group_id, group in groups.items():
        group_info = {
            'id': group['id'],
            'name': group['name'],
            'owner': group['owner'],
            'members': group['members'],
            'member_count': len(group['members']),
            'created_at': group['created_at']
        }
        
        all_groups.append(group_info)
        if username in group['members']:
            user_groups.append(group_info)
    
    return {
        'body': json.dumps({
            'user_groups': user_groups,
            'all_groups': all_groups
        }),
        'header': {'Content-Type': 'application/json'},
        'first_line': {'code': 200, 'reason': 'OK'}
    }


@app.route('/group/info', methods=['GET'])
def get_group_info(headers="guest", body="anonymous"):
    """
    Get information about a specific group.
    Group ID should be in X-Group-Id header.
    """
    username, req = _authenticate_request(headers, body, require_explicit=True)
    if not username:
        return {
            'body': json.dumps({'error': 'Unauthorized'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 401, 'reason': 'Unauthorized'}
        }

    group_id = ''
    if headers and isinstance(headers, dict):
        group_id = headers.get('x-group-id', '').strip()
    
    if not group_id:
        return {
            'body': json.dumps({'error': 'Group ID is required'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 400, 'reason': 'Bad Request'}
        }
    
    groups = _load_groups()
    if group_id not in groups:
        return {
            'body': json.dumps({'error': 'Group not found'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 404, 'reason': 'Not Found'}
        }
    
    group = groups[group_id]
    
    # Check if user is a member
    if username not in group['members']:
        return {
            'body': json.dumps({'error': 'You are not a member of this group'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 403, 'reason': 'Forbidden'}
        }
    
    return {
        'body': json.dumps({
            'group': {
                'id': group['id'],
                'name': group['name'],
                'owner': group['owner'],
                'members': group['members'],
                'member_count': len(group['members']),
                'created_at': group['created_at']
            }
        }),
        'header': {'Content-Type': 'application/json'},
        'first_line': {'code': 200, 'reason': 'OK'}
    }


@app.route('/group/add-member', methods=['POST'])
def add_group_member(headers="guest", body="anonymous"):
    """
    Add a member to a group.
    Expected payload: {'group_id': 'group_xxx', 'new_member': 'username'}
    Only group owner can add members.
    """
    username, req = _authenticate_request(headers, body, require_explicit=True)
    if not username:
        return {
            'body': json.dumps({'error': 'Unauthorized'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 401, 'reason': 'Unauthorized'}
        }

    payload = _to_payload_dict(body)
    group_id = str(payload.get('group_id', '')).strip()
    new_member = str(payload.get('new_member', '')).strip()
    
    if not group_id or not new_member:
        return {
            'body': json.dumps({'error': 'group_id and new_member are required'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 400, 'reason': 'Bad Request'}
        }
    
    groups = _load_groups()
    if group_id not in groups:
        return {
            'body': json.dumps({'error': 'Group not found'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 404, 'reason': 'Not Found'}
        }
    
    group = groups[group_id]
    
    # Check if user is the owner
    if username != group['owner']:
        return {
            'body': json.dumps({'error': 'Only group owner can add members'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 403, 'reason': 'Forbidden'}
        }
    
    # Check if member already exists
    if new_member in group['members']:
        return {
            'body': json.dumps({'error': 'Member already in group'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 400, 'reason': 'Bad Request'}
        }
    
    # Add member
    group['members'].append(new_member)
    
    # Save groups
    _save_groups(groups)
    
    return {
        'body': json.dumps({
            'success': True,
            'group': group
        }),
        'header': {'Content-Type': 'application/json'},
        'first_line': {'code': 200, 'reason': 'OK'}
    }


@app.route('/group/remove-member', methods=['POST'])
def remove_group_member(headers="guest", body="anonymous"):
    """
    Remove a member from a group.
    Expected payload: {'group_id': 'group_xxx', 'member': 'username'}
    Only group owner or the member themselves can remove.
    """
    username, req = _authenticate_request(headers, body, require_explicit=True)
    if not username:
        return {
            'body': json.dumps({'error': 'Unauthorized'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 401, 'reason': 'Unauthorized'}
        }

    payload = _to_payload_dict(body)
    group_id = str(payload.get('group_id', '')).strip()
    member = str(payload.get('member', '')).strip()
    
    if not group_id or not member:
        return {
            'body': json.dumps({'error': 'group_id and member are required'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 400, 'reason': 'Bad Request'}
        }
    
    groups = _load_groups()
    if group_id not in groups:
        return {
            'body': json.dumps({'error': 'Group not found'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 404, 'reason': 'Not Found'}
        }
    
    group = groups[group_id]
    
    # Check permissions (only owner or the member themselves)
    if username != group['owner'] and username != member:
        return {
            'body': json.dumps({'error': 'Permission denied'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 403, 'reason': 'Forbidden'}
        }
    
    # Check if member exists in group
    if member not in group['members']:
        return {
            'body': json.dumps({'error': 'Member not in group'}),
            'header': {'Content-Type': 'application/json'},
            'first_line': {'code': 400, 'reason': 'Bad Request'}
        }
    
    # Remove member
    group['members'].remove(member)
    
    # Save groups
    _save_groups(groups)
    
    return {
        'body': json.dumps({
            'success': True,
            'group': group
        }),
        'header': {'Content-Type': 'application/json'},
        'first_line': {'code': 200, 'reason': 'OK'}
    }


def create_sampleapp(ip, port):
    # Prepare and launch the RESTful application
    app.prepare_address(ip, port)
    app.run()

