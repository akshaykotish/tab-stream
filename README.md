<p align="center">
  <img src="assets/logo.png" alt="Tab Stream" width="100%">
</p>

<h1 align="center">Tab Stream</h1>

<p align="center">
  Real‑time <b>tab / screen streaming</b> to any device on your network — sub‑second latency over WebRTC (UDP). <br>
  A Node.js dashboard broadcasts; a fullscreen Android launcher (or any browser) watches by IP.
</p>

<p align="center">
  <a href="https://github.com/akshaykotish/tab-stream/releases/latest/download/TabStream.apk">
    <img src="https://img.shields.io/badge/⬇_Download-APK-2F6BFF?style=for-the-badge" alt="Download APK">
  </a>
  &nbsp;
  <img src="https://img.shields.io/badge/Protocol-WebRTC%20%2F%20UDP-0B0E14?style=for-the-badge" alt="WebRTC/UDP">
  <img src="https://img.shields.io/badge/Latency-%3C200ms_LAN-0B0E14?style=for-the-badge" alt="Low latency">
</p>

---

## ⬇ Download the app

**[Download TabStream.apk →](https://github.com/akshaykotish/tab-stream/releases/latest/download/TabStream.apk)**

It's a fullscreen **launcher**: install it and the device boots straight into your stream — no buttons, no chrome, just the picture. To change the stream address, **tap the top‑left corner 5× quickly**.

> Android may warn about installing outside the Play Store. Enable **Settings → Apps → Special access → Install unknown apps** for your browser/file manager, then open the APK.

To make it the device's home screen: **Settings → Apps → Default apps → Home app → Tab Stream**.

---

## How it works

```
 Broadcaster (browser)            Node server               Viewer (Android app / browser)
 ┌──────────────────┐   signaling  ┌─────────────┐  signaling  ┌──────────────────────────┐
 │ shares a tab/screen ├──WebSocket──┤  relays SDP ├──WebSocket──┤ receives & plays fullscreen │
 │  getDisplayMedia    │             │  + ICE only │             │   (no buffer, auto-play)   │
 └─────────┬──────────┘             └─────────────┘             └────────────┬─────────────┘
           └──────────────── WebRTC media, peer‑to‑peer over UDP ────────────┘
```

The server only brokers the handshake. Video flows **directly** browser‑to‑device over UDP, so it never round‑trips through the server.

---

## Run it locally

### 1. Start the server

```bash
cd server
npm install
npm start
```

It prints your URLs, e.g.:

```
Broadcast:  http://localhost:3000/            (this machine)
            https://192.168.1.42:3443/        (any device — accept cert once)
Watch:      http://192.168.1.42:3000/view.html
```

### 2. Broadcast (share a tab/screen)

Screen capture needs a **secure context**, so open the broadcast page one of two ways:

- **From the same machine:** `http://localhost:3000/` ✅ works directly.
- **From any other device:** run `./make-certs.sh` once, restart, then open `https://<your-ip>:3443/` and accept the self‑signed cert warning.

Click **Start sharing**, pick a tab/window/screen, choose a quality (up to 4K), done.

### 3. Watch

Open `http://<your-ip>:3000/view.html` on any phone, laptop, or TV browser on the same network — **or** use the Android app and point it at that URL.

> All devices must be on the **same Wi‑Fi / LAN**. "Stream on an IP" = local network.

---

## Build the Android app from source

Requires Android Studio (or the Android SDK + JDK 17+).

```bash
cd android
cp local.properties.sample local.properties   # then edit sdk.dir
./gradlew assembleDebug
# output: app/build/outputs/apk/debug/app-debug.apk
```

Open `view.html`'s URL in the app via the hidden gesture (top‑left, 5 taps).

---

## Features

- **Fastest transport** — WebRTC over **UDP**; TCP candidates are filtered out so it never falls back to a slower path.
- **No buffering delay** — viewer jitter buffer is set to 0; frames render the instant they arrive.
- **HD** — selectable 720p / 1080p / 1440p / 4K with high bitrate so text stays crisp.
- **One broadcaster → many viewers**, plus independent channels via `?room=NAME`.
- **Kiosk launcher** — fullscreen, auto‑play, keep‑awake, no on‑screen controls, swallows Back.
- **Zero install for viewers** — any browser on the LAN just opens a URL.

---

## Tech

Node.js · Express · `ws` (WebSocket signaling) · WebRTC · Android (Kotlin, WebView).

---

<p align="center"><b>An Akshay Kotish &amp; Co. app</b></p>
