package com.akshaykotish.tabstreamlauncher

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.graphics.Color
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.InputType
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Fullscreen kiosk launcher — stream only, no on-screen controls.
 *
 * Loads your tab-stream viewer in "bare" mode (no UI chrome) over WebRTC, which is the
 * lowest-latency protocol for LAN streaming. Registered as a HOME app so the device can
 * boot straight into the stream.
 *
 * Hidden config: tap the TOP-LEFT corner 5 times quickly to open the URL box.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private val prefs by lazy { getSharedPreferences("tabstream", Context.MODE_PRIVATE) }
    private val retry = Handler(Looper.getMainLooper())
    private var pageLoaded = false

    // Hidden-gesture state: 5 quick taps in the top-left corner opens settings.
    private var cornerTaps = 0
    private var firstTapAt = 0L

    // TV-remote equivalent: 5 quick OK/center presses opens settings (TVs have no touchscreen).
    private var centerPresses = 0
    private var firstCenterAt = 0L

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Route media audio to the music stream so volume buttons control it and it isn't silent.
        volumeControlStream = AudioManager.STREAM_MUSIC

        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }

        web = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.BLACK)
            with(settings) {
                javaScriptEnabled = true
                domStorageEnabled = true
                mediaPlaybackRequiresUserGesture = false // autoplay the stream
                useWideViewPort = true
                loadWithOverviewMode = true
                cacheMode = WebSettings.LOAD_NO_CACHE
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            }
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) { pageLoaded = true }
                override fun onReceivedError(
                    view: WebView?, request: WebResourceRequest?, error: WebResourceError?
                ) {
                    if (request?.isForMainFrame == true) scheduleRetry()
                }
            }
        }
        root.addView(web)
        setContentView(root)
        hideSystemBars()

        val url = prefs.getString("url", null)
        if (url.isNullOrBlank()) autoDetectAndLoad() else web.loadUrl(bare(url))
    }

    /** Ensure the launcher always loads the clean, controls-free viewer. */
    private fun bare(u: String): String {
        if (u.contains("bare")) return u
        return u + (if (u.contains("?")) "&" else "?") + "bare=1"
    }

    // ---------------- Smart host auto-detection ----------------
    // Scans the device's own LAN subnet(s) for a Tab Stream server (responding on /api/ping).

    private fun showMessage(msg: String) {
        val html = "<html><body style='margin:0;background:#000;color:#8a93a6;" +
            "font-family:sans-serif;height:100vh;display:flex;align-items:center;" +
            "justify-content:center;text-align:center;padding:24px'><div style='font-size:18px;" +
            "line-height:1.6'>$msg</div></body></html>"
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    private fun autoDetectAndLoad() {
        showMessage("🔎 Searching your network for the Tab&nbsp;Stream server…")
        Thread {
            val host = scanForHost()
            runOnUiThread {
                if (host != null) {
                    val u = "http://$host:$SCAN_PORT/view.html"
                    prefs.edit().putString("url", u).apply()
                    pageLoaded = false
                    web.loadUrl(bare(u))
                } else {
                    showMessage("No Tab&nbsp;Stream server found on this network.<br><br>" +
                        "Open the URL box: tap top-left 5× (touch) or press MENU / OK ×5 (remote).")
                    promptForUrl()
                }
            }
        }.start()
    }

    private fun localSubnetPrefixes(): List<String> {
        val prefixes = mutableListOf<String>()
        try {
            for (nif in NetworkInterface.getNetworkInterfaces()) {
                if (!nif.isUp || nif.isLoopback) continue
                for (addr in nif.inetAddresses) {
                    if (addr is Inet4Address && addr.isSiteLocalAddress) {
                        val ip = addr.hostAddress ?: continue
                        val dot = ip.lastIndexOf('.')
                        if (dot > 0) prefixes.add(ip.substring(0, dot + 1))
                    }
                }
            }
        } catch (_: Exception) {}
        return prefixes.distinct()
    }

    private fun scanForHost(): String? {
        val prefixes = localSubnetPrefixes()
        if (prefixes.isEmpty()) return null
        val found = AtomicReference<String?>(null)
        val pool = Executors.newFixedThreadPool(48)
        for (prefix in prefixes) for (i in 1..254) {
            pool.execute {
                if (found.get() == null && probe(prefix + i)) found.compareAndSet(null, prefix + i)
            }
        }
        pool.shutdown()
        pool.awaitTermination(12, TimeUnit.SECONDS)
        pool.shutdownNow()
        return found.get()
    }

    private fun probe(ip: String): Boolean {
        return try {
            val c = URL("http://$ip:$SCAN_PORT/api/ping").openConnection() as HttpURLConnection
            c.connectTimeout = 400; c.readTimeout = 400; c.requestMethod = "GET"
            val ok = c.responseCode == 200 && c.inputStream.bufferedReader().readText().contains("tab-stream")
            c.disconnect(); ok
        } catch (_: Exception) { false }
    }

    private fun scheduleRetry() {
        retry.removeCallbacksAndMessages(null)
        retry.postDelayed({
            val url = prefs.getString("url", null)
            if (!pageLoaded && !url.isNullOrBlank()) web.loadUrl(bare(url))
        }, 4000)
    }

    // Watch for 5 quick taps in the top-left corner — invisible settings trigger.
    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (ev.action == MotionEvent.ACTION_DOWN) {
            val corner = ev.x < 120 && ev.y < 120
            val now = SystemClock.uptimeMillis()
            if (corner) {
                if (now - firstTapAt > 2500) { cornerTaps = 0; firstTapAt = now }
                cornerTaps++
                if (cornerTaps >= 5) { cornerTaps = 0; promptForUrl() }
            } else {
                cornerTaps = 0
            }
        }
        return super.dispatchTouchEvent(ev)
    }

    private fun promptForUrl() {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setText(prefs.getString("url", "http://192.168.1.42:3000/view.html"))
            setSelection(text.length)
        }
        AlertDialog.Builder(this)
            .setTitle("Stream URL")
            .setMessage("Enter the viewer URL from the Node server.")
            .setView(input)
            .setPositiveButton("Load") { _, _ ->
                var u = input.text.toString().trim()
                if (u.isNotEmpty()) {
                    if (!u.startsWith("http://") && !u.startsWith("https://")) u = "http://$u"
                    prefs.edit().putString("url", u).apply()
                    pageLoaded = false
                    web.loadUrl(bare(u))
                }
            }
            .setNeutralButton("Auto-detect") { _, _ -> autoDetectAndLoad() }
            .setNegativeButton("Cancel", null)
            .show()
    }

    companion object {
        private const val SCAN_PORT = 3000 // port the server listens on (LAN auto-detect)
    }

    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let {
                it.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                it.systemBarsBehavior =
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun onResume() {
        super.onResume()
        hideSystemBars()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        when (keyCode) {
            KeyEvent.KEYCODE_BACK -> {
                if (web.canGoBack()) { web.goBack() }
                return true // swallow — don't drop out of the launcher
            }
            // Open settings from a TV remote.
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_SETTINGS -> {
                promptForUrl(); return true
            }
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> {
                val now = SystemClock.uptimeMillis()
                if (now - firstCenterAt > 2500) { centerPresses = 0; firstCenterAt = now }
                centerPresses++
                if (centerPresses >= 5) { centerPresses = 0; promptForUrl(); return true }
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onDestroy() {
        retry.removeCallbacksAndMessages(null)
        super.onDestroy()
    }
}
