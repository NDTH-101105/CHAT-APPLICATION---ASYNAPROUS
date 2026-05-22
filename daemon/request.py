#
# Copyright (C) 2026 pdnguyen of HCMC University of Technology VNU-HCM.
# All rights reserved.
# This file is part of the CO3093/CO3094 course.
#
# AsynapRous release
#
# The authors hereby grant to Licensee personal permission to use
# and modify the Licensed Source Code for the sole purpose of studying
# while attending the course
#

"""
daemon.request
~~~~~~~~~~~~~~~~~

This module provides a Request object to manage and persist 
request settings (cookies, auth, proxies).
"""
import json
import hashlib
import base64
import datetime
import os
import time
import threading

from .dictionary import CaseInsensitiveDict

# Lock to serialize file read/write and prevent race conditions between threads
_file_lock = threading.Lock()

# Retry configuration for file I/O operations
MAX_RETRIES = 5
RETRY_DELAY = 0.05  # seconds (initial delay, increases exponentially)

def _retry_file_operation(operation, description="file operation"):
    """
    Execute a file I/O operation with retry logic.
    Retries up to MAX_RETRIES times with exponential backoff on failure.
    
    :param operation: A callable that performs the file operation.
    :param description: A human-readable description for logging.
    :returns: The return value of the operation callable.
    :raises: The last exception if all retries are exhausted.
    """
    last_exception = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return operation()
        except Exception as e:
            last_exception = e
            delay = RETRY_DELAY * (2 ** (attempt - 1))  # exponential backoff
            time.sleep(delay)
    # All retries exhausted — raise the last exception
    raise last_exception

# RAM-based storage for online users
_online_users_ram = {}  # Format: {'username': {'last_seen': timestamp, 'is_online': 1}}

