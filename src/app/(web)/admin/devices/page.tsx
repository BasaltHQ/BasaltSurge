"use client";

import React from "react";
import AdminHero from "@/components/admin/admin-hero";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import InstallerPackagesPanel from "@/app/(web)/admin/panels/InstallerPackagesPanel";
import { useActiveAccount } from "thirdweb/react";
import { isPlatformSuperAdmin, canAccessPanel } from "@/lib/authz";

/**
 * Admin → Devices
 * Standalone page that surfaces the WebUSB/WebADB Installer panel without requiring changes
 * to the existing tab state machine. Navigate to /admin/devices to use.
 *
 * This does not expose APK files directly. The panel fetches bytes from:
 *   - /api/admin/apk/portalpay
 *   - /api/admin/apk/paynex
 * and installs them to a USB‑connected Android device via WebUSB/ADB.
 */
export default function AdminDevicesPage() {
  const account = useActiveAccount();
  const wallet = (account?.address || "").toLowerCase();
  const isSuperadmin = isPlatformSuperAdmin(wallet);
  const canMerchants = canAccessPanel("merchants", wallet);
  const canPartners = canAccessPanel("partners", wallet);
  const canDevices = canAccessPanel("devices", wallet);
  const canBranding = canAccessPanel("branding", wallet);

  // Admin-only guard: restricted to Dev, Owner and Superadmin
  if (!canDevices) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-10">
        <div className="admin-card p-6">
          <h2 className="text-xl font-semibold text-white/90">Access Denied</h2>
          <div className="text-[10px] text-white/40 uppercase tracking-widest font-medium mt-1">
            Android Device Installer is restricted to Developer, Owner and Superadmin.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 space-y-6 md:pl-64 pt-[144px] md:pt-[88px] pb-10">
      <AdminHero />
      {/* Render sidebar for consistent admin chrome; we don't wire onChange here since this page is standalone */}
      <AdminSidebar
        activeTab={"devices" as any}
        onChangeTab={() => { }}
        industryPack={""}
        canBranding={canBranding}
        canMerchants={canMerchants}
        isSuperadmin={isSuperadmin}
      />
      <div className="admin-card p-6 space-y-3 admin-panel-enter">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Installer Packages</h2>
          <span className="microtext text-muted-foreground">
            Download branded installer ZIPs; first run registers installs
          </span>
        </div>
        <div className="microtext text-muted-foreground">
          Download the ZIP for your brand, run the included Windows .bat (adb install -r), then launch the app.
          The APK phones home on first launch to record the install in Devices.
        </div>
        <InstallerPackagesPanel />
      </div>
    </div>
  );
}
