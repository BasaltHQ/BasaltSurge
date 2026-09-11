package com.example.basaltsurgemobile.config

import android.content.Context
import android.util.Log
import com.example.basaltsurgemobile.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class RemoteConfigManager(private val context: Context) {

    companion object {
        private const val TAG = "RemoteConfigManager"
        private const val PREFS_NAME = "touchpoint_prefs"
        private const val PREF_INSTALLATION_ID = "installation_id"
        const val CONFIG_POLL_INTERVAL_MS = 60_000L // 60 seconds
    }

    fun getInstallationId(): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(PREF_INSTALLATION_ID, null)
    }

    fun storeInstallationId(id: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(PREF_INSTALLATION_ID, id).apply()
    }

    suspend fun fetchRemoteConfig(installationId: String): JSONObject? = withContext(Dispatchers.IO) {
        try {
            val url = URL("${BuildConfig.BASE_DOMAIN}/api/touchpoint/config?installationId=$installationId")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.connectTimeout = 10_000
            conn.readTimeout = 10_000

            if (conn.responseCode == 200) {
                val response = conn.inputStream.bufferedReader().readText()
                JSONObject(response)
            } else {
                Log.w(TAG, "Config fetch failed: ${conn.responseCode}")
                null
            }
        } catch (e: Exception) {
            Log.e(TAG, "Config fetch error: ${e.message}")
            null
        }
    }
}
