package app.tauri.browser

import android.app.Activity
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class OpenUrlArgs {
  lateinit var url: String
}

/**
 * External links and the YouAuth sign-in open in a Custom Tab over the app. The
 * sign-in's journal:// callback comes back to MainActivity as a deep link.
 */
@TauriPlugin
class BrowserPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun openUrl(invoke: Invoke) {
    val args = invoke.parseArgs(OpenUrlArgs::class.java)
    val uri = Uri.parse(args.url)
    if (uri.scheme != "https" && uri.scheme != "http") {
      invoke.reject("not an http(s) URL")
      return
    }
    activity.runOnUiThread {
      try {
        CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(activity, uri)
        invoke.resolve()
      } catch (e: Exception) {
        invoke.reject(e.message ?: "can't open the link")
      }
    }
  }
}
