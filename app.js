/**
 * WebRTC Voice Calling Client (Supports Local Python Server, Remote Python Server, and PeerJS)
 */

// Configuration
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

// State
let ws = null;
let localStream = null;
let audioContext = null;
let localAnalyser = null;
let isMuted = false;
let isDeafened = false;
let callStartTime = null;
let timerInterval = null;

const peerId = 'peer_' + Math.random().toString(36).substring(2, 9);
let currentRoomId = null;
let displayName = 'User';

// peerId -> { pc: RTCPeerConnection, stream: MediaStream, card: HTMLElement, analyser: AnalyserNode }
const peers = new Map();

// DOM Elements
const connectionBadge = document.getElementById('connectionBadge');
const connectionText = document.getElementById('connectionText');
const roomIdInput = document.getElementById('roomIdInput');
const peerNameInput = document.getElementById('peerNameInput');
const serverUrlInput = document.getElementById('serverUrlInput');
const generateBtn = document.getElementById('generateBtn');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const shareLinkContainer = document.getElementById('shareLinkContainer');
const shareUrlInput = document.getElementById('shareUrlInput');
const copyUrlBtn = document.getElementById('copyUrlBtn');

const roomCard = document.getElementById('roomCard');
const callCard = document.getElementById('callCard');
const activeRoomTitle = document.getElementById('activeRoomTitle');
const callTimer = document.getElementById('callTimer');
const participantsGrid = document.getElementById('participantsGrid');
const remoteAudioContainer = document.getElementById('remoteAudioContainer');

const localDisplayName = document.getElementById('localDisplayName');
const localMicStatus = document.getElementById('localMicStatus');
const localVisualizer = document.getElementById('localVisualizer');
const localPulseRing = document.getElementById('localPulseRing');
const localParticipantCard = document.getElementById('localParticipantCard');

const toggleMicBtn = document.getElementById('toggleMicBtn');
const micIcon = document.getElementById('micIcon');
const micLabel = document.getElementById('micLabel');
const toggleDeafenBtn = document.getElementById('toggleDeafenBtn');
const deafenIcon = document.getElementById('deafenIcon');
const deafenLabel = document.getElementById('deafenLabel');
const shareCallBtn = document.getElementById('shareCallBtn');

// Initialize from URL parameters and localStorage
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const roomParam = params.get('room');
  if (roomParam) {
    roomIdInput.value = roomParam;
  }
  
  const savedServer = localStorage.getItem('pyvoice_server_url');
  if (savedServer && serverUrlInput) {
    serverUrlInput.value = savedServer;
  } else if (window.location.hostname.endsWith('github.io')) {
    // If running on GitHub Pages, auto-expand settings to inform user
    const details = document.querySelector('#serverConfigGroup details');
    if (details) details.open = true;
  }

  updateShareLink();
});

// Event Listeners
generateBtn.addEventListener('click', () => {
  const randomRoom = 'call-' + Math.random().toString(36).substring(2, 7);
  roomIdInput.value = randomRoom;
  updateShareLink();
});

roomIdInput.addEventListener('input', updateShareLink);

if (serverUrlInput) {
  serverUrlInput.addEventListener('change', () => {
    localStorage.setItem('pyvoice_server_url', serverUrlInput.value.trim());
  });
}

copyUrlBtn.addEventListener('click', () => copyToClipboard(shareUrlInput.value, copyUrlBtn));
shareCallBtn.addEventListener('click', () => {
  const fullUrl = getRoomUrl(currentRoomId);
  copyToClipboard(fullUrl, shareCallBtn);
});

joinBtn.addEventListener('click', joinCall);
leaveBtn.addEventListener('click', leaveCall);
toggleMicBtn.addEventListener('click', toggleMute);
toggleDeafenBtn.addEventListener('click', toggleDeafen);

// Keyboard Shortcuts
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'm' || e.key === 'M') {
    toggleMute();
  }
});

function getRoomUrl(roomId) {
  const loc = window.location;
  return `${loc.protocol}//${loc.host}${loc.pathname}?room=${encodeURIComponent(roomId || '')}`;
}

function updateShareLink() {
  const roomVal = roomIdInput.value.trim();
  if (roomVal) {
    shareUrlInput.value = getRoomUrl(roomVal);
    shareLinkContainer.classList.remove('hidden');
  } else {
    shareLinkContainer.classList.add('hidden');
  }
}

function copyToClipboard(text, btnElement) {
  navigator.clipboard.writeText(text).then(() => {
    const originalText = btnElement.innerText;
    btnElement.innerText = 'Copied!';
    setTimeout(() => {
      btnElement.innerText = originalText;
    }, 2000);
  });
}

function setConnectionStatus(status, text) {
  connectionBadge.className = 'connection-badge ' + status;
  connectionText.textContent = text;
}

// ---------------- WebSocket Signaling ---------------- //

