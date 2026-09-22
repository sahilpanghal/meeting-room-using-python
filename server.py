"""
Internet Calling - Lightweight WebRTC Signaling & Web Server
Runs on Python 3.9+ with ZERO external dependencies.
"""

import asyncio
import base64
import hashlib
import json
import mimetypes
import os
import socket
import sys
from typing import Dict, Set

WS_MAGIC_STRING = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

CRLF = "\x0d\x0a"
CRLF_B = b"\x0d\x0a"
DOUBLE_CRLF_B = b"\x0d\x0a\x0d\x0a"

class WebSocketClient:
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self.reader = reader
        self.writer = writer
        self.peer_id = None
        self.room_id = None
        self.closed = False

    async def send_text(self, message: str):
        if self.closed:
            return
        payload = message.encode("utf-8")
        length = len(payload)
        header = bytearray([0x81])  # FIN + Text Opcode
        if length <= 125:
            header.append(length)
        elif length <= 65535:
            header.append(126)
            header.extend(length.to_bytes(2, byteorder="big"))
        else:
            header.append(127)
            header.extend(length.to_bytes(8, byteorder="big"))
        
        try:
            self.writer.write(bytes(header) + payload)
            await self.writer.drain()
        except Exception:
            self.closed = True

    async def send_json(self, data: dict):
        await self.send_text(json.dumps(data))

    async def read_frame(self):
        try:
            first_two = await self.reader.readexactly(2)
        except (asyncio.IncompleteReadError, ConnectionResetError):
            return None, None

        fin = (first_two[0] & 0x80) != 0
        opcode = first_two[0] & 0x0F
        has_mask = (first_two[1] & 0x80) != 0
        payload_len = first_two[1] & 0x7F

        if payload_len == 126:
            ext_len = await self.reader.readexactly(2)
            payload_len = int.from_bytes(ext_len, byteorder="big")
        elif payload_len == 127:
            ext_len = await self.reader.readexactly(8)
            payload_len = int.from_bytes(ext_len, byteorder="big")

        mask = None
        if has_mask:
            mask = await self.reader.readexactly(4)

        try:
            payload = await self.reader.readexactly(payload_len)
        except (asyncio.IncompleteReadError, ConnectionResetError):
            return None, None

        if has_mask and mask:
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))

        return opcode, payload

    async def close(self):
        if not self.closed:
            self.closed = True
            try:
                self.writer.write(bytes([0x88, 0x00]))
                await self.writer.drain()
                self.writer.close()
                await self.writer.wait_closed()
            except Exception:
                pass


