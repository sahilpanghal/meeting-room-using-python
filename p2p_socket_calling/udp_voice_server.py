"""
Direct UDP Voice Server (Pure Python Socket Calling)
Relays raw UDP audio packets between connected clients on a local network or direct IP.
"""

import socket
import sys

def run_udp_server(host="0.0.0.0", port=5000):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((host, port))
    
    clients = set()
    print("=" * 60)
    print(f"UDP Audio Relay Server listening on {host}:{port}")
    print("=" * 60)
    print("Waiting for client audio streams... Press Ctrl+C to exit.")

    try:
        while True:
            data, addr = sock.recvfrom(4096)
            if addr not in clients:
                clients.add(addr)
                print(f"[+] New client connected: {addr} (Total clients: {len(clients)})")

            for client_addr in list(clients):
                if client_addr != addr:
                    try:
                        sock.sendto(data, client_addr)
                    except Exception as e:
                        print(f"[-] Dropping unreachable client {client_addr}: {e}")
                        clients.remove(client_addr)
    except KeyboardInterrupt:
        print()
        print("Server shutting down.")
    finally:
        sock.close()

if __name__ == "__main__":
    port = 5000
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    run_udp_server(port=port)
