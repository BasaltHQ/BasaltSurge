package com.example.basaltsurgemobile

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ComposeView
import androidx.lifecycle.lifecycleScope
import com.example.basaltsurgemobile.config.RemoteConfigManager
import com.example.basaltsurgemobile.lockdown.LockdownConfig
import com.example.basaltsurgemobile.lockdown.LockdownManager
import com.example.basaltsurgemobile.ui.dialogs.UnlockOverlay
import com.example.basaltsurgemobile.ui.dialogs.UpdateAvailableDialog
import com.example.basaltsurgemobile.ui.theme.BasaltSurgeMobileTheme
import com.getcapacitor.BridgeActivity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class MainActivity : BridgeActivity() {
    private var lockdownConfig = mutableStateOf(LockdownConfig())
    private var showUnlockOverlay = mutableStateOf(false)
    private var showUpdateDialog = mutableStateOf(false)
    private var updateInfo = mutableStateOf<OtaUpdateManager.UpdateInfo?>(null)
    private lateinit var otaUpdateManager: OtaUpdateManager
    private lateinit var lockdownManager: LockdownManager
    private lateinit var remoteConfigManager: RemoteConfigManager
    private var currentTouchpointMode: String? = null
    private var currentMerchantWallet: String? = null

    companion object {
        private const val TAG = "MainActivity"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Initialize Hardware Abstraction Layer
        com.example.basaltsurgemobile.hardware.HardwareRegistry.initialize(this)
        
        // Initialize Managers
        otaUpdateManager = OtaUpdateManager(this)
        lockdownManager = LockdownManager(this)
        remoteConfigManager = RemoteConfigManager(this)
        
        // Register Custom Native Capacitor Plugins for Hardware Abstraction
        registerPlugin(com.example.basaltsurgemobile.plugins.DeviceProfilePlugin::class.java)

        // Printers
        registerPlugin(com.example.basaltsurgemobile.plugins.TopWisePrinterPlugin::class.java)
        registerPlugin(com.example.basaltsurgemobile.plugins.KioskPrinterPlugin::class.java)
        registerPlugin(com.example.basaltsurgemobile.plugins.ValorPrinterPlugin::class.java)
        registerPlugin(com.example.basaltsurgemobile.plugins.ExternalPrinterPlugin::class.java)
        registerPlugin(com.example.basaltsurgemobile.plugins.UsbPrinterPlugin::class.java)
        
        // Scanners
        registerPlugin(com.example.basaltsurgemobile.plugins.TopWiseScannerPlugin::class.java)
        registerPlugin(com.example.basaltsurgemobile.plugins.IcodScannerPlugin::class.java)
        
        // Audio/Haptic Feedback
        registerPlugin(com.example.basaltsurgemobile.plugins.TopWiseFeedbackPlugin::class.java)
        registerPlugin(com.example.basaltsurgemobile.plugins.IcodFeedbackPlugin::class.java)
        registerPlugin(com.example.basaltsurgemobile.plugins.GenericFeedbackPlugin::class.java)
        
        // Secondary Displays
        registerPlugin(com.example.basaltsurgemobile.plugins.TopWiseDisplayPlugin::class.java)
        registerPlugin(com.example.basaltsurgemobile.plugins.ValorDisplayPlugin::class.java)
        
        // Payment Processing (Card Readers & PIN Pads)
        registerPlugin(com.example.basaltsurgemobile.plugins.TopWiseCardReaderPlugin::class.java)
        registerPlugin(com.example.basaltsurgemobile.plugins.TopWisePinPadPlugin::class.java)
        registerPlugin(com.example.basaltsurgemobile.plugins.ValorPaymentPlugin::class.java)

        super.onCreate(savedInstanceState)
        
        // Force relaxed WebView settings for Custom ROMs (NDroid / TopWise) that aggressively strip CSS
        bridge.webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            allowFileAccess = true
            allowContentAccess = true
        }
        
        // Enable Chrome developer tools remote debugging for the WebView
        android.webkit.WebView.setWebContentsDebuggingEnabled(true)
        
        // Check permissions
        checkOverlayPermission()
        checkInstallPermission()
        
        // Setup back button handler for lockdown mode
        setupBackPressedHandler()
        
        // Setup Compose Overlays on top of Capacitor's WebView
        val composeView = ComposeView(this).apply {
            setContent {
                BasaltSurgeMobileTheme {
                    Box(modifier = Modifier.fillMaxSize()) {
                        // Unlock overlay shown when user tries to exit in lockdown mode
                        if (showUnlockOverlay.value) {
                            UnlockOverlay(
                                onDismiss = { showUnlockOverlay.value = false },
                                onUnlock = { code ->
                                    if (lockdownManager.validateUnlockCode(code, lockdownConfig.value.unlockCodeHash)) {
                                        showUnlockOverlay.value = false
                                        lockdownManager.exitLockdownTemporarily(this@MainActivity)
                                    } else {
                                        val config = lockdownConfig.value
                                        val msg = when {
                                            config.unlockCodeHash == null -> "Config not loaded (Hash is null)"
                                            else -> "Invalid code (Hash mismatch)"
                                        }
                                        Toast.makeText(this@MainActivity, msg, Toast.LENGTH_LONG).show()
                                    }
                                }
                            )
                        }
                        
                        // Update available dialog
                        if (showUpdateDialog.value && updateInfo.value != null) {
                            UpdateAvailableDialog(
                                info = updateInfo.value!!,
                                onDismiss = { showUpdateDialog.value = false },
                                onUpdate = {
                                    updateInfo.value?.downloadUrl?.let { url ->
                                        otaUpdateManager.downloadAndInstall(
                                            downloadUrl = url,
                                            onComplete = {
                                                val mode = lockdownConfig.value.lockdownMode
                                                if (mode == "standard" || mode == "device_owner") {
                                                    lockdownManager.exitLockdownForUpdate(this@MainActivity)
                                                }
                                            }
                                        )
                                        Toast.makeText(this@MainActivity, "Downloading update...", Toast.LENGTH_LONG).show()
                                    }
                                    showUpdateDialog.value = false
                                }
                            )
                        }
                    }
                }
            }
        }
        
        // Add ComposeView to the root layout so it overlays the WebView
        addContentView(composeView, ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 
            ViewGroup.LayoutParams.MATCH_PARENT
        ))
        
        startUpdatePolling()
        startConfigPolling()
    }

    override fun onStart() {
        super.onStart()
        // Load the live environment dynamically 
        // We do this in onStart so the Bridge is fully initialized
        val setupUrl = "${BuildConfig.BASE_DOMAIN}/touchpoint/setup?scale=0.75"
        bridge.webView.loadUrl(setupUrl)
        
        // Capacitor doesn't provide a direct location change observer that matches GeckoView's NavigationDelegate
        // easily from Kotlin, so we poll the URL. This is lightweight and catches programmatic #hash changes.
        pollLockdownurl()
    }

    private fun pollLockdownurl() {
        lifecycleScope.launch {
            while (true) {
                delay(1000) // check every 1 second
                try {
                    val currentUrl = bridge.webView.url
                    if (currentUrl != null) {
                        checkUrlForConfig(currentUrl)
                    }
                } catch (e: Exception) {
                    // Ignore errors if webview isn't ready
                }
            }
        }
    }

    private fun checkUrlForConfig(currentUrl: String) {
        // Monitor URL changes to detect lockdown configuration
        // format: #lockdown:mode:hash
        if (currentUrl.contains("#lockdown:")) {
            try {
                val hash = currentUrl.substringAfter("#lockdown:")
                val parts = hash.split(":")
                if (parts.isNotEmpty()) {
                    val mode = parts[0]
                    val hashValue = if (parts.size > 1 && parts[1] != "null" && parts[1].isNotEmpty()) parts[1] else null
                    updateLockdownMode(mode, hashValue)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error parsing lockdown config from URL: ${e.message}")
            }
        }
        
        // Also check for lockdown mode in query parameters (alternative method)
        // Format: ?lockdownMode=standard&unlockHash=abc123
        if (currentUrl.contains("lockdownMode=")) {
            try {
                val uri = Uri.parse(currentUrl)
                val mode = uri.getQueryParameter("lockdownMode") ?: "none"
                val hashValue = uri.getQueryParameter("unlockHash")
                updateLockdownMode(mode, hashValue)
            } catch (e: Exception) {
                Log.e(TAG, "Error parsing lockdown config from query: ${e.message}")
            }
        }
        
        // Capture installation ID for config polling
        try {
            val uri = Uri.parse(currentUrl)
            val installId = uri.getQueryParameter("installationId") 
                ?: uri.getQueryParameter("installId")
            if (!installId.isNullOrBlank()) {
                val currentStored = remoteConfigManager.getInstallationId()
                if (currentStored != installId) {
                    remoteConfigManager.storeInstallationId(installId)
                    Log.d(TAG, "Stored installation ID: $installId")
                }
            }
        } catch (e: Exception) {
            // Ignore
        }

        // Track the current touchpoint mode loaded in WebView
        if (currentUrl.contains("/terminal/")) {
            currentTouchpointMode = "terminal"
        } else if (currentUrl.contains("/handheld/")) {
            currentTouchpointMode = "handheld"
        } else if (currentUrl.contains("/kiosk/")) {
            currentTouchpointMode = "kiosk"
        } else if (currentUrl.contains("/kitchen/")) {
            currentTouchpointMode = "kds"
        }

        // Track the current merchant wallet address loaded in WebView
        try {
            val walletRegex = Regex("0x[a-fA-F0-9]{40}", RegexOption.IGNORE_CASE)
            val match = walletRegex.find(currentUrl)
            if (match != null) {
                currentMerchantWallet = match.value
                Log.d(TAG, "Detected merchant wallet in WebView URL: ${match.value}")
            }
        } catch (e: Exception) {
            // Ignore
        }
    }

    private fun checkForUpdates() {
        if (!otaUpdateManager.shouldCheckForUpdate()) return
        
        lifecycleScope.launch {
            val info = otaUpdateManager.checkForUpdate()
            
            if (info != null) {
                // Only record check time if we successfully reached the server
                otaUpdateManager.recordUpdateCheck()
                
                if (info.hasUpdate) {
                    Log.d(TAG, "Update available: ${info.latestVersion}")
                    updateInfo.value = info
                    showUpdateDialog.value = true
                    
                    // For Device Owner mode, auto-install if mandatory
                    val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
                    if (dpm.isDeviceOwnerApp(packageName) && info.mandatory && info.downloadUrl != null) {
                        Log.d(TAG, "Auto-installing mandatory update (Device Owner mode)")
                        otaUpdateManager.downloadAndInstall(
                            downloadUrl = info.downloadUrl,
                            onComplete = {
                                val mode = lockdownConfig.value.lockdownMode
                                if (mode == "standard" || mode == "device_owner") {
                                    lockdownManager.exitLockdownForUpdate(this@MainActivity)
                                }
                            }
                        )
                    }
                }
            }
        }
    }

    private fun checkInstallPermission() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            if (!packageManager.canRequestPackageInstalls()) {
                val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
                if (!dpm.isDeviceOwnerApp(packageName)) {
                    val intent = Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                    intent.data = Uri.parse("package:$packageName")
                    startActivity(intent)
                    Toast.makeText(this, "Please allow 'Install unknown apps' for updates", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun startConfigPolling() {
        lifecycleScope.launch {
            while (true) {
                delay(RemoteConfigManager.CONFIG_POLL_INTERVAL_MS)
                
                try {
                    val installationId = remoteConfigManager.getInstallationId() ?: continue
                    val config = remoteConfigManager.fetchRemoteConfig(installationId) ?: continue
                    
                    val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
                    
                    // Command: wipeDevice (factory reset)
                    if (config.optBoolean("wipeDevice", false) && dpm.isDeviceOwnerApp(packageName)) {
                        Log.w(TAG, "Remote wipeDevice command received - initiating factory reset")
                        Toast.makeText(this@MainActivity, "Remote wipe initiated...", Toast.LENGTH_LONG).show()
                        dpm.wipeDevice(0)
                        return@launch 
                    }
                    
                    // Command: clearDeviceOwner
                    if (config.optBoolean("clearDeviceOwner", false) && dpm.isDeviceOwnerApp(packageName)) {
                        Log.w(TAG, "Remote clearDeviceOwner command received - removing device owner")
                        Toast.makeText(this@MainActivity, "Removing device owner mode...", Toast.LENGTH_LONG).show()
                        @Suppress("DEPRECATION")
                        dpm.clearDeviceOwnerApp(packageName)
                        lockdownConfig.value = LockdownConfig(lockdownMode = "none", unlockCodeHash = null)
                        lockdownManager.disableLockTaskMode(this@MainActivity)
                        continue
                    }
                    
                    // Dynamic unlock code update
                    val remoteUnlockHash = if (config.has("unlockCodeHash")) config.getString("unlockCodeHash") else null
                    val remoteLockdownMode = config.optString("lockdownMode", "none")
                    val currentConfig = lockdownConfig.value
                    
                    if (remoteUnlockHash != null && remoteUnlockHash != currentConfig.unlockCodeHash) {
                        Log.d(TAG, "Remote unlock code hash updated via polling")
                        updateLockdownMode(remoteLockdownMode, remoteUnlockHash)
                    } else if (remoteLockdownMode != currentConfig.lockdownMode) {
                        Log.d(TAG, "Remote lockdown mode updated via polling: $remoteLockdownMode")
                        updateLockdownMode(remoteLockdownMode, currentConfig.unlockCodeHash)
                    }

                    // Dynamic mode/wallet changes detection
                    val remoteMode = config.optString("mode")
                    val remoteWallet = config.optString("merchantWallet")
                    var needsReload = false

                    if (remoteMode.isNotEmpty()) {
                        val currentMode = currentTouchpointMode
                        if (currentMode != null && remoteMode != currentMode) {
                            Log.i(TAG, "Remote touchpoint mode changed from $currentMode to $remoteMode.")
                            currentTouchpointMode = remoteMode
                            needsReload = true
                        } else if (currentMode == null) {
                            currentTouchpointMode = remoteMode
                        }
                    }

                    if (remoteWallet.isNotEmpty()) {
                        val currentWallet = currentMerchantWallet
                        if (currentWallet != null && !remoteWallet.equals(currentWallet, ignoreCase = true)) {
                            Log.i(TAG, "Remote merchant wallet changed from $currentWallet to $remoteWallet.")
                            currentMerchantWallet = remoteWallet
                            needsReload = true
                        } else if (currentWallet == null) {
                            currentMerchantWallet = remoteWallet
                        }
                    }

                    if (needsReload) {
                        Log.d(TAG, "Reloading WebView to setup page to apply remote config updates.")
                        lifecycleScope.launch(Dispatchers.Main) {
                            bridge.webView.loadUrl("${BuildConfig.BASE_DOMAIN}/touchpoint/setup?scale=0.75")
                        }
                    }
                    
                } catch (e: Exception) {
                    Log.e(TAG, "Config polling error: ${e.message}")
                }
            }
        }
    }

    private fun startUpdatePolling() {
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "Skipping OTA update polling in debug build")
            return
        }
        lifecycleScope.launch {
            checkForUpdates()
            while (true) {
                delay(60 * 60 * 1000L) 
                checkForUpdates()
            }
        }
    }

    private fun setupBackPressedHandler() {
        // BridgeActivity has a native hardware back button handler. We can intercept it via AndroidX OnBackPressedDispatcher
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val mode = lockdownConfig.value.lockdownMode
                if (mode == "standard" || mode == "device_owner") {
                    Log.d(TAG, "Back pressed blocked - lockdown mode: $mode")
                    showUnlockOverlay.value = true
                } else {
                    // Navigate webview back if possible, otherwise normal back behavior
                    if (bridge.webView.canGoBack()) {
                        bridge.webView.goBack()
                    } else {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            }
        })
    }

    private fun checkOverlayPermission() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            if (!android.provider.Settings.canDrawOverlays(this)) {
                val intent = Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:$packageName"))
                startActivity(intent)
                Toast.makeText(this, "Please grant 'Display over other apps' for auto-boot", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun enableLockTaskMode() {
        lockdownManager.enableLockTaskMode(this, lockdownConfig.value)
    }

    private fun disableLockTaskMode() {
        lockdownManager.disableLockTaskMode(this)
    }

    private fun updateLockdownMode(newMode: String, newHash: String?) {
        val newConfig = LockdownConfig(newMode, newHash)
        if (newConfig != lockdownConfig.value) {
            Log.d(TAG, "Updating lockdown mode to: $newMode")
            lockdownConfig.value = newConfig
            
            if (newMode == "standard" || newMode == "device_owner") {
                enableLockTaskMode()
            } else if (newMode == "none") {
                disableLockTaskMode()
            }
        }
    }

    override fun onPause() {
        super.onPause()
        
        // If the user manually unlocked the device using the PIN, allow them to leave the app
        if (lockdownManager.isTemporarilyUnlocked) return
        
        val mode = lockdownConfig.value.lockdownMode
        if (mode == "standard" || mode == "device_owner") {
            val intent = intent
            intent.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            startActivity(intent)
        }
    }
}