function getSignalingUrl() {
  const manualUrl = serverUrlInput ? serverUrlInput.value.trim() : '';
  if (manualUrl) {
    return manualUrl;
  }
  
  // Default: derive from current page host
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

function initWebSocket() {
  return new Promise((resolve, reject) => {
    const wsUrl = getSignalingUrl();
    console.log('Connecting to signaling server at:', wsUrl);

    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      reject(e);
      return;
    }

    ws.onopen = () => {
      setConnectionStatus('connected', 'Connected');
      resolve();
    };

    ws.onerror = (err) => {
      setConnectionStatus('error', 'Signaling Error');
      reject(err);
    };

    ws.onclose = () => {
      setConnectionStatus('', 'Disconnected');
      if (currentRoomId) {
        leaveCall();
      }
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        await handleSignalingMessage(msg);
      } catch (err) {
        console.error('Failed to parse signaling message:', err);
      }
    };
  });
}

async function handleSignalingMessage(msg) {
  switch (msg.type) {
    case 'room-joined':
      console.log(`Joined room: ${msg.roomId}, existing peers:`, msg.existingPeers);
      for (const remotePeerId of msg.existingPeers) {
        await createPeerConnection(remotePeerId, true);
      }
      break;

    case 'peer-joined':
      console.log(`Peer joined: ${msg.peerId}`);
      await createPeerConnection(msg.peerId, false);
      break;

    case 'peer-left':
      console.log(`Peer left: ${msg.peerId}`);
      removePeer(msg.peerId);
      break;

    case 'signal':
      await handlePeerSignal(msg.sender, msg.data);
      break;
  }
}

function sendSignal(targetPeerId, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'signal',
      target: targetPeerId,
      data: data
    }));
  }
}

// ---------------- WebRTC Connections ---------------- //

async function createPeerConnection(remotePeerId, isInitiator) {
  if (peers.has(remotePeerId)) return peers.get(remotePeerId).pc;

  const pc = new RTCPeerConnection(RTC_CONFIG);

  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal(remotePeerId, { candidate: event.candidate });
    }
  };

  pc.ontrack = (event) => {
    console.log(`Received remote track from ${remotePeerId}`);
    const remoteStream = event.streams[0];
    setupRemoteAudio(remotePeerId, remoteStream);
  };

  pc.onconnectionstatechange = () => {
    console.log(`[${remotePeerId}] Connection state: ${pc.connectionState}`);
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      removePeer(remotePeerId);
    }
  };

  const card = createRemoteParticipantCard(remotePeerId);
  participantsGrid.appendChild(card);

  peers.set(remotePeerId, { pc, card, stream: null, analyser: null });

  if (isInitiator) {
    try {
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      sendSignal(remotePeerId, { sdp: pc.localDescription });
    } catch (err) {
      console.error('Error creating offer:', err);
    }
  }

  return pc;
}

async function handlePeerSignal(senderId, data) {
  let peerObj = peers.get(senderId);
  if (!peerObj) {
    await createPeerConnection(senderId, false);
    peerObj = peers.get(senderId);
  }

  const pc = peerObj.pc;

  if (data.sdp) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    if (data.sdp.type === 'offer') {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal(senderId, { sdp: pc.localDescription });
    }
  } else if (data.candidate) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (e) {
      console.error('Error adding ICE candidate:', e);
    }
  }
}

function setupRemoteAudio(remotePeerId, stream) {
  const peerObj = peers.get(remotePeerId);
  if (!peerObj) return;

  peerObj.stream = stream;

  let audioEl = document.getElementById(`audio-${remotePeerId}`);
  if (!audioEl) {
    audioEl = document.createElement('audio');
    audioEl.id = `audio-${remotePeerId}`;
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    remoteAudioContainer.appendChild(audioEl);
  }
  audioEl.srcObject = stream;
  audioEl.muted = isDeafened;

  if (audioContext) {
    try {
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      peerObj.analyser = analyser;

      const canvas = peerObj.card.querySelector('canvas');
      const pulseRing = peerObj.card.querySelector('.pulse-ring');
      if (canvas && pulseRing) {
        startVisualizer(analyser, canvas, pulseRing, peerObj.card);
      }
    } catch (err) {
      console.warn('Could not attach remote audio analyser:', err);
    }
  }
}

function removePeer(remotePeerId) {
  const peerObj = peers.get(remotePeerId);
  if (peerObj) {
    try {
      peerObj.pc.close();
    } catch (e) {}
    if (peerObj.card && peerObj.card.parentNode) {
      peerObj.card.parentNode.removeChild(peerObj.card);
    }
    peers.delete(remotePeerId);
  }

  const audioEl = document.getElementById(`audio-${remotePeerId}`);
  if (audioEl && audioEl.parentNode) {
    audioEl.parentNode.removeChild(audioEl);
  }
}

// ---------------- UI & Audio Controls ---------------- //

