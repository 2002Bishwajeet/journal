package app.tauri.export

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class ShareArgs {
  lateinit var path: String
}

@InvokeArg
class ShareTextArgs {
  lateinit var text: String
  var title: String? = null
}

/**
 * The share sheet for an exported file in the app's cache, so it can go to Drive, Files or
 * another app. The file goes out through the app's FileProvider (`<applicationId>.fileprovider`
 * in gen/android's AndroidManifest.xml), with read access for the app the user picks only.
 */
@TauriPlugin
class ExportPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun share(invoke: Invoke) {
    val args = invoke.parseArgs(ShareArgs::class.java)
    activity.runOnUiThread {
      try {
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", File(args.path))
        val send = Intent(Intent.ACTION_SEND)
          .setType(activity.contentResolver.getType(uri) ?: "application/octet-stream")
          .putExtra(Intent.EXTRA_STREAM, uri)
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        // The chooser passes the read grant on only for a URI in the intent's ClipData.
        send.clipData = ClipData.newRawUri(null, uri)
        activity.startActivity(Intent.createChooser(send, null))
        // The chooser doesn't say whether the user picked an app.
        val result = JSObject()
        result.put("shared", true)
        invoke.resolve(result)
      } catch (e: Exception) {
        invoke.reject(e.message ?: "can't share the file")
      }
    }
  }

  /** The share sheet for a piece of text. */
  @Command
  fun shareText(invoke: Invoke) {
    val args = invoke.parseArgs(ShareTextArgs::class.java)
    activity.runOnUiThread {
      try {
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, args.text)
        args.title?.let { send.putExtra(Intent.EXTRA_SUBJECT, it) }
        activity.startActivity(Intent.createChooser(send, null))
        val result = JSObject()
        result.put("shared", true)
        invoke.resolve(result)
      } catch (e: Exception) {
        invoke.reject(e.message ?: "can't share the text")
      }
    }
  }
}
