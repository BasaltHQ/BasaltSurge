package com.example.basaltsurgemobile.lockdown

import android.app.Activity
import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.util.Log
import android.widget.Toast
import com.example.basaltsurgemobile.AppDeviceAdminReceiver
import java.security.MessageDigest

class LockdownManager(private val context: Context) {

    companion object {
        private const val TAG = "LockdownManager"
        private const val UNLOCK_SALT = "touchpoint_unlock_v1:"
    }

    var isTemporarilyUnlocked: Boolean = false
        private set

    fun enableLockTaskMode(activity: Activity, config: LockdownConfig) {
        if (isTemporarilyUnlocked) {
            Log.d(TAG, "Bypassing enableLockTaskMode because device is temporarily unlocked")
            return
        }
        try {
            val am = activity.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            if (am.lockTaskModeState == ActivityManager.LOCK_TASK_MODE_NONE) {
                val dpm = activity.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
                val componentName = ComponentName(activity, AppDeviceAdminReceiver::class.java)

                val mode = config.lockdownMode
                if (mode == "standard" || mode == "device_owner") {
                    if (dpm.isDeviceOwnerApp(activity.packageName)) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                            dpm.setLockTaskFeatures(
                                componentName,
                                DevicePolicyManager.LOCK_TASK_FEATURE_SYSTEM_INFO
                            )
                        }
                        dpm.setLockTaskPackages(componentName, arrayOf(activity.packageName))
                        activity.startLockTask()
                        Log.d(TAG, "Started Lock Task Mode (Device Owner)")
                    } else if (mode == "standard") {
                        // CRITICAL FIX: The NDroid OS on the VP550/N950 completely hides the ScreenPinningConfirmation 
                        // modal behind the app window, but the invisible modal continues to consume all user touches, 
                        // rendering the actual app completely unclickable (e.g. employee PIN pad frozen). 
                        // Therefore, we must NEVER call startLockTask() for standard mode on the VP550/N950.
                        val modelUpper = Build.MODEL.uppercase()
                        val productUpper = Build.PRODUCT.uppercase()
                        val isValorLegacy = modelUpper.contains("VP550") || modelUpper.contains("N950") || 
                                           productUpper.contains("VP550") || productUpper.contains("N950")
                        if (!isValorLegacy) {
                            activity.startLockTask()
                            Log.d(TAG, "Started Lock Task Mode (Standard)")
                        } else {
                            Log.w(TAG, "Bypassing Standard Lock Task Mode on Valor legacy hardware (VP550/N950) to prevent invisible confirmation dialog from consuming touches")
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start Lock Task Mode: ${e.message}")
        }
    }

    fun disableLockTaskMode(activity: Activity) {
        try {
            val am = activity.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            if (am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE) {
                activity.stopLockTask()
                Log.d(TAG, "Stopped Lock Task Mode dynamically")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to stop Lock Task Mode: ${e.message}")
        }
    }

    fun validateUnlockCode(enteredCode: String, storedHash: String?): Boolean {
        if (storedHash.isNullOrEmpty()) return false
        val digest = MessageDigest.getInstance("SHA-256")
        val hashedBytes = digest.digest((UNLOCK_SALT + enteredCode).toByteArray())
        val enteredHash = hashedBytes.joinToString("") { "%02x".format(it) }
        return enteredHash == storedHash
    }

    fun exitLockdownTemporarily(activity: Activity) {
        try {
            activity.stopLockTask()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to stop Lock Task Mode: ${e.message}")
        }
        isTemporarilyUnlocked = true
        Toast.makeText(activity, "Lockdown disabled until next reboot.", Toast.LENGTH_SHORT).show()
        Log.d(TAG, "Lock Task Mode stopped temporarily. User can now navigate away.")
    }

    fun exitLockdownForUpdate(activity: Activity) {
        try {
            isTemporarilyUnlocked = true
            activity.stopLockTask()
            Log.d(TAG, "Exited lock task mode for update installation")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to stop lock task", e)
        }
    }
}
