# Device Provisioning & Android Owner Mode

This guide explains how to provision physical terminal devices, install the Android application in **Owner Mode (Device Owner)**, manage lockdown configurations, and reset locked device PIN codes.

---

## 1. Architecture: APK Builds vs Touchpoints

Before starting setup, note the division of labor between layers:
*   **APK Compilation**: Handheld terminal Android application packages (APKs) are built, maintained, and compiled at the **Platform** level, not by individual Partners.
*   **Natively Generated URLs**: Web-based touchpoint URLs are generated natively by the system based on your brand configurations.
*   **Partner Role**: Partners are responsible for downloading scripts, enrolling devices in their network container using their `brandKey`, configuring lockdown levels, and managing device PINs.

---

## 2. Device Provisioning Walkthrough

To register and associate a device (e.g., a Topwise handheld terminal) with your partner container:

1. Turn on the device and launch the installed app. Note the **Installation ID** displayed on the boot screen.
2. In the Admin Panel, navigate to **Partner/Admin** → **Devices** (or **Touchpoints** under Apps).
3. Click **Provision Device**.
4. Fill in the configuration:
    *   **Installation ID**: Input the code from the device screen.
    *   **Brand Key**: Enter your partner container's unique brand key (this ensures branding overrides propagate correctly).
    *   **Lockdown Mode**: Select your desired level (see Section 3).
    *   **Unlock PIN**: Set a 4-8 digit PIN code.
5. Click **Provision**. The device will fetch the configuration automatically and launch the checkout screen.

---

## 3. Lockdown Modes Breakdown

Lockdown modes control how securely the app holds the terminal interface:

*   **`none`**: Standard app view. Cashiers can switch apps, open standard browser pages, or exit the program.
*   **`standard`**: Web-level soft kiosk. The interface prevents clicking outside, but cashiers can exit using standard Android system gesture swipes.
*   **`device_owner` (Owner Mode)**: System-level OS lock. Enforces full kiosk mode. The status bar pull-down, app switching, physical power menu bypasses, and home navigation are locked at the OS level. The terminal can only run the checkout application.

---

## 4. Walkthrough: Enrolling Owner Mode (`device_owner`)

To configure a device in full Owner Mode, you must set it up via ADB (Android Debug Bridge):

### Prerequisites:
*   An Android terminal device connected to your computer via USB.
*   Developer Options and USB Debugging enabled on the device.
*   **CRITICAL REQUIREMENT**: Open Settings → Accounts on the device and **remove all Google and other user accounts**. Android will block device owner assignment if any accounts are active.
*   ADB installed on your computer.

### Installation Steps:
1. Navigate to **Partner/Admin** → **Devices** in the sidebar.
2. Scroll to the setup scripts and download the script matching your OS:
    *   `setup-<brandKey>-owner-mode.bat` (Windows)
    *   `setup-<brandKey>-owner-mode.sh` (Mac/Linux)
3. Open your terminal, navigate to the download folder, and run the script.
4. The script will:
    *   Download the branded APK file from the endpoint:
        `/api/touchpoint/apk-download?brandKey=<brandKey>`
    *   Install the APK to the device:
        `adb install -r -g <apk_path>`
    *   Assign the app as the device owner:
        `adb shell dpm set-device-owner com.example.basaltsurgemobile/.AppDeviceAdminReceiver`
    *   Grant screen alert permissions:
        `adb shell appops set com.example.basaltsurgemobile SYSTEM_ALERT_WINDOW allow`
    *   Launch the MainActivity on the device.
5. Once the app launches, proceed to provision it in the admin panel using the displayed Installation ID.

---

## 5. Unlock PINs & Resetting Locked Codes

When provisioning a device in `standard` or `device_owner` lockdown, you must set a **4-8 digit numeric unlock PIN**. This code is required to temporarily unlock the device screen for administrative settings.

### How to reset a forgotten or locked PIN:
If a cashier gets locked out of a terminal:
1. In the admin console, select **Touchpoint Monitoring** under the Devices tab.
2. Locate the locked device and click **Edit**.
3. Under the **Unlock PIN** field, enter a new 4-8 digit numeric code.
4. Click **Save Changes**.
5. The dashboard hashes the code and updates the database. The next time the device connects to the internet, it retrieves the new hash, allowing you to unlock the screen with the updated PIN.
