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
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // A WebView paints white until the page does; paint the splash colour instead.
  override fun onWebViewCreate(webView: WebView) {
    webView.setBackgroundColor(getColor(R.color.splash_background))

    // The page posts the colour of the surface under the bars (src/lib/themeColor.ts)
    // so the status and navigation bar icons follow the in-app theme, not only the OS.
    // Only the app's own origin, main frame, may call it: embedded pages cannot.
    if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      WebViewCompat.addWebMessageListener(
        webView, "JournalSystemBars", setOf("http://localhost:47821")
      ) { _, message, _, isMainFrame, _ ->
        if (isMainFrame) message.data?.let(::setBarIcons)
      }
    }
  }

  private fun setBarIcons(cssColor: String) {
    val color = try { Color.parseColor(cssColor) } catch (_: IllegalArgumentException) { return }
    val light = ColorUtils.calculateLuminance(color) > 0.5
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = light
      isAppearanceLightNavigationBars = light
    }
  }
}