async function joinCall() {
  const roomId = roomIdInput.value.trim();
  if (!roomId) {
    alert('Please enter or generate a Room ID.');
    roomIdInput.focus();
    return;
  }

  currentRoomId = roomId;
  displayName = peerNameInput.value.trim() || 'You';
  localDisplayName.textContent = `${displayName} (Host)`;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
  } catch (err) {
    alert('Could not access microphone: ' + err.message);
    return;
  }

  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    const source = audioContext.createMediaStreamSource(localStream);
    localAnalyser = audioContext.createAnalyser();
    localAnalyser.fftSize = 64;
    source.connect(localAnalyser);
    startVisualizer(localAnalyser, localVisualizer, localPulseRing, localParticipantCard);
  } catch (err) {
    console.warn('AudioContext visualization setup failed:', err);
  }

  // Connect to Signaling Server
  try {
    await initWebSocket();
    ws.send(JSON.stringify({
      type: 'join',
      roomId: currentRoomId,
      peerId: peerId
    }));
  } catch (err) {
    if (window.location.hostname.endsWith('github.io')) {
      alert(
        'GitHub Pages only hosts static files and cannot run the Python signaling server.

' +
        'To use voice calling from GitHub Pages:
' +
        '1. Deploy server.py to a free service like Render.com, Fly.io, or run it locally with ngrok.
' +
        '2. Enter your server URL in "Server Settings" (e.g. wss://your-server.onrender.com/ws).'
      );
    } else {
      alert('Failed to connect to signaling server. Make sure "python3 server.py" is running.');
    }
    leaveCall();
    return;
  }

  roomCard.classList.add('hidden');
  callCard.classList.remove('hidden');
  activeRoomTitle.textContent = `Room: ${currentRoomId}`;
  setConnectionStatus('in-call', `Calling in ${currentRoomId}`);

  startTimer();
}

function leaveCall() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }

  peers.forEach((peerObj, pId) => {
    try {
      peerObj.pc.close();
    } catch (e) {}
    if (peerObj.card && peerObj.card.parentNode) {
      peerObj.card.parentNode.removeChild(peerObj.card);
    }
  });
  peers.clear();
  remoteAudioContainer.innerHTML = '';

  if (ws) {
    ws.close();
    ws = null;
  }

  stopTimer();

  currentRoomId = null;
  isMuted = false;
  isDeafened = false;
  updateMuteUI();

  roomCard.classList.remove('hidden');
  callCard.classList.add('hidden');
  setConnectionStatus('', 'Ready');
}

function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(track => {
    track.enabled = !isMuted;
  });
  updateMuteUI();
}

function updateMuteUI() {
  if (isMuted) {
    toggleMicBtn.classList.remove('btn-active');
    toggleMicBtn.classList.add('muted');
    micIcon.textContent = '🔇';
    micLabel.textContent = 'Unmute';
    localMicStatus.textContent = 'Microphone Muted';
    localMicStatus.style.color = 'var(--danger-color)';
  } else {
    toggleMicBtn.classList.add('btn-active');
    toggleMicBtn.classList.remove('muted');
    micIcon.textContent = '🎤';
    micLabel.textContent = 'Mute';
    localMicStatus.textContent = 'Microphone Active';
    localMicStatus.style.color = 'var(--text-secondary)';
  }
}

function toggleDeafen() {
  isDeafened = !isDeafened;
  const audioElements = remoteAudioContainer.querySelectorAll('audio');
  audioElements.forEach(a => a.muted = isDeafened);

  if (isDeafened) {
    toggleDeafenBtn.classList.add('muted');
    deafenIcon.textContent = '🔇';
    deafenLabel.textContent = 'Undeafen';
  } else {
    toggleDeafenBtn.classList.remove('muted');
    deafenIcon.textContent = '🔊';
    deafenLabel.textContent = 'Deafen';
  }
}

// ---------------- Visualizer & Cards ---------------- //

function createRemoteParticipantCard(remotePeerId) {
  const card = document.createElement('div');
  card.className = 'participant-card remote-card';
  card.id = `participant-${remotePeerId}`;

  const shortName = 'Guest ' + remotePeerId.substring(5, 9);

  card.innerHTML = `
    <div class="avatar-wrapper">
      <div class="avatar">${shortName.charAt(0)}</div>
      <div class="pulse-ring"></div>
    </div>
    <div class="participant-info">
      <span class="participant-name">${shortName}</span>
      <span class="participant-status">Connected</span>
    </div>
    <canvas class="audio-canvas" width="220" height="40"></canvas>
  `;
  return card;
}

function startVisualizer(analyser, canvas, pulseRing, cardElement) {
  const ctx = canvas.getContext('2d');
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function draw() {
    if (!currentRoomId) return;

    requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += dataArray[i];
    }
    const average = sum / bufferLength;

    const isSpeaking = average > 14;
    if (isSpeaking) {
      cardElement.classList.add('is-speaking');
    } else {
      cardElement.classList.remove('is-speaking');
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const barWidth = (canvas.width / bufferLength) * 2;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * canvas.height;
      ctx.fillStyle = isSpeaking ? '#22c55e' : '#38bdf8';
      ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
      x += barWidth;
    }
  }

  draw();
}

// ---------------- Timer ---------------- //

function startTimer() {
  callStartTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    callTimer.textContent = `${mins}:${secs}`;
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  callTimer.textContent = '00:00';
}
