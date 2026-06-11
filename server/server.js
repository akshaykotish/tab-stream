// tab-stream — WebRTC signaling + dashboard server
// One broadcaster (shares a tab/screen) -> many viewers, all over your LAN by IP.

const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn, spawnSync } = require('child_process');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;        // HTTP — viewers
const HTTPS_PORT = process.env.HTTPS_PORT || 3443; // HTTPS — broadcaster (screen capture needs a secure context)

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// File mode — stream local video files (mp4/mkv/avi/...) with HTTP range so the
// viewer can pre-buffer and play at full original quality.
// ---------------------------------------------------------------------------
// When packaged as a standalone binary, files live next to the executable, not in the
// read-only snapshot (__dirname). Use the real directory for media/ and certs/.
const BASE_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;

const MEDIA_DIR = path.join(BASE_DIR, 'media');
try { fs.mkdirSync(MEDIA_DIR, { recursive: true }); } catch {}

const HAS_FFMPEG = (() => {
  try { return spawnSync('ffmpeg', ['-version']).status === 0; } catch { return false; }
})();

const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.ogv', '.ogg', '.mov', '.mkv', '.avi', '.flv', '.wmv', '.ts', '.mpg', '.mpeg']);
const NATIVE = new Set(['.mp4', '.m4v', '.webm', '.ogv', '.ogg', '.mov']); // browser-playable as-is
const MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.ogv': 'video/ogg', '.ogg': 'video/ogg' };

// List available media files.
app.get('/api/files', (req, res) => {
  let names = [];
  try { names = fs.readdirSync(MEDIA_DIR); } catch {}
  const files = names
    .filter(n => VIDEO_EXT.has(path.extname(n).toLowerCase()))
    .map(n => {
      const ext = path.extname(n).toLowerCase();
      let size = 0; try { size = fs.statSync(path.join(MEDIA_DIR, n)).size; } catch {}
      return { name: n, ext, size, native: NATIVE.has(ext), needsFfmpeg: !NATIVE.has(ext) };
    });
  res.json({ ffmpeg: HAS_FFMPEG, files });
});

// Upload a file from the dashboard (raw body PUT — no extra deps).
app.put('/api/upload/:name', (req, res) => {
  const name = path.basename(req.params.name);
  if (!VIDEO_EXT.has(path.extname(name).toLowerCase())) return res.status(400).json({ error: 'unsupported type' });
  const dest = path.join(MEDIA_DIR, name);
  const out = fs.createWriteStream(dest);
  req.pipe(out);
  out.on('finish', () => res.json({ ok: true, name }));
  out.on('error', () => res.status(500).json({ error: 'write failed' }));
});

// Stream a media file: native ones with byte-range (seek/pre-buffer), others remuxed via ffmpeg.
app.get('/media/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(MEDIA_DIR, name);
  if (!fs.existsSync(file)) return res.sendStatus(404);
  const ext = path.extname(name).toLowerCase();

  if (NATIVE.has(ext)) {
    const total = fs.statSync(file).size;
    const type = MIME[ext] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : total - 1;
      if (isNaN(start) || isNaN(end) || start > end || start >= total) {
        return res.status(416).set('Content-Range', `bytes */${total}`).end();
      }
      res.status(206).set({
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': type,
      });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.status(200).set({ 'Content-Length': total, 'Accept-Ranges': 'bytes', 'Content-Type': type });
      fs.createReadStream(file).pipe(res);
    }
    return;
  }

  // Non-native (mkv/avi/...) — remux to fragmented MP4 on the fly (lossless video copy, audio -> aac).
  if (!HAS_FFMPEG) return res.status(415).send('ffmpeg required to play ' + ext);
  res.status(200).set({ 'Content-Type': 'video/mp4' });
  const ff = spawn('ffmpeg', [
    '-i', file,
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4', 'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'ignore'] });
  ff.stdout.pipe(res);
  const kill = () => { try { ff.kill('SIGKILL'); } catch {} };
  req.on('close', kill);
  res.on('close', kill);
});

// HTTP server (viewers only need this).
const server = http.createServer(app);

// Optional HTTPS server so the broadcaster page works from any device/IP, not just localhost.
let httpsServer = null;
const keyPath = path.join(BASE_DIR, 'certs', 'key.pem');
const certPath = path.join(BASE_DIR, 'certs', 'cert.pem');
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
        // If a file is currently playing to the room, start this viewer on it immediately.
        if (room.file) {
          send(ws, { type: 'file', url: room.file.url, name: room.file.name, bufferSeconds: room.file.bufferSeconds });
        }
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

      // Broadcaster tells viewers to play a local file (buffered, full quality).
      case 'file': {
        const room = getRoom(roomId);
        room.file = { url: msg.url, name: msg.name, bufferSeconds: msg.bufferSeconds };
        for (const viewer of room.viewers.values()) {
          send(viewer, { type: 'file', url: msg.url, name: msg.name, bufferSeconds: msg.bufferSeconds });
        }
        break;
      }

      // Broadcaster switches viewers back to live (WebRTC) mode.
      case 'live': {
        const room = getRoom(roomId);
        room.file = null;
        for (const viewer of room.viewers.values()) send(viewer, { type: 'live' });
        break;
      }

      // Broadcaster toggles audio on all viewers' output devices.
      case 'audio': {
        const room = getRoom(roomId);
        for (const viewer of room.viewers.values()) {
          send(viewer, { type: 'audio', enabled: msg.enabled });
        }
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
