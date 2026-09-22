# 📞 Python Internet Voice Calling (PyVoice)

A real-time, peer-to-peer internet voice calling application powered by **Python** and **WebRTC**.

---

## ✨ Features

- **Zero-Dependency Python Backend**: The signaling and web server (`server.py`) runs out-of-the-box using only Python's standard library (`asyncio`, `socket`, `json`, `hashlib`, `mimetypes`). No complex installations or C-compiler issues.
- **Crystal Clear Audio**: Leverages browser-native WebRTC audio processing, including Acoustic Echo Cancellation (AEC), Noise Suppression, and Automatic Gain Control (AGC) using the Opus codec.
- **Cross-Platform**: Works across Mac, Windows, Linux, Android, and iOS browsers.
- **Local Network & Internet Calling**: Supports peer discovery and NAT traversal via public Google STUN servers (`stun:stun.l.google.com:19302`).
- **Interactive UI**:
  - Room generation and shareable invite links (`?room=XYZ`).
  - Real-time live audio visualizer waveform on HTML5 Canvas.
  - Active speaking indicator ring for all connected peers.
  - Mute/Unmute microphone (keyboard shortcut: `M`).
  - Deafen toggle to silence incoming audio.
  - Call timer and live connection status badges.
- **Bonus CLI Socket Client/Server**: Includes raw UDP socket scripts in `p2p_socket_calling/` for learning low-level socket audio streaming.

---

## 🚀 Quick Start (WebRTC Internet Calling)

### 1. Start the Python Server
Open your terminal and run:

```bash
cd "/Users/sahilpanghal/Documents/ai coding/internet_calling"
python3 server.py
```

The server will display:
```text
================================================================
 🚀 Python Internet Calling (WebRTC Signaling & App Server)
================================================================
 • Local Web Link:          http://localhost:8000
 • Network (Other Devices): http://192.168.1.X:8000
 • Press Ctrl+C to stop the server.
================================================================
```

### 2. Connect Your Devices
1. On your computer, open **`http://localhost:8000`** in Chrome, Safari, Firefox, or Edge.
2. Grant microphone permissions when prompted.
3. Enter or generate a **Room Name** (e.g., `team-call`) and click **Join Voice Call**.
4. Open the **Network URL** (e.g. `http://192.168.1.X:8000?room=team-call`) on another phone or computer connected to the same Wi-Fi or hotspot.
5. Click **Join Voice Call** on the second device. Both devices are now connected in a live two-way voice call!

---

## 🌐 Calling Over the Public Internet

To call someone outside your local Wi-Fi network, you can expose the local port `8000` using any free tunneling utility (e.g., Cloudflare Tunnel, ngrok, or Tailscale):

```bash
# Example with Cloudflare Tunnel (no account required)
cloudflared tunnel --url http://localhost:8000

# Or with ngrok
ngrok http 8000
```
Share the resulting secure `https://...` link with your friend or colleague anywhere in the world. WebRTC handles the direct media connection through STUN.

---

## 🛠️ Project Structure

```
internet_calling/
├── server.py                       # Async Python HTTP & WebSocket Signaling Server
├── static/
│   ├── index.html                  # Responsive Web Calling UI
│   ├── style.css                   # Modern dark mode interface
│   └── app.js                      # WebRTC peer connection & AudioContext visualizer
├── p2p_socket_calling/             # Low-level UDP socket demo
│   ├── udp_voice_server.py         # Relays raw UDP audio packets
│   └── udp_voice_client.py         # Terminal microphone streamer
├── requirements.txt                # Dependency documentation
└── README.md                       # Documentation & guide
```

---

## 📻 Low-Level UDP Socket Calling (CLI Experiment)

For terminal-to-terminal voice streaming over UDP sockets:

1. Install optional audio dependencies:
   ```bash
   pip install sounddevice numpy
   ```
2. Start the UDP audio relay server:
   ```bash
   python3 p2p_socket_calling/udp_voice_server.py 5000
   ```
3. Start the client on each machine:
   ```bash
   python3 p2p_socket_calling/udp_voice_client.py <SERVER_IP> 5000
   ```
