package com.biswa.journal

import android.graphics.Color
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.ColorUtils
import androidx.core.view.WindowCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

class MainActivity : TauriActivity() {
  private val prefs by lazy { getSharedPreferences("system_bars", MODE_PRIVATE) }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // The in-app theme is only known once the page runs; until then use the colour
    // it posted last time, so an in-app theme that differs from the OS one does not flash.
    prefs.getString("color", null)?.let { setBarIcons(it) }
  }

  // A WebView paints white until the page does; paint the last theme colour (or the
  // splash colour on the first launch) instead.
  override fun onWebViewCreate(webView: WebView) {
    val last = prefs.getString("color", null)?.let { runCatching { Color.parseColor(it) }.getOrNull() }
    webView.setBackgroundColor(last ?: getColor(R.color.splash_background))

    // The page posts the colour of the surface under the bars (src/lib/themeColor.ts)
    // so the status and navigation bar icons follow the in-app theme, not only the OS.
    // Only the app's own origin, main frame, may call it: embedded pages cannot.
    if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      WebViewCompat.addWebMessageListener(
        webView, "JournalSystemBars", setOf("http://localhost:47821")
      ) { _, message, _, isMainFrame, _ ->
        if (isMainFrame) message.data?.let { setBarIcons(it) }
      }
    }
  }

  private fun setBarIcons(cssColor: String) {
    val color = runCatching { Color.parseColor(cssColor) }.getOrNull() ?: return
    prefs.edit().putString("color", cssColor).apply()
    val light = ColorUtils.calculateLuminance(color) > 0.5
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = light
      isAppearanceLightNavigationBars = light
    }
  }
}
