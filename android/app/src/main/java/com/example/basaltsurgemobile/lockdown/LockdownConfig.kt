package com.example.basaltsurgemobile.lockdown

/**
 * Kiosk lockdown configuration received from the web app or remote config
 */
data class LockdownConfig(
    val lockdownMode: String = "none", // "none", "standard", "device_owner"
    val unlockCodeHash: String? = null
)