class Request():
    """The fully mutable "class" `Request <Request>` object,
    containing the exact bytes that will be sent to the server.

    Instances are generated from a "class" `Request <Request>` object, and
    should not be instantiated manually; doing so may produce undesirable
    effects.

    Usage::

      >>> import deamon.request
      >>> req = request.Request()
      ## Incoming message obtain aka. incoming_msg
      >>> r = req.prepare(incoming_msg)
      >>> r
      <Request>
    """
    __attrs__ = [
        "method",
        "url",
        "headers",
        "body",
        "_raw_headers",
        "_raw_body",
        "reason",
        "cookies",
        "body",
        "routes",
        "hook",
    ]

    def __init__(self):
        #: HTTP verb to send to the server.
        self.method = None
        #: HTTP URL to send the request to.
        self.url = None
        #: dictionary of HTTP headers.
        self.headers = None
        #: HTTP path
        self.path = None        
        # The cookies set used to create Cookie header
        self.cookies = None
        #: request body to send to the server.
        self.body = None
        # The raw header
        self._raw_headers = None
        #: The raw body
        self._raw_body = None
        #: Routes
        self.routes = {}
        #: Hook point for routed mapped-path
        self.hook = None
        #: Authentication username
        self.username = None
        #: Authentication password
        self.password = None
        #: Session ID for authenticated users
        self.session_id = None
        #: Session expiration time
        self.session_expiration = None

    def load_users_db(self):
        """Load users and sessions from db/sessions.txt file.
        
        Uses file locking and retry logic to handle concurrent access.
        Retries on failure until success or MAX_RETRIES exhausted.
        
        Returns a dictionary with format:
        {
            'admin': {'password_hash': '...', 'session_id': '...', 'expiration': ..., 'is_active': 1},
            ...
        }
        """
        db_path = os.path.join(os.path.dirname(__file__), '..', 'db', 'sessions.txt')

        def _read_db():
            db_users = {}
            with _file_lock:
                with open(db_path, 'r') as f:
                    for line in f:
                        line = line.strip()
                        # Skip comments and empty lines
                        if not line or line.startswith('#'):
                            continue
                        
                        parts = line.split('|')
                        if len(parts) >= 6:
                            username = parts[0]
                            password_hash = parts[1]
                            session_id = parts[2]
                            expiration = parts[3]
                            created_time = parts[4]
                            is_active = parts[5]
                            db_users[username] = {
                                'password_hash': password_hash,
                                'session_id': session_id,
                                'expiration': int(expiration) if expiration else 0,
                                'created_time': int(created_time) if created_time else 0,
                                'is_active': int(is_active) if is_active else 0
                            }
            return db_users

        try:
            return _retry_file_operation(_read_db, "load_users_db (read {})".format(db_path))
        except Exception as e:
            print("[Request] Error loading users DB after all retries: {}".format(e))
            return {}

    def hash_password(self, password):
        """Hash password using SHA256."""
        return hashlib.sha256(password.encode()).hexdigest()

    def verify_password(self, username, password):
        """Verify username and password against the database.
        
        Returns True if credentials are valid, False otherwise.
        """
        db_users = self.load_users_db()
        
        if username not in db_users:
            return False
        
        user = db_users[username]
        # Compare password directly (plain text) since DB stores plain text passwords
        return user['password_hash'] == password

    def generate_session_id(self, username):
        """Generate a new session ID and update the database."""
        import uuid
        session_id = str(uuid.uuid4())
        session_expiration = int(time.time()) + 3600  # 1 hour expiration
        
        db_path = os.path.join(os.path.dirname(__file__), '..', 'db', 'sessions.txt')
        db_users = self.load_users_db()

        if username in db_users:
            # Update session info
            db_users[username]['session_id'] = session_id
            db_users[username]['expiration'] = session_expiration
            db_users[username]['is_active'] = 1

            # Write back to file using helper
            try:
                self._save_sessions_to_file(db_users)
            except Exception as e:
                print("[Request] Error writing session: {}".format(e))
        
        return session_id, session_expiration

    def revoke_session(self, session_id):
        """Revoke a session by marking it as inactive in the database.
        
        Args:
            session_id: The session ID to revoke
            
        Returns:
            (revoked_username, success_flag)
        """
        db_path = os.path.join(os.path.dirname(__file__), '..', 'db', 'sessions.txt')
        db_users = self.load_users_db()
        revoked_username = None
        
        # Find and revoke the session
        for username, user_data in db_users.items():
            if user_data['session_id'] == session_id:
                revoked_username = username
                user_data['session_id'] = ''
                user_data['is_active'] = 0
                break
        
        # Write back to database
        if revoked_username:
            try:
                self._save_sessions_to_file(db_users)
                print("[Request] Session revoked for user: {}".format(revoked_username))
                return revoked_username, True
            except Exception as e:
                print("[Request] Error revoking session: {}".format(e))
                return revoked_username, False
        
        return None, False

    def validate_session_cookie(self, cookie_value):
        """Validate a session cookie and return (is_valid, username, expiration).
        
        Cookie format: "sessionid=<session_id>"
        """
        if not cookie_value:
            return False, None, None
        
        try:
            # Parse cookie string and look for sessionid
            session_id = None
            for part in cookie_value.split(';'):
                part = part.strip()
                if part.startswith('sessionid='):
                    session_id = part.split('=', 1)[1].strip()
                    break

            if not session_id:
                return False, None, None

            db_users = self.load_users_db()
            current_time = int(time.time())
            
            # Find user with this session_id
            for username, user_data in db_users.items():
                if user_data['session_id'] == session_id:
                    # Check if session is active and not expired
                    if user_data['is_active'] == 1 and user_data['expiration'] > current_time:
                        return True, username, user_data['expiration']
                    else:
                        return False, None, None
            
            return False, None, None
        except Exception as e:
            print("[Request] Error validating session: {}".format(e))
            return False, None, None

    def extract_request_line(self, request):
        try:
            lines = request.splitlines()
            first_line = lines[0]
            method, path, version = first_line.split()

            if path == '/':
                path = '/login.html'
        except Exception:
            return None, None

        return method, path, version
             
    def prepare_headers(self, request):
        """Prepares the given HTTP headers."""
        lines = request.split('\r\n')
        headers = {}
        for line in lines[1:]:
            if ': ' in line:
                key, val = line.split(': ', 1)
                headers[key.lower()] = val
        return headers

    def fetch_headers_body(self, request):
        """Prepares the given HTTP headers."""
        # Split request into header section and body section
        parts = request.split("\r\n\r\n", 1)  # split once at blank line

        _headers = parts[0]
        _body = parts[1] if len(parts) > 1 else ""
        return _headers, _body

    def prepare(self, request, routes=None):
        """Prepares the entire request with the given parameters."""

        # Prepare the request line from the request header
        self.method, self.path, self.version = self.extract_request_line(request)

        #
        # @bksysnet Preapring the webapp hook with AsynapRous instance
        # The default behaviour with HTTP server is empty routed
        #
        # TODO manage the webapp hook in this mounting point
        #
        
        if not routes == {}:
            self.routes = routes
            self.hook = routes.get((self.method, self.path))

        self._raw_headers, self._raw_body = self.fetch_headers_body(request)
        self.headers = self.prepare_headers(self._raw_headers)
        self.body = self.prepare_body(self._raw_body)
        self.username, self.password = self.prepare_auth(self.headers.get("authorization", ""))
        self.cookies = self.prepare_cookies()
        return

    def prepare_body(self, _raw_body):
        self.prepare_content_length(_raw_body)
        body = _raw_body

        # If the request body is JSON text, parse it into a dictionary.
        content_type = self.headers.get('content-type', '').lower() if self.headers else ''
        if body:
            if 'application/json' in content_type:
                try:
                    body = json.loads(body)
                except json.JSONDecodeError:
                    pass
            else:
                # Fallback: if the body looks like JSON text, try parsing it anyway.
                try:
                    body = json.loads(body)
                except json.JSONDecodeError:
                    pass

        return body

    def prepare_content_length(self, body):
        self.headers["Content-Length"] = len(body)
        return

    def prepare_auth(self, auth):
        if not auth:
            return None, None

        auth = auth.strip()
        if auth.lower().startswith("basic "):
            encoded = auth.split(" ", 1)[1].strip()
            try:
                decoded = base64.b64decode(encoded).decode("utf-8")
            except Exception:
                decoded = auth
        else:
            decoded = auth

        if ":" in decoded:
            username, password = decoded.split(":", 1)
        else:
            username, password = decoded, ""

        return username, password

    def prepare_cookies(self):
        """Prepare and handle cookies and authentication.
        
        Returns:
            - If valid session cookie exists: return the cookie value
            - If username/password provided: verify them, create session, return session cookie
            - Otherwise: return None or existing cookie from header
        """
        # Check for existing session cookie first
        existing_cookie = self.headers.get('cookie')
        
        if existing_cookie:
            # Validate existing session
            is_valid, username, expiration = self.validate_session_cookie(existing_cookie)
            if is_valid:
                print("[Request] Valid session cookie found for user: {}".format(username))
                self.session_id = existing_cookie.split('=', 1)[1].strip() if '=' in existing_cookie else None
                self.session_expiration = expiration
                return existing_cookie
            else:
                print("[Request] Invalid or expired session cookie")
        
        # If username and password are provided (from Basic Auth)
        if self.username and self.password:
            if self.verify_password(self.username, self.password):
                print("[Request] Password verified for user: {}".format(self.username))
                session_id, session_expiration = self.generate_session_id(self.username)
                self.session_id = session_id
                self.session_expiration = session_expiration
                cookie = "sessionid={}".format(session_id)
                print("[Request] New session created: {}".format(cookie))
                return cookie
            else:
                print("[Request] Authentication failed for user: {}".format(self.username))
                return None
        
        # No authentication attempts or invalid
        print("[Request] No authentication provided")
        return existing_cookie

    def update_online_status(self, username):
        """Update user's online status in RAM (in-memory storage) with current timestamp."""
        global _online_users_ram
        
        current_time = int(time.time())
        
        # Update or add user to online status
        _online_users_ram[username] = {
            'last_seen': current_time,
            'is_online': 1
        }

    def get_online_users(self):
        """Get list of currently online users (active within last 30 seconds) from RAM."""
        global _online_users_ram
        
        current_time = int(time.time())
        online_users = []
        
        # Get all users marked as online and last seen within 30 seconds (grace period: 3s inactivity buffer)
        ONLINE_TIMEOUT = 3  # Display users as online for 30 seconds
        for username, data in _online_users_ram.items():
            if data['is_online'] == 1 and (current_time - data['last_seen']) <= ONLINE_TIMEOUT:
                online_users.append({
                    'username': username,
                    'last_seen': data['last_seen']
                })
        
        return online_users

    def _save_sessions_to_file(self, db_users):
        """Save sessions database to file.
        
        Uses file locking and retry logic to handle concurrent access.
        Retries on failure until success or MAX_RETRIES exhausted.
        """
        db_path = os.path.join(os.path.dirname(__file__), '..', 'db', 'sessions.txt')

        def _write_db():
            with _file_lock:
                with open(db_path, 'w') as f:
                    f.write("# Session Management Database\n")
                    f.write("# Format: username|password_hash|session_id|expiration_time|created_time|is_active\n")
                    f.write("# password_hash: SHA256 hash of password\n")
                    f.write("# expiration_time: Unix timestamp when session expires\n")
                    f.write("# created_time: Unix timestamp when session was created\n")
                    f.write("# is_active: 1 or 0 (1 = active, 0 = revoked)\n\n")
                    
                    for user, data in db_users.items():
                        line = "{}|{}|{}|{}|{}|{}\n".format(
                            user,
                            data['password_hash'],
                            data['session_id'],
                            data['expiration'],
                            data['created_time'],
                            data['is_active']
                        )
                        f.write(line)

        try:
            _retry_file_operation(_write_db, "_save_sessions_to_file (write {})".format(db_path))
        except Exception as e:
            print("[Request] Error saving sessions after all retries: {}".format(e))
