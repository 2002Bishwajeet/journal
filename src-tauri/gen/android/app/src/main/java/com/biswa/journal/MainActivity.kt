package com.biswa.journal

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // A WebView paints white until the page does; paint the splash colour instead.
  override fun onWebViewCreate(webView: WebView) {
    webView.setBackgroundColor(getColor(R.color.splash_background))
  }
}