class SignalingServer:
    def __init__(self, static_dir: str):
        self.static_dir = static_dir
        self.rooms: Dict[str, Dict[str, WebSocketClient]] = {}

    def get_local_ip(self) -> str:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
        except Exception:
            ip = "127.0.0.1"
        finally:
            s.close()
        return ip

    async def handle_connection(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        try:
            request_line = await reader.readline()
            if not request_line:
                writer.close()
                return

            req_parts = request_line.decode("utf-8", errors="ignore").strip().split()
            if len(req_parts) < 2:
                writer.close()
                return

            method, path = req_parts[0], req_parts[1]
            headers = {}
            while True:
                line = await reader.readline()
                if not line or line.strip() == b"":
                    break
                decoded_line = line.decode("utf-8", errors="ignore").strip()
                if ":" in decoded_line:
                    k, v = decoded_line.split(":", 1)
                    headers[k.strip().lower()] = v.strip()

            if headers.get("upgrade", "").lower() == "websocket":
                await self.handle_websocket_upgrade(reader, writer, headers, path)
            else:
                await self.serve_http(writer, method, path)
        except Exception:
            try:
                writer.close()
            except Exception:
                pass

    async def handle_websocket_upgrade(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter, headers: dict, path: str):
        sec_key = headers.get("sec-websocket-key")
        if not sec_key:
            writer.write(b"HTTP/1.1 400 Bad Request" + DOUBLE_CRLF_B)
            await writer.drain()
            writer.close()
            return

        accept_val = base64.b64encode(hashlib.sha1((sec_key + WS_MAGIC_STRING).encode()).digest()).decode()
        response = (
            "HTTP/1.1 101 Switching Protocols" + CRLLF if False else (
                f"HTTP/1.1 101 Switching Protocols{CRLF}"
                f"Upgrade: websocket{CRLF}"
                f"Connection: Upgrade{CRLF}"
                f"Sec-WebSocket-Accept: {accept_val}{CRLF}{CRLF}"
            )
        )
        writer.write(response.encode("utf-8"))
        await writer.drain()

        client = WebSocketClient(reader, writer)
        await self.run_client_loop(client)

    async def run_client_loop(self, client: WebSocketClient):
        try:
            while not client.closed:
                opcode, payload = await client.read_frame()
                if opcode is None or opcode == 0x08:  # Connection closed
                    break
                elif opcode == 0x09:  # Ping
                    client.writer.write(bytes([0x8A, 0x00]))
                    await client.writer.drain()
                elif opcode == 0x01:  # Text frame
                    try:
                        data = json.loads(payload.decode("utf-8"))
                        await self.handle_message(client, data)
                    except Exception as err:
                        print(f"[Warn] Malformed message: {err}")
        finally:
            await self.remove_client(client)
            await client.close()

    async def handle_message(self, client: WebSocketClient, msg: dict):
        msg_type = msg.get("type")
        room_id = msg.get("roomId", "").strip()
        peer_id = msg.get("peerId", "").strip()

        if msg_type == "join":
            if not room_id or not peer_id:
                return

            client.room_id = room_id
            client.peer_id = peer_id

            if room_id not in self.rooms:
                self.rooms[room_id] = {}

            room = self.rooms[room_id]
            existing_peer_ids = list(room.keys())
            await client.send_json({
                "type": "room-joined",
                "roomId": room_id,
                "peerId": peer_id,
                "existingPeers": existing_peer_ids
            })

            for other_id, other_client in room.items():
                await other_client.send_json({
                    "type": "peer-joined",
                    "peerId": peer_id
                })

            room[peer_id] = client
            print(f"[Room {room_id}] Peer joined: {peer_id} (Total peers: {len(room)})")

        elif msg_type == "signal":
            target_peer = msg.get("target")
            if client.room_id and client.room_id in self.rooms:
                room = self.rooms[client.room_id]
                if target_peer in room:
                    await room[target_peer].send_json({
                        "type": "signal",
                        "sender": client.peer_id,
                        "data": msg.get("data")
                    })

        elif msg_type == "leave":
            await self.remove_client(client)

    async def remove_client(self, client: WebSocketClient):
        room_id = client.room_id
        peer_id = client.peer_id

        if room_id and room_id in self.rooms:
            room = self.rooms[room_id]
            if peer_id in room:
                del room[peer_id]
                print(f"[Room {room_id}] Peer left: {peer_id} (Remaining: {len(room)})")
                for other_client in room.values():
                    await other_client.send_json({
                        "type": "peer-left",
                        "peerId": peer_id
                    })
            if len(room) == 0:
                del self.rooms[room_id]

    async def serve_http(self, writer: asyncio.StreamWriter, method: str, path: str):
        if method != "GET" and method != "HEAD":
            writer.write(b"HTTP/1.1 405 Method Not Allowed" + DOUBLE_CRLF_B)
            await writer.drain()
            writer.close()
            return

        clean_path = path.split("?")[0].lstrip("/")
        if clean_path == "" or clean_path == "index.html":
            file_path = os.path.join(self.static_dir, "index.html")
        else:
            file_path = os.path.join(self.static_dir, clean_path)

        file_path = os.path.abspath(file_path)
        if not file_path.startswith(os.path.abspath(self.static_dir)):
            writer.write(b"HTTP/1.1 403 Forbidden" + DOUBLE_CRLF_B + b"Access Denied")
            await writer.drain()
            writer.close()
            return

        if not os.path.exists(file_path) or os.path.isdir(file_path):
            writer.write(b"HTTP/1.1 404 Not Found" + DOUBLE_CRLF_B + b"File Not Found")
            await writer.drain()
            writer.close()
            return

        mime_type, _ = mimetypes.guess_type(file_path)
        if not mime_type:
            mime_type = "application/octet-stream"

        try:
            with open(file_path, "rb") as f:
                content = f.read()

            header = (
                f"HTTP/1.1 200 OK{CRLF}"
                f"Content-Type: {mime_type}{CRLF}"
                f"Content-Length: {len(content)}{CRLF}"
                f"Access-Control-Allow-Origin: *{CRLF}"
                f"Cache-Control: no-cache{CRLF}{CRLF}"
            )
            writer.write(header.encode("utf-8") + (content if method == "GET" else b""))
            await writer.drain()
        except Exception:
            writer.write(b"HTTP/1.1 500 Internal Server Error" + DOUBLE_CRLF_B)
            await writer.drain()
        finally:
            writer.close()


async def main(host: str = "0.0.0.0", port: int = 8000):
    base_dir = os.path.dirname(os.path.abspath(__file__))
    static_dir = os.path.join(base_dir, "static")
    os.makedirs(static_dir, exist_ok=True)

    server = SignalingServer(static_dir=static_dir)
    local_ip = server.get_local_ip()

    async def client_connected(reader, writer):
        await server.handle_connection(reader, writer)

    app_server = await asyncio.start_server(client_connected, host, port)

    print("=" * 64)
    print(" [PyVoice] Python Internet Calling Server Running")
    print("=" * 64)
    print(f" * Local URL:   http://localhost:{port}")
    print(f" * Network URL: http://{local_ip}:{port}")
    print(" * Press Ctrl+C to stop.")
    print("=" * 64)

    async with app_server:
        await app_server.serve_forever()


if __name__ == "__main__":
    port = 8000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    try:
        asyncio.run(main(port=port))
    except KeyboardInterrupt:
        print()
        print("[Server Stopped]")
