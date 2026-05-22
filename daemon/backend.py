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
daemon.backend
~~~~~~~~~~~~~~~~~

This module provides a backend object to manage and persist backend daemon. 
It implements a basic backend server using Python's socket and threading libraries.
It supports handling multiple client connections concurrently and routing requests using a
custom HTTP adapter.

Requirements:
--------------
- socket: provide socket networking interface.
- threading: Enables concurrent client handling via threads.
- response: response utilities.
- httpadapter: the class for handling HTTP requests.
- CaseInsensitiveDict: provides dictionary for managing headers or routes.


Notes:
------
- The server create daemon threads for client handling.
- The current implementation error handling is minimal, socket errors are printed to the console.
- The actual request processing is delegated to the HttpAdapter class.

Usage Example:
--------------
>>> create_backend("127.0.0.1", 9000, routes={})

"""

import socket
import threading
import argparse
import inspect
import select

from .response import *
from .httpadapter import HttpAdapter

# Supported backend modes.
mode_async = "coroutine"
# mode_async = "callback"
# mode_async = "threading"

def handle_client(ip, port, conn, addr, routes):
    """
    Initializes an HttpAdapter instance and delegates the client handling logic to it.

    :param ip (str): IP address of the server.
    :param port (int): Port number the server is listening on.
    :param conn (socket.socket): Client connection socket.
    :param addr (tuple): client address (IP, port).
    :param routes (dict): Dictionary of route handlers.
    """
    daemon = HttpAdapter(ip, port, conn, addr, routes)

    # Handle client
    daemon.handle_client(conn, addr, routes)


def handle_client_callback(conn, addr, routes, callback_map):
    """
    Handle a readable client socket using a callback-driven event loop.
    """
    callback_map.pop(conn, None)
    daemon = HttpAdapter(None, None, conn, addr, routes)
    daemon.handle_client(conn, addr, routes)


def handle_client_coroutine(conn, addr, routes):
    """
    Generator-based coroutine for handling client requests.
    """
    daemon = HttpAdapter(None, None, conn, addr, routes)
    req = daemon.request
    resp = daemon.response

    msg = yield ("read", conn, 2**16)
    if not msg:
        yield ("close", conn)
        return

    req.prepare(msg.decode("utf-8"), routes)
    if req.hook:
        response = resp.build_response(req, req.hook(req.headers, req.body))
    else:
        response = resp.build_response(req)

    yield ("write", conn, response)
    yield ("close", conn)


def run_callback_server(server, ip, port, routes):
    server.setblocking(False)
    callback_map = {}

    def accept_connection(sock):
        try:
            conn, addr = sock.accept()
        except BlockingIOError:
            return

        conn.setblocking(False)
        callback_map[conn] = lambda sock, addr=addr: handle_client_callback(sock, addr, routes, callback_map)

    callback_map[server] = accept_connection

    while True:
        readable, _, _ = select.select(list(callback_map.keys()), [], [])
        for sock in readable:
            callback_map[sock](sock)


def run_coroutine_server(server, ip, port, routes):
    server.setblocking(False)
    readers = {server: None}
    writers = {}

    def close_socket(sock):
        readers.pop(sock, None)
        writers.pop(sock, None)
        try:
            sock.close()
        except OSError:
            pass

    def register_event(event, coro):
        kind = event[0]
        sock = event[1] if len(event) > 1 else None
        payload = event[2] if len(event) > 2 else None
        if kind == "read":
            readers[sock] = coro
        elif kind == "write":
            writers[sock] = (coro, payload)
        elif kind == "close":
            close_socket(sock)

    def step_coro(coro, value=None):
        try:
            event = coro.send(value)
        except StopIteration:
            return
        register_event(event, coro)

    def accept_connection():
        try:
            conn, addr = server.accept()
        except BlockingIOError:
            return

        conn.setblocking(False)
        coro = handle_client_coroutine(conn, addr, routes)
        try:
            event = next(coro)
        except StopIteration:
            close_socket(conn)
            return
        register_event(event, coro)

    while True:
        read_sockets = [sock for sock in readers]
        write_sockets = [sock for sock in writers]
        readable, writable, _ = select.select(read_sockets, write_sockets, [])

        for sock in readable:
            if sock is server:
                accept_connection()
                continue

            coro = readers.pop(sock, None)
            if coro is None:
                continue

            try:
                data = sock.recv(2**16)
            except BlockingIOError:
                readers[sock] = coro
                continue
            step_coro(coro, data)

        for sock in writable:
            item = writers.pop(sock, None)
            if item is None:
                continue
            coro, buffer = item
            try:
                sent = sock.send(buffer)
            except BlockingIOError:
                writers[sock] = (coro, buffer)
                continue
            if sent < len(buffer):
                writers[sock] = (coro, buffer[sent:])
            else:
                step_coro(coro, None)


def run_backend(ip, port, routes):
    """
    Starts the backend server, binds to the specified IP and port, and listens for incoming
    connections. Each connection is handled in a separate thread. The backend accepts incoming
    connections and spawns a thread for each client.


    :param ip (str): IP address to bind the server.
    :param port (int): Port number to listen on.
    :param routes (dict): Dictionary of route handlers.
    """
    # This global variable to configure the asynchrnous mode or not
    global mode_async

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        server.bind((ip, port))
        server.listen(50)

        if mode_async == "callback":
            run_callback_server(server, ip, port, routes)
        elif mode_async == "coroutine":
            run_coroutine_server(server, ip, port, routes)
        else:
            while True:
                conn, addr = server.accept()
                client_thread = threading.Thread(target=handle_client, args=(ip, port, conn, addr, routes))
                client_thread.daemon = True
                client_thread.start()
                # handle_client(ip, port, conn, addr, routes)

    except socket.error as e:   
        print(e)
        pass

def create_backend(ip, port, routes={}):
    """
    Entry point for creating and running the backend server.

    :param ip (str): IP address to bind the server.
    :param port (int): Port number to listen on.
    :param routes (dict, optional): Dictionary of route handlers. Defaults to empty dict.
    """

    run_backend(ip, port, routes)