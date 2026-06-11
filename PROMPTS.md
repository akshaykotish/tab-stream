# AI prompts to compile Tab Stream

Copy‑paste one of these into **Claude**, **ChatGPT**, or **Gemini** and follow along. Each prompt is self‑contained — it tells the assistant the repo, the prerequisites, and exactly what to produce.

Repo: https://github.com/akshaykotish/tab-stream

> Tip: paste the prompt, then paste any error output back to the assistant — it will correct the steps for your machine.

---

## 🟣 Claude — compile everything

```
You are helping me compile the "Tab Stream" project from https://github.com/akshaykotish/tab-stream
(a Node.js WebRTC streaming server + an Android WebView launcher).

My OS: <macOS / Windows / Linux>. My CPU: <Apple Silicon / Intel / ARM>.

Walk me through, one verified step at a time, and wait for my output before continuing:

1. Check prerequisites and install anything missing:
   - Node.js 18+  (node -v)
   - For the standalone binary: npx (comes with Node)
   - For the Android APK: JDK 17+ and the Android SDK (or Android Studio)
2. Clone the repo and explain its layout (server/ and android/).
3. Compile the SERVER into a standalone binary for my platform:
   cd server
   npx @yao-pkg/pkg server.js --config pkg.json --output dist/tabstream-server
   - Tell me the correct `targets` value to put in pkg.json for MY platform
     (e.g. node22-macos-arm64 / node22-win-x64 / node22-linux-x64).
4. Run the binary and confirm it prints the URLs and serves http://localhost:3000/.
5. Build the ANDROID APK:
   cd android
   cp local.properties.sample local.properties   # then set sdk.dir to my Android SDK path
   ./gradlew assembleDebug
   - Tell me where the SDK usually lives on my OS and how to find it.
   - Output APK: android/app/build/outputs/apk/debug/app-debug.apk
6. Summarize exactly which files I can now run/install.

If any command fails, diagnose from the error I paste and give me the corrected command.
```

---

## 🟢 ChatGPT — compile everything

```
Act as a build engineer. Help me compile the open-source project "Tab Stream"
(https://github.com/akshaykotish/tab-stream) — a Node.js WebRTC streaming server and an
Android launcher app. Go step by step and pause after each command for my result.

Environment: OS = <your OS>, CPU = <Apple Silicon / Intel / ARM>.

Goals:
A) Produce a standalone server executable that runs WITHOUT Node installed.
B) Produce an installable Android APK.

Steps to guide me through:
1. Verify/install prerequisites: Node.js 18+, npx; and for Android: JDK 17+ + Android SDK.
2. git clone the repo; cd tab-stream.
3. Server binary:
   - cd server
   - Edit pkg.json so "targets" matches my platform (give me the exact value).
   - Run: npx @yao-pkg/pkg server.js --config pkg.json --output dist/tabstream-server
   - Run the binary; confirm http://localhost:3000/view.html responds.
4. Android APK:
   - cd android
   - Create local.properties from local.properties.sample with my SDK path.
   - Run: ./gradlew assembleDebug   (./gradlew.bat on Windows)
   - Find the APK at app/build/outputs/apk/debug/app-debug.apk.
5. Tell me how to install the APK and how to run the server.

Keep answers concise, show the exact commands for my OS, and fix errors I paste back.
```

---

## 🔵 Gemini — compile everything

```
Help me build the "Tab Stream" project (https://github.com/akshaykotish/tab-stream),
which contains a Node.js streaming server (in server/) and an Android app (in android/).
I want two outputs: (1) a standalone server binary that needs no Node.js, and (2) an Android APK.

My system: <OS> on <Apple Silicon / Intel / ARM>.

Please give me a clear, ordered checklist and verify each step with me:

Prerequisites
  - Node.js 18+ (and npx)
  - JDK 17+ and the Android SDK (only for the APK)

Build the server binary
  - cd server
  - In pkg.json, set "targets" to the value for my platform (tell me which).
  - npx @yao-pkg/pkg server.js --config pkg.json --output dist/tabstream-server
  - Start the binary and open http://localhost:3000/ to confirm it works.

Build the Android APK
  - cd android
  - Copy local.properties.sample to local.properties and set sdk.dir.
  - ./gradlew assembleDebug
  - The APK appears in app/build/outputs/apk/debug/app-debug.apk.

Finish by listing what I can run and how to install the APK on a phone or Android TV.
If a step errors, ask me to paste the message and then correct it.
```

---

## Just the server, no Android (shorter)

Paste into any of the three:

```
From https://github.com/akshaykotish/tab-stream, compile ONLY the Node.js server in server/
into a standalone executable for <my OS / CPU> that runs without Node installed.
Prerequisite: Node.js 18+. The command is:
  cd server
  npx @yao-pkg/pkg server.js --config pkg.json --output dist/tabstream-server
Tell me the exact "targets" value to set in pkg.json for my platform, then how to run the result
and confirm it serves http://localhost:3000/. Fix any error I paste back.
```

---

<p align="center"><b>An Akshay Kotish &amp; Co. app</b></p>
