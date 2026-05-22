#
# Copyright (C) 2026 pdnguyen of HCMC University of Technology VNU-HCM.
# All rights reserved.
# This file is part of the CO3093/CO3094 course.
#
# AsynApRous release
#
# The authors hereby grant to Licensee personal permission to use
# and modify the Licensed Source Code for the sole purpose of studying
# while attending the course
#

"""
daemon.response
~~~~~~~~~~~~~~~~~

This module provides a :class: `Response <Response>` object to manage and persist 
response settings (cookies, auth, proxies), and to construct HTTP responses
based on incoming requests. 

The current version supports MIME type detection, content loading and header formatting
"""
import datetime
import html
import os
import mimetypes
import time
import threading
from .dictionary import CaseInsensitiveDict
from .request import _file_lock, _retry_file_operation, MAX_RETRIES, RETRY_DELAY

BASE_DIR = ""

class Response():   
    """The :class:`Response <Response>` object, which contains a
    server's response to an HTTP request.

    Instances are generated from a :class:`Request <Request>` object, and
    should not be instantiated manually; doing so may produce undesirable
    effects.

    :class:`Response <Response>` object encapsulates headers, content, 
    status code, cookies, and metadata related to the request-response cycle.
    It is used to construct and serve HTTP responses in a custom web server.

    :attrs status_code (int): HTTP status code (e.g., 200, 404).
    :attrs headers (dict): dictionary of response headers.
    :attrs url (str): url of the response.
    :attrsencoding (str): encoding used for decoding response content.
    :attrs history (list): list of previous Response objects (for redirects).
    :attrs reason (str): textual reason for the status code (e.g., "OK", "Not Found").
    :attrs cookies (CaseInsensitiveDict): response cookies.
    :attrs elapsed (datetime.timedelta): time taken to complete the request.
    :attrs request (PreparedRequest): the original request object.

    Usage::

      >>> import Response
      >>> resp = Response()
      >>> resp.build_response(req)
      >>> resp
      <Response>
    """

    __attrs__ = [
        "_content",
        "_header",
        "status_code",
        "method",
        "headers",
        "url",
        "history",
        "encoding",
        "reason",
        "cookies",
        "elapsed",
        "request",
        "body",
        "reason",
    ]


    def __init__(self, request=None):
        """
        Initializes a new :class:`Response <Response>` object.

        : params request : The originating request object.
        """

        self._content = False
        self._content_consumed = False
        self._next = None

        #: Integer Code of responded HTTP Status, e.g. 404 or 200.
        self.status_code = None

        #: Case-insensitive Dictionary of Response Headers.
        #: For example, ``headers['content-type']`` will return the
        #: value of a ``'Content-Type'`` response header.
        self.headers = {}

        #: URL location of Response.
        self.url = None

        #: Encoding to decode with when accessing response text.
        self.encoding = None

        #: A list of :class:`Response <Response>` objects from
        #: the history of the Request.
        self.history = []

        #: Textual reason of responded HTTP Status, e.g. "Not Found" or "OK".
        self.reason = None

        #: A of Cookies the response headers.
        self.cookies = CaseInsensitiveDict()

        #: The amount of time elapsed between sending the request
        self.elapsed = datetime.timedelta(0)

        #: The :class:`PreparedRequest <PreparedRequest>` object to which this
        #: is a response.
        self.request = None


    def get_mime_type(self, path):
        """
        Determines the MIME type of a file based on its path.

        "params path (str): Path to the file.

        :rtype str: MIME type string (e.g., 'text/html', 'image/png').
        """

        try:
            mime_type, _ = mimetypes.guess_type(path)
        except Exception:
            return 'application/octet-stream'
        return mime_type or 'application/octet-stream'


    def validate_session_cookie(self, cookie_value):
        """Validate a session cookie against the database.
        Uses retry logic to handle transient I/O errors when reading the session file.
        
        Returns: (is_valid, username, expiration)
        """
        if not cookie_value:
            return False, None, None
        
        try:
            # Parse cookie: "a=b;c=d;sessionid=<session_id>;e=f"
            session_id = None
            
            # Split by semicolon to get individual cookie components
            cookie_parts = cookie_value.split(';')
            for part in cookie_parts:
                part = part.strip()
                if '=' in part:
                    key, value = part.split('=', 1)
                    if key.strip() == 'sessionid':
                        session_id = value.strip()
                        break
            
            # Check if sessionid was found
            if not session_id:
                return False, None, None
            db_path = os.path.join(os.path.dirname(__file__), '..', 'db', 'sessions.txt')
            current_time = int(time.time())
            
            # Read and validate session from database with retry logic
            def _read_and_validate():
                with _file_lock:
                    with open(db_path, 'r') as f:
                        for line in f:
                            line = line.strip()
                            if not line or line.startswith('#'):
                                continue
                            
                            parts = line.split('|')
                            if len(parts) >= 6:
                                username = parts[0]
                                stored_session_id = parts[2]
                                expiration = int(parts[3]) if parts[3] else 0
                                is_active = int(parts[5]) if parts[5] else 0
                                
                                if stored_session_id == session_id:
                                    # Check if session is active and not expired
                                    if is_active == 1 and expiration > current_time:
                                        return True, username, expiration
                                    else:
                                        return False, None, None
                # Session not found in any line
                return None  # sentinel: not found (distinct from False)

            try:
                result = _retry_file_operation(_read_and_validate, "validate_session_cookie (read {})".format(db_path))
                if result is None:
                    return False, None, None
                return result
            except Exception as e:
                return False, None, None
            
        except Exception as e:
            return False, None, None


    def check_authentication(self, request):
        """Check if request is authenticated and handle redirects.
        
        Returns: (is_authenticated, should_redirect)
        - is_authenticated: True if valid session or on login page
        - should_redirect: True if should redirect to login
        """
        # Get session validity
        has_valid_session = False
        if request.cookies:
            is_valid, username, expiration = self.validate_session_cookie(request.cookies)
            has_valid_session = is_valid
        
        # If user tries to access login page but already has valid session → redirect to index.html
        if request.path == '/login.html' and has_valid_session:

            request.redirect_to = '/index.html'
            return True, False  # Not a redirect in this context, but mark for special handling
        
        # List of paths that don't require authentication (public resources)
        public_paths = [
            '/login.html',
            '/login',
            '/logout',
            '/whoami',
            '/heartbeat',
            '/online',
            '/messages',
            '/rtc/signal',
            '/rtc/poll',
            '/css/login.css',
            '/js/login.js',
            '/images/'
        ]
        
        # Check if current path is public
        is_public = request.path in public_paths or any(request.path.startswith(p) for p in public_paths)
        
        if is_public:
            return True, False
        
        # Protected resource - check session
        if has_valid_session:
            return True, False
        
        # No valid session for protected resource
        return False, True


    def prepare_content_type(self, mime_type='text/html'):
        """
        Prepares the Content-Type header and determines the base directory
        for serving the file based on its MIME type.

        :params mime_type (str): MIME type of the requested resource.

        :rtype str: Base directory path for locating the resource.

        :raises ValueError: If the MIME type is unsupported.
        """
        
        base_dir = ""

        # Validate header attr existence
        if not hasattr(self, "headers") or self.headers is None:
            self.headers = {}

        # Processing mime_type based on main_type and sub_type
        main_type, sub_type = mime_type.split('/', 1)
        if main_type == 'text':
            if sub_type == 'css':
                base_dir = BASE_DIR+"static/"
            elif sub_type == 'html':
                base_dir = BASE_DIR+"www/"
            elif sub_type == 'javascript':
                base_dir = BASE_DIR+"static/"
            else:
                raise ValueError("Invalid MEME type: main_type={} sub_type={}".format(main_type,sub_type))
        elif main_type == 'image':
            base_dir = BASE_DIR+"static/"
            if sub_type == 'x-icon':
                base_dir += 'images/'
        elif main_type == 'application':
            base_dir = BASE_DIR+"static/"
        else:
            raise ValueError("Invalid MEME type: main_type={} sub_type={}".format(main_type,sub_type))

        return base_dir


    def build_content(self, path, base_dir):
        """
        Loads the objects file from storage space.
        Uses retry logic to handle transient I/O errors.

        :params path (str): relative path to the file.
        :params base_dir (str): base directory where the file is located.

        :rtype tuple: (int, bytes) representing content length and content data.
        """

        filepath = os.path.join(base_dir, path.lstrip('/'))

            #
            #  TODO: implement the step of fetch the object file
            #        store in the return value of content
            #

        def _read_file():
            with open(filepath, "rb") as f:
                return f.read()

        try:
            content = _retry_file_operation(_read_file, "build_content (read {})".format(filepath))
            return len(content), content
        except Exception as e:
            return -1, b""


    def build_response_header(self, request):
        """
        Constructs the HTTP response headers based on the class:`Request <Request>
        and internal attributes.

        :params request (class:`Request <Request>`): incoming request object.

        :rtypes bytes: encoded HTTP response header.
        """
        reqhdr = request.headers
        rsphdr = self.headers

        #Build dynamic headers
        headers = {
                "Accept": "{}".format(reqhdr.get("Accept", "application/json")),
                "Accept-Language": "{}".format(reqhdr.get("Accept-Language", "en-US,en;q=0.9")),
                "Authorization": "{}".format(reqhdr.get("Authorization", "Basic <credentials>")),
                "Cache-Control": "no-cache",
                "Content-Type": "{}".format(self.headers['Content-Type']),
                "Content-Length": "{}".format(len(self._content)),
        #       "Cookie": "{}".format(reqhdr.get("Cookie", "sessionid=xyz789")), #dummy cooki
        #
        # TODO prepare the request authentication
        #
        #       self.auth = ...
                "Date": "{}".format(datetime.datetime.utcnow().strftime("%a, %d %b %Y %H:%M:%S GMT")),
                "Max-Forward": "10",
                "Pragma": "no-cache",
                "Proxy-Authorization": "Basic dXNlcjpwYXNz",  # example base64
                "Warning": "199 Miscellaneous warning",
                "User-Agent": "{}".format(reqhdr.get("User-Agent", "Chrome/123.0.0.0")),
            } | rsphdr

        # Header text alignment
            #
            #  TODO: implement the header building to create formated
            #        header from the provied headers
            #
            #
            # TODO prepare the request authentication
            #
            # self.auth = ...
        fmt_header = ""
        for key in headers:
            fmt_header = f"{fmt_header}{key}: {headers[key]}\r\n"
        return str(fmt_header).encode('utf-8')


    def build_notfound(self):
        """
        Constructs a standard 404 Not Found HTTP response.

        :rtype bytes: Encoded 404 response.
        """

        return (
                "HTTP/1.1 404 Not Found\r\n"
                "Accept-Ranges: bytes\r\n"
                "Content-Type: text/html\r\n"
                "Content-Length: 13\r\n"
                "Cache-Control: max-age=86000\r\n"
                "Connection: close\r\n"
                "\r\n"
                "404 Not Found"
            ).encode('utf-8')


    def build_response(self, request, envelop_content=None):
        """
        Builds a full HTTP response including headers and content based on the request.

        :params request (class:`Request <Request>`): incoming request object.

        :rtype bytes: complete HTTP response using prepared headers and content.
        """
        # Check authentication first
        is_authenticated, should_redirect = self.check_authentication(request)
        
        # Handle redirect when user has session but tries to access login.html
        if hasattr(request, 'redirect_to') and request.redirect_to:
            redirect_url = request.redirect_to
            response_line = "HTTP/1.1 302 Found"
            headers = {
                "Location": redirect_url,
                "Content-Type": "text/html",
                "Content-Length": "0",
                "Cache-Control": "no-cache",
            }
            
            fmt_header = ""
            for key in headers:
                fmt_header = f"{fmt_header}{key}: {headers[key]}\r\n"
            
            return response_line.encode('utf-8') + '\r\n'.encode('utf-8') + fmt_header.encode('utf-8') + '\r\n'.encode('utf-8')
        
        if should_redirect:
            # Build redirect response
            redirect_url = "/login.html"
            response_line = "HTTP/1.1 302 Found"
            headers = {
                "Location": redirect_url,
                "Content-Type": "text/html",
                "Content-Length": "0",
                "Cache-Control": "no-cache",
            }
            
            fmt_header = ""
            for key in headers:
                fmt_header = f"{fmt_header}{key}: {headers[key]}\r\n"
            
            return response_line.encode('utf-8') + '\r\n'.encode('utf-8') + fmt_header.encode('utf-8') + '\r\n'.encode('utf-8')

        if envelop_content is not None:
            self._content = envelop_content.get('body','').encode('utf-8')
            self.headers = envelop_content.get('header',{})
            self.first_line = envelop_content.get('first_line',{})
            self.first_line = {"version": "HTTP/1.1", "code": 200, "reason": "OK"} | self.first_line
            self._first_line = f"{self.first_line['version']} {self.first_line['code']} {self.first_line['reason']}".encode('utf-8')
        else:
            path = request.path

            mime_type = self.get_mime_type(path)

            base_dir = ""

            #If HTML, parse and serve embedded objects
            if mime_type in ['text/html', 'text/css', 'image/png', 'image/jpg', 'application/json', 'image/x-icon', 'application/javascript', 'text/javascript']:
                base_dir = self.prepare_content_type(mime_type)
            else:
                return self.build_notfound()

            if path == '/login.html' and request.cookies:
                is_valid, login_username, _ = self.validate_session_cookie(request.cookies)
                self._len_content, raw_content = self.build_content(path, base_dir)
                if is_valid and login_username:
                    try:
                        content_text = raw_content.decode('utf-8')
                        safe_username = html.escape(login_username, quote=True)
                        content_text = content_text.replace(
                            '<input type="text" id="username" name="username" placeholder=" " autocomplete="off" required>',
                            f'<input type="text" id="username" name="username" placeholder=" " autocomplete="off" required value="{safe_username}">'
                        )
                        self._content = content_text.encode('utf-8')
                    except Exception:
                        self._content = raw_content
                else:
                    self._content = raw_content
                self._len_content = len(self._content)
            else:
                self._len_content, self._content = self.build_content(path, base_dir)
            self.headers['Content-Type'] = mime_type
            self.first_line = {"version": "HTTP/1.1", "code": 200, "reason": "OK"}
            self._first_line = f"{self.first_line['version']} {self.first_line['code']} {self.first_line['reason']}".encode('utf-8')
        
        self._header = self.build_response_header(request)

        # Add Set-Cookie header if session was created
        if request.session_id and not 'Set-Cookie' in self._header.decode('utf-8'):
            cookie_header = "Set-Cookie: sessionid={}; Path=/; HttpOnly\r\n".format(request.session_id)
            self._header = self._header + cookie_header.encode('utf-8')

        return self._first_line + '\r\n'.encode('utf-8') + self._header + '\r\n'.encode('utf-8') + self._content
