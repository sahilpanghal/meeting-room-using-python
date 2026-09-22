"""
Direct UDP Voice Client (Pure Python Socket Calling)
Streams local microphone input over UDP and plays incoming UDP audio packets.
Requires: pip install sounddevice numpy
"""

import socket
import sys
import threading

SAMPLE_RATE = 16000
CHANNELS = 1
CHUNK_SIZE = 1024

def run_udp_client(server_ip="127.0.0.1", server_port=5000):
    try:
        import sounddevice as sd
        import numpy as np
    except ImportError:
        print("[!] Error: sounddevice or numpy is not installed.")
        print("Install them by running: pip install sounddevice numpy")
        return

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.sendto(b"HELLO", (server_ip, server_port))

    stop_event = threading.Event()

    def audio_playback():
        with sd.OutputStream(samplerate=SAMPLE_RATE, channels=CHANNELS, dtype="int16", blocksize=CHUNK_SIZE) as stream:
            while not stop_event.is_set():
                try:
                    data, _ = sock.recvfrom(4096)
                    if data == b"HELLO":
                        continue
                    audio_array = np.frombuffer(data, dtype=np.int16)
                    stream.write(audio_array)
                except Exception as e:
                    if not stop_event.is_set():
                        print(f"Playback error: {e}")
                    break

    def audio_record_callback(indata, frames, time_info, status):
        if status:
            print(f"Input status: {status}")
        try:
            sock.sendto(indata.tobytes(), (server_ip, server_port))
        except Exception:
            pass

    playback_thread = threading.Thread(target=audio_playback, daemon=True)
    playback_thread.start()

    print("=" * 60)
    print(f"Connected to voice server at {server_ip}:{server_port}")
    print("Microphone streaming is active. Press Enter to exit.")
    print("=" * 60)

    try:
        with sd.InputStream(samplerate=SAMPLE_RATE, channels=CHANNELS, dtype="int16", blocksize=CHUNK_SIZE, callback=audio_record_callback):
            input()
    except KeyboardInterrupt:
        pass
    finally:
        stop_event.set()
        sock.close()
        print()
        print("Call disconnected.")

if __name__ == "__main__":
    ip = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 5000
    run_udp_client(ip, port)
