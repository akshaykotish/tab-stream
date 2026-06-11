// tab-stream — WebRTC signaling + dashboard server
// One broadcaster (shares a tab/screen) -> many viewers, all over your LAN by IP.

const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;        // HTTP — viewers
const HTTPS_PORT = process.env.HTTPS_PORT || 3443; // HTTPS — broadcaster (screen capture needs a secure context)

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// HTTP server (viewers only need this).
const server = http.createServer(app);

// Optional HTTPS server so the broadcaster page works from any device/IP, not just localhost.
let httpsServer = null;
const keyPath = path.join(__dirname, 'certs', 'key.pem');
const certPath = path.join(__dirname, 'certs', 'cert.pem');
if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  httpsServer = https.createServer(
    { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
    app
  );
}

// One signaling layer shared across both HTTP and HTTPS connections.
const wss = new WebSocketServer({ noServer: true });
function upgrade(req, socket, head) {
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
}
server.on('upgrade', upgrade);
if (httpsServer) httpsServer.on('upgrade', upgrade);

// In-memory room state. A "room" is a stream id (default "main").
// Each room has at most one broadcaster and any number of viewers.
const rooms = new Map(); // roomId -> { broadcaster: ws|null, viewers: Map<id, ws> }

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, { broadcaster: null, viewers: new Map() });
  return rooms.get(roomId);
}

let nextId = 1;

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

wss.on('connection', (ws) => {
  ws.id = String(nextId++);
  ws.role = null;
  ws.roomId = null;

  send(ws, { type: 'welcome', id: ws.id });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const roomId = msg.room || 'main';

    switch (msg.type) {
      case 'broadcaster': {
        ws.role = 'broadcaster';
        ws.roomId = roomId;
        const room = getRoom(roomId);
        // Replace any previous broadcaster.
        if (room.broadcaster && room.broadcaster !== ws) {
          send(room.broadcaster, { type: 'replaced' });
        }
        room.broadcaster = ws;
        // Tell broadcaster about already-waiting viewers so it can offer to them.
        for (const viewerId of room.viewers.keys()) {
          send(ws, { type: 'viewer-join', viewerId });
        }
        broadcastViewerCount(roomId);
        break;
      }

      case 'viewer': {
        ws.role = 'viewer';
        ws.roomId = roomId;
        const room = getRoom(roomId);
        room.viewers.set(ws.id, ws);
        // Ask the broadcaster (if any) to start a peer connection to this viewer.
        if (room.broadcaster) {
          send(room.broadcaster, { type: 'viewer-join', viewerId: ws.id });
          send(ws, { type: 'broadcaster-online' });
        } else {
          send(ws, { type: 'broadcaster-offline' });
        }
        broadcastViewerCount(roomId);
        break;
      }

      // Broadcaster -> viewer offer
      case 'offer': {
        const room = getRoom(roomId);
        const viewer = room.viewers.get(msg.viewerId);
        send(viewer, { type: 'offer', sdp: msg.sdp });
        break;
      }

      // Viewer -> broadcaster answer
      case 'answer': {
        const room = getRoom(roomId);
        send(room.broadcaster, { type: 'answer', sdp: msg.sdp, viewerId: ws.id });
        break;
      }

      // ICE candidates relayed in both directions
      case 'ice': {
        const room = getRoom(roomId);
        if (ws.role === 'broadcaster') {
          send(room.viewers.get(msg.viewerId), { type: 'ice', candidate: msg.candidate });
        } else {
          send(room.broadcaster, { type: 'ice', candidate: msg.candidate, viewerId: ws.id });
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!ws.roomId) return;
    const room = rooms.get(ws.roomId);
    if (!room) return;

    if (ws.role === 'broadcaster' && room.broadcaster === ws) {
      room.broadcaster = null;
      for (const viewer of room.viewers.values()) {
        send(viewer, { type: 'broadcaster-offline' });
      }
    } else if (ws.role === 'viewer') {
      room.viewers.delete(ws.id);
      if (room.broadcaster) send(room.broadcaster, { type: 'viewer-leave', viewerId: ws.id });
    }
    broadcastViewerCount(ws.roomId);
  });
});

function broadcastViewerCount(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const count = room.viewers.size;
  send(room.broadcaster, { type: 'viewers', count });
}

function localIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

server.listen(PORT, '0.0.0.0', () => {
  const ips = localIPs();
  console.log('\n  tab-stream is running\n');

  console.log('  Broadcast (share your tab/screen) — needs a secure context:');
  console.log(`    http://localhost:${PORT}/            (works on THIS machine only)`);
  if (httpsServer) {
    for (const ip of ips) console.log(`    https://${ip}:${HTTPS_PORT}/          (any device — accept the cert warning once)`);
  } else {
    console.log('    (no certs/ found — HTTPS disabled; broadcast only from localhost)');
  }

  console.log('\n  Watch (open on any device on the same network):');
  for (const ip of ips) console.log(`    http://${ip}:${PORT}/view.html`);
  if (ips.length === 0) console.log(`    http://localhost:${PORT}/view.html`);
  console.log('');
});

if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    /* logged above */
  });
}
