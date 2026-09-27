"use client";

// Force Polyfill AbortSignal.prototype.throwIfAborted
// This is required for @yume-chan/adb which relies on this method
try {
  if (typeof AbortSignal !== "undefined") {
    Object.defineProperty(AbortSignal.prototype, "throwIfAborted", {
      writable: true,
      configurable: true,
      value: function () {
        if (this.aborted) {
          throw this.reason || new DOMException("The operation was aborted", "AbortError");
        }
      },
    });
    console.log("[DeviceInstallerPanel] AbortSignal.prototype.throwIfAborted polyfilled (forced)");
  }
} catch (e) {
  console.error("[DeviceInstallerPanel] Failed to polyfill AbortSignal:", e);
}

import React from "react";
import { useBrand } from "@/contexts/BrandContext";
import { Download } from "lucide-react";

/**
 * Android Device Installer (WebUSB + WebADB)
 *
 * Goal:
 * - Let an operator connect an Android device from the browser (Chrome on HTTPS/localhost)
 * - Fetch branded APK bytes from server-side API (no direct download)
 * - Push to device and install via package manager
 *
 * Notes:
 * - Requires: Chrome/Edge, HTTPS (or localhost), Android device with USB debugging enabled, correct USB drivers
 * - Libraries: @yume-chan/adb, @yume-chan/adb-daemon-webusb, @yume-chan/adb-credential-web
 *
 * This panel intentionally uses liberal `any` typing around the WebADB APIs to avoid build-time issues if
 * the underlying types change between versions.
 */
export default function DeviceInstallerPanel() {
  const [supported, setSupported] = React.useState<boolean>(true);
  const [connecting, setConnecting] = React.useState<boolean>(false);
  const [connected, setConnected] = React.useState<boolean>(false);
  const [deviceInfo, setDeviceInfo] = React.useState<string>(""); // reserved for future detailed telemetry
  const [logs, setLogs] = React.useState<string>("");
  const adbRef = React.useRef<any>(null);

  React.useEffect(() => {
    console.log("[DeviceInstallerPanel] Mount. AbortSignal.prototype.throwIfAborted present:", !!AbortSignal.prototype.throwIfAborted);
  }, []);

  // Multi-device management
  type ConnectedAdb = { id: string; label: string; adb: any; selected: boolean };
  const [connectedDevices, setConnectedDevices] = React.useState<ConnectedAdb[]>([]);
  const [selectAll, setSelectAll] = React.useState<boolean>(false);

  // Progress tracking for install operations
  type InstallStep = {
    key: string;
    label: string;
    status: "pending" | "active" | "ok" | "error";
    startedAt?: number;
    durationMs?: number;
  };
  type DeviceProgress = {
    deviceId: string;
    deviceLabel: string;
    currentStepIndex: number;
    steps: InstallStep[];
    error?: string;
  };
  const [deviceProgress, setDeviceProgress] = React.useState<Record<string, DeviceProgress>>({});
  const tmpDirCache = React.useRef<Set<string>>(new Set());

  // Progress management helpers
  function initProgressForDevice(deviceId: string, deviceLabel: string) {
    const steps: InstallStep[] = [
      { key: "fetch", label: "Fetching APK", status: "pending" },
      { key: "tmpdir", label: "Preparing device", status: "pending" },
      { key: "push", label: "Pushing APK", status: "pending" },
      { key: "install", label: "Installing", status: "pending" },
      { key: "cleanup", label: "Cleaning up", status: "pending" },
    ];
    setDeviceProgress((prev) => ({
      ...prev,
      [deviceId]: { deviceId, deviceLabel, currentStepIndex: 0, steps },
    }));
  }

  function advanceStep(deviceId: string, stepKey: string) {
    setDeviceProgress((prev) => {
      const prog = prev[deviceId];
      if (!prog) return prev;
      const stepIdx = prog.steps.findIndex((s) => s.key === stepKey);
      if (stepIdx === -1) return prev;
      const updated = { ...prog };
      // Mark previous steps as ok
      for (let i = 0; i < stepIdx; i++) {
        if (updated.steps[i].status === "active") {
          updated.steps[i] = { ...updated.steps[i], status: "ok", durationMs: Date.now() - (updated.steps[i].startedAt || Date.now()) };
        }
      }
      // Mark current step as active
      updated.steps[stepIdx] = { ...updated.steps[stepIdx], status: "active", startedAt: Date.now() };
      updated.currentStepIndex = stepIdx;
      return { ...prev, [deviceId]: updated };
    });
  }

  function completeStep(deviceId: string, stepKey: string, ok: boolean = true) {
    setDeviceProgress((prev) => {
      const prog = prev[deviceId];
      if (!prog) return prev;
      const stepIdx = prog.steps.findIndex((s) => s.key === stepKey);
      if (stepIdx === -1) return prev;
      const updated = { ...prog };
      const step = updated.steps[stepIdx];
      updated.steps[stepIdx] = {
        ...step,
        status: ok ? "ok" : "error",
        durationMs: Date.now() - (step.startedAt || Date.now()),
      };
      return { ...prev, [deviceId]: updated };
    });
  }

  function failStep(deviceId: string, stepKey: string, error: string) {
    setDeviceProgress((prev) => {
      const prog = prev[deviceId];
      if (!prog) return prev;
      const stepIdx = prog.steps.findIndex((s) => s.key === stepKey);
      if (stepIdx === -1) return prev;
      const updated = { ...prog, error };
      const step = updated.steps[stepIdx];
      updated.steps[stepIdx] = {
        ...step,
        status: "error",
        durationMs: Date.now() - (step.startedAt || Date.now()),
      };
      return { ...prev, [deviceId]: updated };
    });
  }

  function clearProgress(deviceId: string) {
    setDeviceProgress((prev) => {
      const next = { ...prev };
      delete next[deviceId];
      return next;
    });
  }

  async function shellCapture(device: any, cmd: string): Promise<string> {
    if (!device) return "";
    try {
      // Optimize getprop: try direct API first, then execute /system/bin/getprop
      const m = /^\s*getprop\s+([^\s]+)\s*$/.exec(cmd);
      if (m) {
        const key = m[1];
        const directGetProp =
          (device?.getProp as any) ||
          (device?.props?.get ? (k: string) => (device as any).props.get(k) : undefined) ||
          (device?.properties?.get ? (k: string) => (device as any).properties.get(k) : undefined);
        if (typeof directGetProp === "function") {
          const v = await directGetProp(key);
          return String(v ?? "");
        }
        const sp1 = device?.subprocess;
        if (sp1?.noneProtocol?.spawnWaitText) {
          try {
            const out = await sp1.noneProtocol.spawnWaitText("/system/bin/getprop", [key]);
            return String(out ?? "");
          } catch { }
        }
        // Fall through to general command execution if direct getprop isn't available
      }

      const sp = device?.subprocess;

      // Preferred v2: noneProtocol.spawnWaitText
      if (sp?.noneProtocol?.spawnWaitText) {
        try {
          const out = await sp.noneProtocol.spawnWaitText("/system/bin/sh", ["-c", cmd]);
          return String(out ?? "");
        } catch { }
      }

      // Additional v2 helpers
      if (typeof (sp as any)?.spawnWaitText === "function") {
        try {
          const out = await (sp as any).spawnWaitText("/system/bin/sh", ["-c", cmd]);
          return String(out ?? "");
        } catch { }
      }
      if (typeof (sp as any)?.spawnAndWaitText === "function") {
        try {
          const out = await (sp as any).spawnAndWaitText("/system/bin/sh", ["-c", cmd]);
          return String(out ?? "");
        } catch { }
      }

      // Generic spawnAndWait returning { stdout, stderr }
      if (typeof (sp as any)?.spawnAndWait === "function") {
        try {
          const result = await (sp as any).spawnAndWait("/system/bin/sh", ["-c", cmd]);
          if (result?.stdout != null) return String(result.stdout);
          if (result?.stderr != null) return String(result.stderr);
        } catch { }
      }

      // Streaming spawn: read stdout chunks
      if (typeof (sp as any)?.spawn === "function") {
        try {
          const proc = await (sp as any).spawn("/system/bin/sh", ["-c", cmd]);
          const decoder = new TextDecoder();
          let output = "";
          if ((proc as any)?.stdout) {
            for await (const chunk of (proc as any).stdout) {
              output += decoder.decode(chunk);
            }
          }
          try { await (proc as any)?.exit; } catch { }
          return output;
        } catch { }
      }

      // Legacy shell attached directly on device
      if (typeof (sp as any)?.shell === "function") {
        try {
          const proc = await (sp as any).shell(cmd);
          const decoder = new TextDecoder();
          let output = "";
          if ((proc as any).stdout) {
            for await (const chunk of (proc as any).stdout) {
              output += decoder.decode(chunk);
            }
          }
          try { await (proc as any).exit; } catch { }
          return output;
        } catch { }
      }
      if (typeof (device as any)?.shell === "function") {
        try {
          const proc = await (device as any).shell(cmd);
          const decoder = new TextDecoder();
          let output = "";
          if ((proc as any).stdout) {
            for await (const chunk of (proc as any).stdout) {
              output += decoder.decode(chunk);
            }
          }
          try { await (proc as any).exit; } catch { }
          return output;
        } catch { }
      }

      // Nothing worked; return empty to avoid polluting labels with error text
      return "";
    } catch {
      return "";
    }
  }

  // Fast temp directory preparation with caching
  async function fastEnsureTmpDir(device: any, deviceId: string): Promise<void> {
    if (tmpDirCache.current.has(deviceId)) return;
    const sp = device?.subprocess;
    if (sp?.noneProtocol?.spawnWaitText) {
      try {
        await sp.noneProtocol.spawnWaitText("/system/bin/sh", ["-c", "[ -d /data/local/tmp ] || mkdir -p /data/local/tmp"]);
        tmpDirCache.current.add(deviceId);
        return;
      } catch { }
    }
    // Fallback: use shellCapture
    try {
      await shellCapture(device, "mkdir -p /data/local/tmp");
      tmpDirCache.current.add(deviceId);
    } catch { }
  }

  // Upload via shell `cat > file` to bypass `sync` service restrictions
  async function uploadViaShellCat(
    device: any,
    remotePath: string,
    data: Uint8Array,
    onProgress?: (message: string) => void
  ): Promise<boolean> {
    try {
      const sp = device?.subprocess;
      // Use generic spawn to get stdin
      const proc =
        (typeof sp?.spawn === "function")
          ? await sp.spawn("/system/bin/sh", ["-c", `cat > "${remotePath}"`])
          : (typeof (sp as any)?.spawnAndWait === "function")
            ? await (sp as any).spawnAndWait("/system/bin/sh", ["-c", `cat > "${remotePath}"`])
            : null;

      if (!proc) return false;

      // Write bytes to stdin with chunking if available
      const stream: any = (proc as any)?.stdin;
      const writer: any = stream?.getWriter ? stream.getWriter() : stream;
      if (writer && typeof writer.write === "function") {
        const CHUNK = 64 * 1024;
        const total = data.byteLength;
        const start = Date.now();
        let written = 0;
        let lastLog = start;
        onProgress?.(`push(cat): started to "${remotePath}" (size=${(total / (1024 * 1024)).toFixed(1)} MB)`);

        // Helper to write with timeout
        const writeWithTimeout = async (chunk: Uint8Array, timeoutMs: number = 10000) => {
          let done = false;
          const p = writer.write(chunk).then(() => { done = true; });
          const t = new Promise<void>((_, rej) => setTimeout(() => {
            if (!done) rej(new Error("write timeout"));
          }, timeoutMs));
          await Promise.race([p, t]);
        };

        for (let offset = 0; offset < total; offset += CHUNK) {
          const end = Math.min(offset + CHUNK, total);
          // 10s timeout per chunk to detect stuck pipe
          try {
            await writeWithTimeout(data.subarray(offset, end), 10000);
          } catch (e: any) {
            onProgress?.(`push(cat): write failed/timed out at offset ${offset}: ${e?.message}`);
            try { await writer.close(); } catch { }
            try { await (proc as any)?.kill?.(); } catch { }
            return false;
          }

          written = end;
          const now = Date.now();
          // Log every ~8MB or every 2s
          if (written % (8 * 1024 * 1024) === 0 || now - lastLog >= 2000) {
            const pct = Math.floor((written / total) * 100);
            const elapsedSec = (now - start) / 1000;
            const mbps = elapsedSec > 0 ? (written / (1024 * 1024)) / elapsedSec : 0;
            const remain = total - written;
            const etaSec = mbps > 0 ? (remain / (1024 * 1024)) / mbps : 0;
            onProgress?.(
              `push(cat): ${pct}% (${(written / (1024 * 1024)).toFixed(1)} MB/${(total / (1024 * 1024)).toFixed(1)} MB) ` +
              `~${mbps.toFixed(2)} MB/s, ETA ~${Math.round(etaSec)}s`
            );
            lastLog = now;
          }
        }
        onProgress?.("push(cat): finished, closing stream");
        try { await writer.close(); } catch { }
        return true;
      }
      return false;
    } catch (e: any) {
      onProgress?.(`push(cat): fatal error: ${e?.message}`);
      return false;
    }
  }



  // Manual interface selection (fallback UI) + caching
  type IfaceOption = {
    interfaceNumber: number;
    alternateSetting: number;
    summary: string;
    priority: number; // lower is better
  };
  const [ifaceModalOpen, setIfaceModalOpen] = React.useState<boolean>(false);
  const [ifaceOptions, setIfaceOptions] = React.useState<IfaceOption[]>([]);
  const [ifaceSelectedIdx, setIfaceSelectedIdx] = React.useState<number>(0);
  const [ifaceDeviceKey, setIfaceDeviceKey] = React.useState<string>(""); // serial or vid:pid label
  const pendingDevRef = React.useRef<any>(null);

  const interfaceCacheRef = React.useRef<Record<string, { iface: number; alt: number }>>({});
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem("adbInterfaceCacheV1");
      if (raw) {
        interfaceCacheRef.current = JSON.parse(raw) || {};
      }
    } catch { }
  }, []);
  function saveInterfaceCache() {
    try {
      localStorage.setItem("adbInterfaceCacheV1", JSON.stringify(interfaceCacheRef.current));
    } catch { }
  }
  function getDeviceKey(dev: any): string {
    const sn = dev?.serialNumber ? String(dev.serialNumber) : "";
    const vid = typeof dev?.vendorId === "number" ? dev.vendorId : undefined;
    const pid = typeof dev?.productId === "number" ? dev.productId : undefined;
    if (sn && sn.trim().length > 0) return sn;
    if (typeof vid !== "undefined" && typeof pid !== "undefined") {
      const h = (n: number) => n.toString(16).padStart(4, "0").toUpperCase();
      return `VID_${h(vid)}&PID_${h(pid)}`;
    }
    return `DEV_${Date.now()}`;
  }

  React.useEffect(() => {
    try {
      const ok = typeof navigator !== "undefined" && !!(navigator as any).usb;
      setSupported(ok);
    } catch {
      setSupported(false);
    }
  }, []);

  // No polyfills: rely on native navigator.usb for Chromium over HTTPS/localhost
  React.useEffect(() => {
    try {
      // no-op
    } catch { }
  }, []);

  function log(line: string) {
    setLogs((prev) => (prev ? prev + "\n" + line : line));
  }

  // Helpers for logging selected device details (VID/PID/SN and known vendor)
  function hex4(n: number | undefined) {
    if (typeof n !== "number" || !isFinite(n)) return "????";
    return n.toString(16).padStart(4, "0").toUpperCase();
  }
  function vendorName(vid?: number): string | undefined {
    if (typeof vid !== "number") return undefined;
    const map: Record<number, string> = {
      0x18D1: "Google/Android",
      0x04E8: "Samsung",
      0x22B8: "Motorola",
      0x2717: "Xiaomi",
      0x2A70: "OnePlus",
      0x054C: "Sony",
      0x12D1: "Huawei",
      0x0BB4: "HTC",
      0x24E3: "Amazon/Lab126",
      0x2D95: "HMD/Nokia",
      0x05C6: "Qualcomm",
      // Common Android POS/terminal SoCs and payment vendors
      0x2207: "Rockchip",
      0x0E8D: "MediaTek",
      0x1B8E: "Amlogic",
      0x1F3A: "Allwinner",
      0x1782: "Spreadtrum/Unisoc",
      0x2CBD: "PAX",
      0x11CA: "Verifone",
    };
    return map[vid];
  }
  function logSelectedDevice(dev: any) {
    try {
      const vid = typeof dev?.vendorId === "number" ? dev.vendorId : undefined;
      const pid = typeof dev?.productId === "number" ? dev.productId : undefined;
      const sn = dev?.serialNumber ? String(dev.serialNumber) : "";
      const vp = `VID_${hex4(vid)}&PID_${hex4(pid)}`;
      const ven = vendorName(vid);
      log(`Selected USB device ${vp}${ven ? ` (${ven})` : ""}${sn ? ` SN ${sn}` : ""}`);
    } catch { }
  }

  // Debug helper to introspect the WebUSB environment and device event hooks
  function debugUsbEnv(context: string, dev?: any) {
    try {
      const g: any = typeof navigator !== "undefined" ? (navigator as any) : undefined;
      const usb = g?.usb;
      const info = [
        `[${context}] WebUSB env`,
        `navigator.usb defined=${!!usb}`,
        `typeof navigator.usb=${typeof usb}`,
        `usb.addEventListener=${typeof usb?.addEventListener}`,
        `usb.removeEventListener=${typeof usb?.removeEventListener}`,
        `usb.onconnect in usb=${usb ? ("onconnect" in usb) : false}`,
        `usb.ondisconnect in usb=${usb ? ("ondisconnect" in usb) : false}`,
        `dev.addEventListener=${typeof dev?.addEventListener}`,
        `dev.removeEventListener=${typeof dev?.removeEventListener}`,
        `USBDevice.prototype.addEventListener=${(() => {
          try {
            const ctor = (g as any)?.USBDevice || (dev && dev.constructor);
            return typeof ctor?.prototype?.addEventListener;
          } catch {
            return "n/a";
          }
        })()}`,
        `USBDevice.prototype.removeEventListener=${(() => {
          try {
            const ctor = (g as any)?.USBDevice || (dev && dev.constructor);
            return typeof ctor?.prototype?.removeEventListener;
          } catch {
            return "n/a";
          }
        })()}`,
      ].join(" | ");
      log(info);
    } catch (e: any) {
      try {
        log(`[${context}] debugUsbEnv error: ${e?.message || String(e)}`);
      } catch { }
    }
  }

  async function robustImportBackend(): Promise<{
    Adb: any;
    AdbDaemonTransport: any;
    AdbDaemonWebUsbConnection: any;
    AdbDaemonWebUsbDeviceManager: any;
    CredentialStore: any;
  }> {
    const adbMod = await import("@yume-chan/adb");
    const daemonWebusbMod = await import("@yume-chan/adb-daemon-webusb").catch(() => ({} as any));
    const credMod = await import("@yume-chan/adb-credential-web").catch(() => ({} as any));

    const Adb = (adbMod as any).Adb || (adbMod as any).default?.Adb || adbMod;

    const AdbDaemonTransport =
      (adbMod as any).AdbDaemonTransport ||
      (adbMod as any).default?.AdbDaemonTransport ||
      (adbMod as any).DaemonTransport ||
      (adbMod as any).default?.DaemonTransport;

    const AdbDaemonWebUsbConnection =
      (daemonWebusbMod as any).AdbDaemonWebUsbConnection ||
      (daemonWebusbMod as any).default?.AdbDaemonWebUsbConnection;

    const AdbDaemonWebUsbDeviceManager =
      (daemonWebusbMod as any).AdbDaemonWebUsbDeviceManager ||
      (daemonWebusbMod as any).default?.AdbDaemonWebUsbDeviceManager;

    const CredentialStore =
      (credMod as any).AdbWebCredentialStore ||
      (credMod as any).default?.AdbWebCredentialStore ||
      class { };

    return {
      Adb,
      AdbDaemonTransport,
      AdbDaemonWebUsbConnection,
      AdbDaemonWebUsbDeviceManager,
      CredentialStore,
    };
  }

  async function ensureAdbConfig(dev: any) {
    await dev.open();
    for (const conf of [1, 2, 3]) {
      try {
        if (!dev.configuration || dev.configuration?.configurationValue !== conf) {
          await dev.selectConfiguration(conf);
        }
      } catch { }
      const cfg = dev.configuration;
      if (cfg && (cfg.interfaces || []).some((i: any) =>
        (i.alternates || []).some((a: any) => a.interfaceClass === 255 && a.interfaceSubclass === 66 && a.interfaceProtocol === 1)
      )) {
        return cfg;
      }
    }
    if (dev.configuration) return dev.configuration;
    throw new Error("No USB interfaces available on device");
  }

  async function robustClaimInterface(dev: any, iface: number, alternates: any[]) {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await ensureAdbConfig(dev);
    const alts = Array.isArray(alternates) ? alternates : [];
    const altSettings: number[] = alts
      .filter((a: any) => {
        const hasBulkIn = (a.endpoints || []).some((e: any) => e.type === "bulk" && e.direction === "in");
        const hasBulkOut = (a.endpoints || []).some((e: any) => e.type === "bulk" && e.direction === "out");
        return hasBulkIn && hasBulkOut;
      })
      .map((a: any) => a.alternateSetting ?? 0);

    if (!altSettings.length) altSettings.push(0);

    for (const alt of altSettings) {
      try {
        try { await releaseAllClaimedInterfaces(dev); } catch { }
        try { await dev.selectAlternateInterface(iface, alt); } catch { }
        await sleep(25);
        await dev.claimInterface(iface);
        return;
      } catch { }
      try {
        try { await releaseAllClaimedInterfaces(dev); } catch { }
        await dev.claimInterface(iface);
        await sleep(25);
        try { await dev.selectAlternateInterface(iface, alt); } catch { }
        return;
      } catch { }
      try {
        try { await (dev as any).close?.(); } catch { }
        await dev.open();
        try { await dev.selectAlternateInterface(iface, alt); } catch { }
        await sleep(25);
        await dev.claimInterface(iface);
        return;
      } catch { }
    }

    try {
      try { await releaseAllClaimedInterfaces(dev); } catch { }
      await dev.claimInterface(iface);
      return;
    } catch (err: any) {
      throw new Error(`Unable to claim interface: ${err?.message || String(err)}`);
    }
  }

  async function manualClaimInterface(dev: any, iface: number, alt: number) {
    const cfg = await ensureAdbConfig(dev);
    const target = (cfg.interfaces as any[]).find((i: any) => i.interfaceNumber === iface);
    const alternates = (target?.alternates || []);
    await robustClaimInterface(dev, iface, alternates.length ? alternates : [{ alternateSetting: alt }]);
  }

  async function releaseAllClaimedInterfaces(dev: any) {
    try {
      const cfg = await ensureAdbConfig(dev);
      for (const i of (cfg.interfaces as any[]) || []) {
        try { await dev.releaseInterface(i.interfaceNumber); } catch { }
      }
    } catch { }
  }

  function buildIfaceSummary(a: any, iNum: number) {
    const cc = a.interfaceClass, sc = a.interfaceSubclass, pc = a.interfaceProtocol;
    const eps = (a.endpoints || []).map((e: any) => `${e.type}:${e.direction}`).join(", ");
    return `if#${iNum} alt#${a.alternateSetting ?? 0} · class ${cc}/${sc}/${pc} · eps [${eps}]`;
  }

  async function enumerateInterfacesForSelection(dev: any): Promise<IfaceOption[]> {
    try {
      const cfg = await ensureAdbConfig(dev);
      const options: IfaceOption[] = [];
      for (const i of cfg.interfaces as any[]) {
        for (const a of i.alternates || []) {
          const hasBulkIn = (a.endpoints || []).some((e: any) => e.type === "bulk" && e.direction === "in");
          const hasBulkOut = (a.endpoints || []).some((e: any) => e.type === "bulk" && e.direction === "out");
          if (hasBulkIn && hasBulkOut) {
            const cc = a.interfaceClass, sc = a.interfaceSubclass, pc = a.interfaceProtocol;
            let priority = 50;
            if (cc === 255 && sc === 66 && pc === 1) priority = 0;
            else if (cc === 255) priority = 10;
            options.push({
              interfaceNumber: i.interfaceNumber,
              alternateSetting: a.alternateSetting ?? 0,
              summary: buildIfaceSummary(a, i.interfaceNumber),
              priority,
            });
          }
        }
      }
      options.sort((a, b) => a.priority - b.priority);
      return options;
    } catch {
      return [];
    }
  }

  function getUsbApi() {
    try { return (navigator as any).usb; } catch { return undefined; }
  }

  // Ensure the concrete USB device instance has event target methods so libraries that
  // read device.addEventListener/removeEventListener don't crash.
  function ensureDeviceEventTargets(dev: any) {
    try {
      if (!dev || typeof dev !== "object") return;
      if (typeof (dev as any).addEventListener !== "function") (dev as any).addEventListener = () => { };
      if (typeof (dev as any).removeEventListener !== "function") (dev as any).removeEventListener = () => { };
      if (!("onconnect" in (dev as any))) (dev as any).onconnect = null;
      if (!("ondisconnect" in (dev as any))) (dev as any).ondisconnect = null;
    } catch { }
  }

  // Create a WebUSB daemon connection across different library export shapes.
  // Tries static fromDevice, constructor form, and common factory patterns.
  async function createDaemonWebUsbConnection(ConnCtor: any, dev: any, options?: any): Promise<any> {
    // 1) Preferred: static fromDevice(dev, options?)
    try {
      if (ConnCtor && typeof ConnCtor.fromDevice === "function") {
        return await ConnCtor.fromDevice(dev, options);
      }
    } catch { }
    // 2) Constructor: new ConnCtor(dev, options?)
    try {
      if (typeof ConnCtor === "function") {
        const instance = options !== undefined ? new ConnCtor(dev, options) : new ConnCtor(dev);
        // Some implementations require an explicit connect() before use
        if (instance && typeof instance.connect === "function") {
          await instance.connect();
        }
        return instance;
      }
    } catch { }
    // 3) Namespaced default export containing class or factory
    try {
      const ns = ConnCtor?.default;
      if (ns && typeof ns.fromDevice === "function") {
        return await ns.fromDevice(dev, options);
      }
      if (ns && typeof ns === "function") {
        const instance = options !== undefined ? new ns(dev, options) : new ns(dev);
        if (instance && typeof instance.connect === "function") {
          await instance.connect();
        }
        return instance;
      }
      const inner = ConnCtor?.AdbDaemonWebUsbConnection || ConnCtor?.default?.AdbDaemonWebUsbConnection;
      if (inner && typeof inner.fromDevice === "function") {
        return await inner.fromDevice(dev, options);
      }
      if (typeof inner === "function") {
        const instance = options !== undefined ? new inner(dev, options) : new inner(dev);
        if (instance && typeof instance.connect === "function") {
          await instance.connect();
        }
        return instance;
      }
    } catch { }
    // 4) Generic factory function shapes
    try {
      const factory = ConnCtor?.create || ConnCtor?.default?.create || ConnCtor;
      if (typeof factory === "function") {
        return await factory(dev, options);
      }
    } catch { }
    throw new Error("Unsupported AdbDaemonWebUsbConnection API: cannot create connection");
  }

  // Preferred path for @yume-chan/adb-daemon-webusb v2.x via DeviceManager
  async function createConnectionUsingManager(DeviceManager: any, dev: any, usbHost?: any, filters?: any[]): Promise<any> {
    const mgr =
      (DeviceManager && DeviceManager.BROWSER) ||
      (DeviceManager && usbHost ? new DeviceManager(usbHost) : undefined);
    if (!mgr) {
      throw new Error("WebUSB DeviceManager unavailable");
    }
    const opts = filters && filters.length > 0 ? { filters } : undefined;
    const devices: any[] = await mgr.getDevices(opts);
    const wrapped = devices.find((d: any) => d && d.raw === dev);
    if (!wrapped) {
      const requested = await mgr.requestDevice(opts);
      if (!requested) {
        throw new Error("No matching ADB device found for the selected USB device");
      }
      return await requested.connect();
    }
    return await wrapped.connect();
  }

  // Build a connection directly from a raw USBDevice and selected interface/alternate.
  // This avoids relying on static factories that may differ across package versions.
  async function createConnectionFromRaw(dev: any, ifaceNumber: number, altSetting: number, usbHost: any): Promise<any> {
    // Ensure configuration is selected and available
    const cfg = await ensureAdbConfig(dev);
    const iface = (cfg.interfaces as any[]).find((i: any) => i.interfaceNumber === ifaceNumber);
    if (!iface) {
      throw new Error("Selected interface not found on device");
    }
    const alt = (iface.alternates || []).find((a: any) => (a.alternateSetting ?? 0) === altSetting)
      || (iface.alternates || [])[0];
    if (!alt) {
      throw new Error("Selected alternate setting not found on interface");
    }

    // Construct UsbInterfaceIdentifier expected by AdbDaemonWebUsbDevice
    const identifier = { configuration: cfg, interface_: iface, alternate: alt };

    // Import device wrapper class and create a connection
    const daemonWebusbMod: any = await import("@yume-chan/adb-daemon-webusb").catch(() => ({} as any));
    const AdbDaemonWebUsbDevice =
      daemonWebusbMod.AdbDaemonWebUsbDevice ||
      daemonWebusbMod.default?.AdbDaemonWebUsbDevice;

    if (!AdbDaemonWebUsbDevice) {
      throw new Error("AdbDaemonWebUsbDevice class not available");
    }

    const wrapped = new (AdbDaemonWebUsbDevice as any)(dev, identifier, usbHost);
    const connection = await wrapped.connect();
    return connection;
  }

  async function connectOne(usbDevice?: any) {
    const {
      Adb,
      AdbDaemonTransport,
      AdbDaemonWebUsbConnection,
      AdbDaemonWebUsbDeviceManager,
      CredentialStore,
    } = await robustImportBackend();
    ensureAuthenticate(Adb);

    let dev: any = usbDevice;
    if (!dev) {
      const usbApi = (navigator as any).usb;
      if (!usbApi?.requestDevice) throw new Error("WebUSB not available");
      dev = await usbApi.requestDevice({
        filters: [
          { vendorId: 0x18D1 }, // Google/Android
          { classCode: 255, subclassCode: 66, protocolCode: 1 }, // ADB interface
          { classCode: 255 }, // vendor-specific fallback
        ],
      });
    }
    if (!dev) throw new Error("No USB device selected");

    // Log identity and environment
    logSelectedDevice(dev);
    ensureDeviceEventTargets(dev);
    debugUsbEnv("connectOne-pre-connect", dev);

    try {
      const usbHost = getUsbApi();
      const options = usbHost
        ? {
          usb: usbHost,
          addEventListener: typeof usbHost.addEventListener === "function" ? usbHost.addEventListener.bind(usbHost) : undefined,
          removeEventListener: typeof usbHost.removeEventListener === "function" ? usbHost.removeEventListener.bind(usbHost) : undefined,
        }
        : undefined;

      let conn: any;
      try {
        conn = await createConnectionUsingManager(AdbDaemonWebUsbDeviceManager as any, dev, usbHost);
      } catch { }
      if (!conn) {
        const candidates = await enumerateInterfacesForSelection(dev);
        const best = candidates?.[0];
        if (best) {
          try {
            conn = await createConnectionFromRaw(dev, best.interfaceNumber, best.alternateSetting, usbHost);
          } catch { }
        }
      }
      if (!conn) {
        throw new Error("Failed to create ADB WebUSB connection");
      }

      const store = new (CredentialStore as any)("payportal-webadb");
      const transport: any = await (AdbDaemonTransport as any).authenticate({
        connection: conn,
        credentialStore: store,
      });
      const AdbCtor =
        (typeof Adb === "function" && (Adb as any).prototype)
          ? Adb
          : ((Adb as any).Adb || (Adb as any).default?.Adb);
      if (!AdbCtor || typeof AdbCtor !== "function") {
        throw new Error("Adb class not available");
      }
      const adbDevice = new (AdbCtor as any)(transport);

      // Describe device with serial fallback
      let label = "(connected)";
      try {
        const prop = await shellCapture(adbDevice, "getprop ro.product.model");
        const device = await shellCapture(adbDevice, "getprop ro.product.device");
        const serial = await shellCapture(adbDevice, "getprop ro.serialno");
        const android = await shellCapture(adbDevice, "getprop ro.build.version.release");
        const sdk = await shellCapture(adbDevice, "getprop ro.build.version.sdk");

        const model = prop?.trim() || device?.trim() || dev?.serialNumber?.trim() || serial?.trim() || "(unknown)";
        const serialShown = serial?.trim() || dev?.serialNumber?.trim() || "";
        const labelParts = [model];
        if (android?.trim()) labelParts.push(`Android ${android.trim()}`);
        if (sdk?.trim()) labelParts.push(`SDK ${sdk.trim()}`);
        if (serialShown && serialShown !== model) labelParts.push(`SN ${serialShown}`);
        label = labelParts.filter(Boolean).join(" · ");
      } catch { }

      const id = String(dev?.serialNumber || (typeof crypto !== "undefined" && (crypto as any)?.randomUUID?.()) || `${Date.now()}`);
      setConnectedDevices((prev) => {
        const next = prev.filter((d) => d.id !== id);
        next.push({ id, label, adb: adbDevice, selected: selectAll });
        return next;
      });
      setConnected(true);
      adbRef.current = adbDevice;
      log(`ADB authenticated (daemon transport): ${label}`);
      return;
    } catch (err: any) {
      // If daemon flow fails, offer manual selection
      const options = await enumerateInterfacesForSelection(dev);
      if (options && options.length > 0) {
        pendingDevRef.current = dev;
        setIfaceOptions(options);
        setIfaceSelectedIdx(0);
        const key = getDeviceKey(dev);
        setIfaceDeviceKey(key);
        setIfaceModalOpen(true);
        log(`Manual selection required for ${key}. Please choose an interface below and click Connect.`);
        return;
      }
      throw err;
    }
  }

  async function manualConnectWithSelectedInterface() {
    const dev = pendingDevRef.current;
    if (!dev) {
      setIfaceModalOpen(false);
      return;
    }
    const choice = ifaceOptions[ifaceSelectedIdx];
    if (!choice) {
      log("No interface selected.");
      return;
    }

    const {
      Adb,
      AdbDaemonTransport,
      AdbDaemonWebUsbConnection,
      AdbDaemonWebUsbDeviceManager,
      CredentialStore,
    } = await robustImportBackend();
    ensureAuthenticate(Adb);

    try {
      // Claim selected interface (retry once with reopen)
      try {
        await manualClaimInterface(dev, choice.interfaceNumber, choice.alternateSetting);
      } catch (claimErr: any) {
        log(`Manual claim first attempt failed: ${claimErr?.message || String(claimErr)}`);
        try { log(claimErr?.stack ? String(claimErr.stack) : "(no stack)"); } catch { }
        debugUsbEnv("manual-claim-fail-1", dev);
        try { await (dev as any).close?.(); } catch { }
        await dev.open();
        await manualClaimInterface(dev, choice.interfaceNumber, choice.alternateSetting);
      }

      const key = getDeviceKey(dev);
      interfaceCacheRef.current[key] = { iface: choice.interfaceNumber, alt: choice.alternateSetting };
      saveInterfaceCache();

      // Daemon connection
      ensureDeviceEventTargets(dev);
      const usbHost = getUsbApi();
      const options = usbHost
        ? {
          usb: usbHost,
          addEventListener: typeof usbHost.addEventListener === "function" ? usbHost.addEventListener.bind(usbHost) : undefined,
          removeEventListener: typeof usbHost.removeEventListener === "function" ? usbHost.removeEventListener.bind(usbHost) : undefined,
        }
        : undefined;

      let conn: any;
      try {
        conn = await createConnectionUsingManager(AdbDaemonWebUsbDeviceManager as any, dev, usbHost);
      } catch { }
      if (!conn) {
        try {
          conn = await createDaemonWebUsbConnection(AdbDaemonWebUsbConnection, dev, options);
        } catch { }
      }
      if (!conn) {
        try {
          conn = await createConnectionFromRaw(dev, choice.interfaceNumber, choice.alternateSetting, usbHost);
        } catch { }
      }
      if (!conn) {
        throw new Error("Failed to create ADB WebUSB connection for selected interface");
      }

      const store = new (CredentialStore as any)("payportal-webadb");
      const transport: any = await (AdbDaemonTransport as any).authenticate({
        connection: conn,
        credentialStore: store,
      });
      const AdbCtor =
        (typeof Adb === "function" && (Adb as any).prototype)
          ? Adb
          : ((Adb as any).Adb || (Adb as any).default?.Adb);
      if (!AdbCtor || typeof AdbCtor !== "function") {
        throw new Error("Adb class not available");
      }
      const adbDevice = new (AdbCtor as any)(transport);

      let label = "(connected)";
      try {
        const prop = await shellCapture(adbDevice, "getprop ro.product.model");
        const device = await shellCapture(adbDevice, "getprop ro.product.device");
        const serial = await shellCapture(adbDevice, "getprop ro.serialno");
        const android = await shellCapture(adbDevice, "getprop ro.build.version.release");
        const sdk = await shellCapture(adbDevice, "getprop ro.build.version.sdk");

        const model = prop?.trim() || device?.trim() || dev?.serialNumber?.trim() || serial?.trim() || "(unknown)";
        const serialShown = serial?.trim() || dev?.serialNumber?.trim() || "";
        const labelParts = [model];
        if (android?.trim()) labelParts.push(`Android ${android.trim()}`);
        if (sdk?.trim()) labelParts.push(`SDK ${sdk.trim()}`);
        if (serialShown && serialShown !== model) labelParts.push(`SN ${serialShown}`);
        label = labelParts.filter(Boolean).join(" · ");
      } catch { }

      const id = String(dev?.serialNumber || (typeof crypto !== "undefined" && (crypto as any)?.randomUUID?.()) || `${Date.now()}`);
      setConnectedDevices((prev) => {
        const next = prev.filter((d) => d.id !== id);
        next.push({ id, label, adb: adbDevice, selected: selectAll });
        return next;
      });
      setConnected(true);
      adbRef.current = adbDevice;
      log(`ADB authenticated using daemon transport (manual interface).`);
      setIfaceModalOpen(false);
      setIfaceOptions([]);
      pendingDevRef.current = null;
      return;
    } catch (err: any) {
      log(`Manual claim/connect failed: ${err?.message || String(err)}`);
    }
  }

  function cancelManualInterfaceSelection() {
    setIfaceModalOpen(false);
    setIfaceOptions([]);
    pendingDevRef.current = null;
    log("Manual interface selection cancelled.");
  }

  // Manually open an interface picker by requesting a device, enumerating interfaces,
  // and showing the selection modal without waiting for auto-connect failure.
  async function openInterfacePicker() {
    try {
      setConnecting(true);
      setLogs("");
      let dev: any = null;
      const usbApi = (navigator as any).usb;
      if (usbApi?.requestDevice) {
        dev = await usbApi.requestDevice({
          filters: [
            { vendorId: 0x18D1 }, // Google/Android
            { classCode: 255, subclassCode: 66, protocolCode: 1 }, // ADB interface
            { classCode: 255 }, // vendor-specific fallback
          ],
        });
      } else {
        log("WebUSB not available for interface picker.");
        return;
      }
      if (!dev) {
        log("No device selected.");
        return;
      }
      // Log picked device
      logSelectedDevice(dev);
      try { await dev.open(); } catch { }
      const options = await enumerateInterfacesForSelection(dev);
      pendingDevRef.current = dev;
      const key = getDeviceKey(dev);
      setIfaceDeviceKey(key);
      if (options && options.length > 0) {
        setIfaceOptions(options);
        setIfaceSelectedIdx(0);
        setIfaceModalOpen(true);
        log(`Manual selection available for ${key}. Choose an interface and connect.`);
      } else {
        setIfaceOptions([]);
        setIfaceSelectedIdx(0);
        setIfaceModalOpen(true);
        log("No suitable bulk interfaces found. Driver change (WinUSB) may be required.");
      }
    } catch (e: any) {
      log(`Interface picker error: ${e?.message || String(e)}`);
    } finally {
      setConnecting(false);
    }
  }

  async function connectDevice() {
    setConnecting(true);
    setLogs("");
    try {
      // Call requestDevice first while still in the user gesture to ensure the chooser can appear
      let preDev: any = null;
      const usbApi = (navigator as any).usb;
      try {
        if (usbApi?.requestDevice) {
          const primaryFilters = [
            { vendorId: 0x18D1 }, // Google/Android
            { classCode: 255, subclassCode: 66, protocolCode: 1 }, // canonical ADB on many devices
            { classCode: 255 }, // vendor-specific fallback
          ];
          preDev = await usbApi.requestDevice({ filters: primaryFilters });
        } else {
          log("WebUSB requestDevice unavailable (require HTTPS or localhost, top-level frame).");
        }
      } catch (e: any) {
        const name = (e && e.name) || "";
        if (/NotFoundError|SecurityError/i.test(name) || /No device selected|Access denied/i.test(String(e?.message || ""))) {
          try {
            if (usbApi?.requestDevice) {
              const ADB_VENDOR_IDS = [
                0x18D1, 0x04E8, 0x22B8, 0x2717, 0x2A70, 0x054C, 0x12D1, 0x0BB4, 0x24E3, 0x2D95, 0x05C6,
                0x2207, 0x0E8D, 0x1B8E, 0x1F3A, 0x1782, 0x2CBD, 0x11CA,
              ];
              const vendorFilters = ADB_VENDOR_IDS.map((vid) => ({ vendorId: vid }));
              preDev = await usbApi.requestDevice({ filters: vendorFilters });
            }
          } catch (e2: any) {
            log(`USB chooser retry error: ${e2?.message || String(e2)}`);
          }
        } else {
          log(`USB chooser error: ${e?.message || String(e)}`);
        }
      }
      if (!preDev) {
        try {
          if (usbApi?.requestDevice) {
            preDev = await usbApi.requestDevice({ filters: [{}] });
          }
        } catch (e3: any) {
          log(`USB chooser final fallback error: ${e3?.message || String(e3)}`);
        }
        if (!preDev) {
          log("No device was selected or no matching devices were available in the chooser.");
        }
      }
      if (preDev) {
        logSelectedDevice(preDev);
      }
      await connectOne(preDev || undefined);
    } finally {
      setConnecting(false);
    }
  }

  async function scanAuthorizedDevices() {
    setConnecting(true);
    setLogs("");
    try {
      const devices = (navigator as any).usb?.getDevices ? await (navigator as any).usb.getDevices() : [];
      if (!devices || devices.length === 0) {
        log("No authorized USB devices found. Use 'Add Device' to grant access.");
      }
      for (const dev of devices) {
        logSelectedDevice(dev);
        await connectOne(dev);
      }
    } catch (e: any) {
      log(`Scan error: ${e?.message || String(e)}`);
    } finally {
      setConnecting(false);
    }
  }

  function toggleSelect(id: string) {
    setConnectedDevices((prev) => prev.map((d) => (d.id === id ? { ...d, selected: !d.selected } : d)));
  }

  function toggleSelectAll() {
    setSelectAll((s) => {
      const next = !s;
      setConnectedDevices((prev) => prev.map((d) => ({ ...d, selected: next })));
      return next;
    });
  }

  async function fetchApkBytes(app: "paynex" | "portalpay"): Promise<Uint8Array> {
    const res = await fetch(`/api/admin/apk/${app}`, {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch ${app} APK: ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }

  async function ensureTmpDir(device: any) {
    try {
      await shellCapture(device, "mkdir -p /data/local/tmp");
    } catch { }
  }

  async function postInstallLog(app: "paynex" | "portalpay", success: boolean, bytes: number, installOutput: string) {
    try {
      await fetch("/api/admin/apk/installs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app,
          brandKey: brandEnv || undefined,
          success,
          bytes,
          device: deviceInfo ? { label: deviceInfo } : undefined,
          installOutput: installOutput ? String(installOutput).slice(0, 4000) : undefined,
        }),
      });
    } catch { }
  }

  // Helper to create a safe AbortSignal that definitely has throwIfAborted
  function createSafeSignal() {
    const controller = new AbortController();
    const signal = controller.signal;
    // Always force-define the method on the instance
    Object.defineProperty(signal, "throwIfAborted", {
      configurable: true,
      writable: true,
      value: function () {
        if (this.aborted) {
          throw this.reason || new DOMException("The operation was aborted", "AbortError");
        }
      }
    });
    return { controller, signal };
  }

  async function pushAndInstall(app: "paynex" | "portalpay") {
    setLogs("");
    const targets =
      connectedDevices.filter((d) => d.selected) ||
      (adbRef.current ? [{ id: "single", label: deviceInfo || "(connected)", adb: adbRef.current, selected: true }] : []);
    if (!targets || targets.length === 0) {
      log("No devices selected");
      return;
    }

    for (const dev of targets) {
      initProgressForDevice(dev.id, dev.label);
      try {
        advanceStep(dev.id, "fetch");
        log(`[${dev.label}] Fetching ${app} APK from server…`);
        let bytes = await fetchApkBytes(app);
        completeStep(dev.id, "fetch", true);

        try {
          advanceStep(dev.id, "install");
          log(`[${dev.label}] Installing via session (create/write/commit)…`);
          const sessRes = await installViaSession(dev.adb, bytes, (msg) => log(`[${dev.label}] ${msg}`));
          if (sessRes.output) log(sessRes.output.trim() || "(no output)");
          if (sessRes.success) {
            completeStep(dev.id, "install", true);
            log(`[${dev.label}] Install succeeded (session).`);
            try { await postInstallLog(app, true, bytes.byteLength, sessRes.output); } catch { }
            completeStep(dev.id, "push", true);
            advanceStep(dev.id, "cleanup");
            completeStep(dev.id, "cleanup", true);
            setTimeout(() => clearProgress(dev.id), 3000);
            continue;
          }

          log(`[${dev.label}] Session install did not report Success; trying direct -S streaming…`);
          const streamRes = await installViaStream(dev.adb, bytes, (msg) => log(`[${dev.label}] ${msg}`));
          if (streamRes.output) log(streamRes.output.trim() || "(no output)");
          if (streamRes.success) {
            completeStep(dev.id, "install", true);
            log(`[${dev.label}] Install succeeded (stream).`);
            try { await postInstallLog(app, true, bytes.byteLength, streamRes.output); } catch { }
            completeStep(dev.id, "push", true);
            advanceStep(dev.id, "cleanup");
            completeStep(dev.id, "cleanup", true);
            setTimeout(() => clearProgress(dev.id), 3000);
            continue;
          } else {
            log(`[${dev.label}] Streaming install did not report Success; falling back to push + install.`);
          }
        } catch { }

        const primaryPath = `/sdcard/Download/${app}.apk`;
        const altPaths = [`/storage/emulated/0/Download/${app}.apk`, `/data/local/tmp/${app}.apk`];
        let usedRemotePath = primaryPath;

        advanceStep(dev.id, "push");
        log(`[${dev.label}] Pushing ${app}.apk (${bytes.byteLength.toLocaleString()} bytes)…`);

        let pushSucceeded = false;
        try {
          pushSucceeded = await uploadViaShellCat(dev.adb, primaryPath, bytes, (m) => log(`[${dev.label}] ${m}`));
        } catch (e: any) {
          log(`[${dev.label}] Push failed: ${e?.message}`);
        }

        if (!pushSucceeded) {
          advanceStep(dev.id, "tmpdir");
          log(`[${dev.label}] Preparing device tmp directory…`);
          try {
            await Promise.race([fastEnsureTmpDir(dev.adb, dev.id), new Promise((_r, rej) => setTimeout(() => rej(new Error("tmpdir timeout")), 8000))]);
            completeStep(dev.id, "tmpdir", true);
          } catch (e: any) {
            completeStep(dev.id, "tmpdir", false);
            log(`[${dev.label}] tmp directory preparation skipped/timed out: ${e?.message || String(e)}`);
          }

          for (const p of altPaths) {
            try {
              const ok = await uploadViaShellCat(dev.adb, p, bytes, (m) => log(`[${dev.label}] ${m}`));
              if (ok) {
                pushSucceeded = true;
                usedRemotePath = p;
                log(`[${dev.label}] Using fallback path ${p}`);
                break;
              }
            } catch { }
          }

          if (!pushSucceeded) throw new Error("push failed: unable to upload APK to device using any path");
        }

        completeStep(dev.id, "push", true);
        log(`[${dev.label}] Push complete.`);

        advanceStep(dev.id, "install");
        log(`[${dev.label}] Installing (pm install -r)…`);
        const out = (await shellCapture(dev.adb, `pm install -r "${usedRemotePath}" || cmd package install -r "${usedRemotePath}"`)) || "";
        log(out.trim() || "(no output)");

        const success = /Success/i.test(out);
        completeStep(dev.id, "install", success);
        if (success) {
          log(`[${dev.label}] Install succeeded.`);
        } else {
          log(`[${dev.label}] Install did not report Success; check device screen/logs.`);
        }

        try { await postInstallLog(app, success, bytes.byteLength, out); } catch { }

        advanceStep(dev.id, "cleanup");
        log(`[${dev.label}] Cleaning up temp APK…`);
        try { await shellCapture(dev.adb, `rm -f "${usedRemotePath}"`); } catch { }
        completeStep(dev.id, "cleanup", true);
        log(`[${dev.label}] Done.`);

        setTimeout(() => clearProgress(dev.id), 3000);
      } catch (e: any) {
        const errMsg = e?.message || String(e);
        log(`Install error on ${dev.label}: ${errMsg}`);
        const prog = deviceProgress[dev.id];
        if (prog) {
          const activeStep = prog.steps[prog.currentStepIndex];
          if (activeStep) failStep(dev.id, activeStep.key, errMsg);
        }
      }
    }
  }

  async function installViaStream(
    device: any,
    data: Uint8Array,
    onProgress?: (message: string) => void
  ): Promise<{ success: boolean; output: string }> {
    try {
      const size = data?.byteLength ?? 0;
      if (size <= 0) return { success: false, output: "" };

      const cmds = [
        `cmd package install -r -S ${size}`,
        `pm install -r -S ${size}`,
        `cmd package install -S ${size}`,
        `pm install -S ${size}`,
      ];

      for (const cmd of cmds) {
        onProgress?.(`stream-install: trying cmd '${cmd}'`);
        try {
          const sp: any = device?.subprocess;
          let proc: any = undefined;

          const { controller, signal } = createSafeSignal();

          if (typeof sp?.spawn === "function") {
            proc = await sp.spawn("/system/bin/sh", ["-c", cmd], { signal });
          } else if (typeof sp?.noneProtocol?.spawn === "function") {
            proc = await sp.noneProtocol.spawn("/system/bin/sh", ["-c", cmd], { signal });
          } else {
            proc = undefined;
          }

          if (!proc) continue;

          const stream: any = proc?.stdin;
          const writer: any = stream?.getWriter ? stream.getWriter() : stream;

          if (writer && typeof writer.write === "function") {
            const CHUNK = 64 * 1024;
            const total = data.byteLength;
            let written = 0;
            let lastLogged = Date.now();

            for (let offset = 0; offset < total; offset += CHUNK) {
              const end = Math.min(offset + CHUNK, total);
              await writer.write(data.subarray(offset, end));
              written = end;
              const now = Date.now();
              if (written % (8 * 1024 * 1024) === 0 || now - lastLogged >= 2000) {
                const pct = Math.floor((written / total) * 100);
                onProgress?.(`stream-install: ${pct}%`);
                lastLogged = now;
              }
            }

            try {
              if (typeof writer.close === "function") await writer.close();
              else if (typeof writer.releaseLock === "function") writer.releaseLock();
            } catch { }
          }

          const decoder = new TextDecoder();
          let output = "";
          if (proc?.stdout) {
            for await (const chunk of proc.stdout) {
              output += decoder.decode(chunk);
            }
          }
          try { await proc?.exit; } catch { }
          if (/Success/i.test(output)) {
            return { success: true, output };
          }
        } catch (e: any) {
          onProgress?.(`stream-install: error with '${cmd}': ${e?.message}`);
        }
      }
      return { success: false, output: "" };
    } catch (e: any) {
      onProgress?.(`stream-install: fatal error: ${e?.message}`);
      return { success: false, output: "" };
    }
  }

  async function installViaSession(
    device: any,
    data: Uint8Array,
    onProgress?: (message: string) => void
  ): Promise<{ success: boolean; output: string }> {
    try {
      const size = data?.byteLength ?? 0;
      if (size <= 0) return { success: false, output: "" };

      onProgress?.("session-create: starting");
      const CREATE_TIMEOUT_MS = 10000;

      let createOut: string = "";
      try {
        createOut = await Promise.race<string>([
          shellCapture(device, "cmd package install-create -r"),
          new Promise((_r, rej) => setTimeout(() => rej(new Error("session-create timeout (cmd)")), CREATE_TIMEOUT_MS)) as Promise<string>,
        ]);
      } catch (e: any) {
        onProgress?.(`session-create: cmd variant failed (${e?.message || String(e)}), trying pm variant`);
        try {
          createOut = await Promise.race<string>([
            shellCapture(device, "pm install-create -r"),
            new Promise((_r, rej) => setTimeout(() => rej(new Error("session-create timeout (pm)")), CREATE_TIMEOUT_MS)) as Promise<string>,
          ]);
        } catch (e2: any) {
          onProgress?.(`session-create: pm variant failed (${e2?.message || String(e2)})`);
          return { success: false, output: `session-create failed: ${e?.message || ""} ${e2?.message || ""}`.trim() };
        }
      }
      onProgress?.(`session-create: ${createOut.trim() || "(no output)"}`);

      let sid = "";
      try {
        const m = /session(?:\s+id|\s+ID)?\s*(\d+)/i.exec(createOut) || /ID\s*(\d+)/i.exec(createOut) || /(\d+)/.exec(createOut);
        sid = m && m[1] ? m[1] : "";
      } catch { }
      if (!sid) return { success: false, output: createOut || "" };

      const cmds = [
        `cmd package install-write -S ${size} ${sid} base.apk`,
        `pm install-write -S ${size} ${sid} base.apk`,
      ];
      let writeOk = false;
      let writeOut = "";
      for (const cmd of cmds) {
        try {
          const sp: any = device?.subprocess;
          let proc: any = undefined;

          if (typeof sp?.spawn === "function") {
            proc = await sp.spawn("/system/bin/sh", ["-c", cmd]);
          } else if (typeof sp?.noneProtocol?.spawn === "function") {
            proc = await sp.noneProtocol.spawn("/system/bin/sh", ["-c", cmd]);
          } else {
            proc = undefined;
          }
          const stream: any = proc?.stdin;
          const writer: any = stream?.getWriter ? stream.getWriter() : stream;
          if (writer && typeof writer.write === "function") {
            const CHUNK = 64 * 1024;
            const total = data.byteLength;
            let written = 0;
            let lastLogged = Date.now();
            onProgress?.(`session-write: started (size=${(total / (1024 * 1024)).toFixed(1)} MB)`);

            for (let offset = 0; offset < total; offset += CHUNK) {
              const end = Math.min(offset + CHUNK, total);
              await writer.write(data.subarray(offset, end));
              written = end;
              const now = Date.now();
              if (written % (8 * 1024 * 1024) === 0 || now - lastLogged >= 2000) {
                const pct = Math.floor((written / total) * 100);
                onProgress?.(`session-write: ${pct}% (${(written / (1024 * 1024)).toFixed(1)} MB/${(total / (1024 * 1024)).toFixed(1)} MB)`);
                lastLogged = now;
              }
            }
            onProgress?.("session-write: finished, closing stream");
            if (typeof writer.close === "function") {
              await writer.close();
            } else if (typeof writer.releaseLock === "function") {
              writer.releaseLock();
            }
          }
          const decoder = new TextDecoder();
          let out = "";
          if (proc?.stdout) {
            for await (const chunk of proc.stdout) {
              out += decoder.decode(chunk);
            }
          }
          try { await proc?.exit; } catch { }
          writeOut = out;
          if (/Success/i.test(out)) {
            writeOk = true;
            break;
          }
        } catch { }
      }
      if (!writeOk) return { success: false, output: writeOut || "" };

      onProgress?.("session-commit: committing");
      const COMMIT_TIMEOUT_MS = 60000;

      let commitOut: string = "";
      try {
        commitOut = await Promise.race<string>([
          shellCapture(device, `cmd package install-commit ${sid}`),
          new Promise((_r, rej) => setTimeout(() => rej(new Error("session-commit timeout (cmd)")), COMMIT_TIMEOUT_MS)) as Promise<string>,
        ]);
      } catch (e: any) {
        onProgress?.(`session-commit: cmd variant failed (${e?.message || String(e)}), trying pm variant`);
        try {
          commitOut = await Promise.race<string>([
            shellCapture(device, `pm install-commit ${sid}`),
            new Promise((_r, rej) => setTimeout(() => rej(new Error("session-commit timeout (pm)")), COMMIT_TIMEOUT_MS)) as Promise<string>,
          ]);
        } catch (e2: any) {
          onProgress?.(`session-commit: pm variant failed (${e2?.message || String(e2)})`);
          return { success: false, output: `session-commit failed: ${e?.message || ""} ${e2?.message || ""}`.trim() };
        }
      }
      onProgress?.(`session-commit: ${commitOut.trim() || "(no output)"}`);
      const finalOut = `${createOut || ""}\n${writeOut || ""}\n${commitOut || ""}`.trim();
      return { success: /Success/i.test(commitOut), output: finalOut };
    } catch {
      return { success: false, output: "" };
    }
  }

  const [containerType, setContainerType] = React.useState<string>("platform");
  const [brandEnv, setBrandEnv] = React.useState<string>("");
  React.useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/site/container", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (j && typeof j.containerType === "string") {
          setContainerType(String(j.containerType).toLowerCase());
        }
        if (j && typeof j.brandKey === "string") {
          setBrandEnv(String(j.brandKey).toLowerCase());
        }
      } catch { }
    })();
  }, []);
  const targetApp: "portalpay" | "paynex" = brandEnv === "paynex" ? "paynex" : "portalpay";

  const [installTotals, setInstallTotals] = React.useState<{ portalpay?: number; paynex?: number }>({});
  const [appInstallTotals, setAppInstallTotals] = React.useState<{ portalpay?: number; paynex?: number }>({});
  React.useEffect(() => {
    (async () => {
      if (!brandEnv) return;
      try {
        const apps: ("portalpay" | "paynex")[] =
          containerType === "partner" ? [brandEnv === "paynex" ? "paynex" : "portalpay"] : ["portalpay", "paynex"];
        const totals: { [k: string]: number } = {};
        for (const a of apps) {
          const res = await fetch(
            `/api/admin/apk/installs?app=${a}&brandKey=${encodeURIComponent(brandEnv)}&limit=1`,
            { cache: "no-store" }
          );
          if (res.ok) {
            const data = await res.json().catch(() => ({}));
            totals[a] = Number(data?.total || 0);
          }
        }
        setInstallTotals(totals);
      } catch { }
    })();
  }, [containerType, brandEnv]);

  // Phone-home app install totals (first-run telemetry from the APK)
  React.useEffect(() => {
    (async () => {
      if (!brandEnv) return;
      try {
        const apps: ("portalpay" | "paynex")[] =
          containerType === "partner" ? [brandEnv === "paynex" ? "paynex" : "portalpay"] : ["portalpay", "paynex"];
        const totals: { [k: string]: number } = {};
        for (const a of apps) {
          const res = await fetch(
            `/api/app/installs?app=${a}&brandKey=${encodeURIComponent(brandEnv)}&limit=1`,
            { cache: "no-store" }
          );
          if (res.ok) {
            const data = await res.json().catch(() => ({}));
            totals[a] = Number(data?.total || 0);
          }
        }
        setAppInstallTotals(totals);
      } catch { }
    })();
  }, []);

  // Platform multitenancy: Fetch partners if platform
  const [partners, setPartners] = React.useState<{ brandKey: string; name?: string }[]>([]);
  const [targetBrand, setTargetBrand] = React.useState<string>("");
  const isPlatform = (typeof process !== "undefined" && process.env.NEXT_PUBLIC_CONTAINER_TYPE === "platform") ||
    (containerType === "platform") ||
    (!containerType && !brandEnv);

  React.useEffect(() => {
    if (isPlatform) {
      (async () => {
        try {
          const r = await fetch("/api/admin/devices/containers", { cache: "no-store" });
          const j = await r.json();
          const parts = Array.isArray(j?.partners) ? j.partners : [];
          setPartners(parts);
        } catch { }
      })();
    }
  }, [isPlatform]);

  const isWindows = typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent || "");
  const isFramed = typeof window !== "undefined" && window.top !== window.self;

  // Touchpoint APK Logic
  // Touchpoint APK Logic
  const brand = useBrand();
  // Name depends on selection or context
  const effectiveBrandKey = targetBrand || (brand?.key || "").toLowerCase();
  const effectiveBrandName = targetBrand
    ? (partners.find(p => p.brandKey === targetBrand)?.name || targetBrand)
    : (brand?.name || "BasaltSurge");
  const touchpointApkName = `${effectiveBrandName.replace(/\s+/g, "")}Touchpoint`;

  function downloadTouchpointApk() {
    // Navigate to ZIP endpoint to trigger download of installer package
    let url = "/api/admin/apk/zips/touchpoint";
    if (targetBrand) {
      url += `?brand=${encodeURIComponent(targetBrand)}`;
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = `${touchpointApkName}-installer.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    log(`Started download for ${touchpointApkName} installer ZIP`);
  }

  return (
    <div className="w-full space-y-6">
      {!supported && (
        <div className="rounded-md border p-3 bg-foreground/5 microtext">
          Your browser does not support WebUSB. Use Chrome/Edge on HTTPS (or localhost).
        </div>
      )}
      {isFramed && (
        <div className="rounded-md border p-3 bg-foreground/5 microtext">
          This page is embedded in another site. WebUSB permission prompts may be suppressed in iframes.
          Open the Admin Devices page in a top-level browser tab over HTTPS to allow the USB chooser to appear.
        </div>
      )}

      {/* Touchpoint Provisioning Section */}
      <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/5 to-transparent p-6 space-y-4">
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-emerald-500/20 to-transparent"></div>
        <div className="flex items-start justify-between relative z-10">
          <div className="flex items-center gap-4">
            <div className="shrink-0 h-12 w-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Download className="h-6 w-6 text-emerald-500" />
            </div>
            <div data-tour="devices.installer-workflow">
              <h3 className="text-lg font-bold text-emerald-500">
                Touchpoint Provisioning
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Download the {touchpointApkName} APK to convert any Android device into a locked Terminal or Kiosk.
              </p>
            </div>
          </div>
        </div>

        {/* Platform Admin: Brand Selector */}
        {isPlatform && partners.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="microtext text-muted-foreground whitespace-nowrap">Target Brand:</label>
            <select
              className="h-8 flex-1 max-w-xs border rounded-md text-xs bg-background px-2"
              value={targetBrand}
              onChange={(e) => setTargetBrand(e.target.value)}
            >
              <option value="">BasaltSurge (Platform Default)</option>
              {partners.map((p) => (
                <option key={p.brandKey} value={p.brandKey}>
                  {p.name || p.brandKey}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={downloadTouchpointApk}
            className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors shadow-sm"
          >
            Download {effectiveBrandName} Installer ZIP
          </button>
          <span className="microtext text-muted-foreground">
            Includes APK + install scripts (.bat/.sh)
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] p-4 flex flex-wrap items-center gap-3">
        <button
          className="px-4 py-2 rounded-lg border border-foreground/[0.05] bg-background hover:bg-foreground/[0.02] text-sm font-medium transition-all shadow-sm"
          onClick={scanAuthorizedDevices}
          disabled={!supported || connecting}
          title="Scan authorized Android devices"
        >
          {connecting ? "Scanning…" : "Scan Devices"}
        </button>
        <button
          className="px-4 py-2 rounded-lg border border-foreground/[0.05] bg-background hover:bg-foreground/[0.02] text-sm font-medium transition-all shadow-sm"
          onClick={connectDevice}
          disabled={!supported || connecting}
          title="Add a new Android device (WebUSB request)"
        >
          {connecting ? "Requesting…" : "Add Device"}
        </button>
        <button
          className="px-4 py-2 rounded-lg border border-foreground/[0.05] bg-background hover:bg-foreground/[0.02] text-sm font-medium transition-all shadow-sm"
          onClick={openInterfacePicker}
          disabled={!supported || connecting}
          title="Manually choose USB interface/alternate for a device"
        >
          Pick Interface
        </button>
        <button
          className="px-4 py-2 rounded-lg border border-foreground/[0.05] bg-background hover:bg-foreground/[0.02] text-sm font-medium transition-all shadow-sm"
          onClick={toggleSelectAll}
          disabled={connectedDevices.length === 0}
          title="Toggle select all devices"
        >
          {selectAll ? "Unselect All" : "Select All"}
        </button>
        <span className="microtext text-muted-foreground ml-2">
          {connectedDevices.length > 0 ? `${connectedDevices.length} device(s) connected` : "No devices connected"}
        </span>
      </div>

      {connectedDevices.length > 0 && (
        <div className="rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] p-5">
          <div className="text-xs font-bold text-foreground/80 mb-3 uppercase tracking-wider">Connected Devices</div>
          <ul className="text-sm space-y-2">
            {connectedDevices.map((d) => (
              <li key={d.id} className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={!!d.selected}
                  onChange={() => toggleSelect(d.id)}
                  title="Select device"
                  className="rounded border-foreground/20"
                />
                <span className="font-mono text-muted-foreground">{d.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Manual interface selection fallback UI */}
      {ifaceModalOpen && (
        <div className="rounded-md border p-3 bg-amber-50 dark:bg-foreground/5 space-y-2">
          <div className="text-sm font-semibold">Manual USB Interface Selection</div>
          <div className="microtext text-muted-foreground">
            Automatic claiming failed for device <span className="font-mono">{ifaceDeviceKey || "(unknown)"}</span>.
            Select the correct interface/alternate setting and try again.
          </div>
          <div className="max-h-40 overflow-auto rounded border bg-background">
            <ul className="text-xs divide-y">
              {ifaceOptions.map((opt, idx) => (
                <li key={`${opt.interfaceNumber}-${opt.alternateSetting}-${idx}`} className="flex items-center gap-2 p-2">
                  <input
                    type="radio"
                    name="ifaceOption"
                    checked={ifaceSelectedIdx === idx}
                    onChange={() => setIfaceSelectedIdx(idx)}
                    title="Choose this interface"
                  />
                  <span className="font-mono">{opt.summary}</span>
                  {opt.priority === 0 && (
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
                      ADB
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1.5 rounded-md border text-sm"
              onClick={manualConnectWithSelectedInterface}
              title="Attempt connect using selected interface"
            >
              Connect Selected Interface
            </button>
            <button
              className="px-3 py-1.5 rounded-md border text-sm"
              onClick={cancelManualInterfaceSelection}
              title="Cancel manual selection"
            >
              Cancel
            </button>
          </div>
          <div className="microtext text-muted-foreground">
            If claiming still fails:
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>On Windows, ensure the device interface uses the WinUSB driver. You can use Zadig to switch drivers: <a className="underline" href="https://zadig.akeo.ie/" target="_blank" rel="noreferrer">https://zadig.akeo.ie/</a></li>
              <li>Enable USB debugging on the device and accept the host RSA prompt.</li>
              <li>If another ADB client is holding the interface (e.g., adb.exe/Android Studio), stop it and retry: on Windows, run <span className="font-mono">taskkill /IM adb.exe /F</span> from an elevated prompt.</li>
              <li>Try unplug/replug the device, or toggle "USB debugging (Security settings)" if present.</li>
            </ul>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] p-4 flex flex-wrap items-center gap-3">
        {containerType === "partner" ? (
          <>
            <button
              className="px-4 py-2 rounded-lg border border-foreground/[0.05] bg-background hover:bg-foreground/[0.02] text-sm font-medium transition-all shadow-sm"
              onClick={() => pushAndInstall(targetApp)}
              disabled={!connected}
              title={`Install ${targetApp === "portalpay" ? "PortalPay" : "Paynex"} APK to the connected device`}
            >
              {`Install ${targetApp === "portalpay" ? "PortalPay" : "Paynex"}`}
            </button>
            <a
              className="px-4 py-2 rounded-lg border border-foreground/[0.05] bg-background hover:bg-foreground/[0.02] text-sm font-medium transition-all shadow-sm"
              href={`/api/admin/apk/zips/${targetApp}`}
              target="_blank"
              rel="noreferrer"
              title={`Download ${targetApp === "portalpay" ? "PortalPay" : "Paynex"} installer ZIP`}
            >
              {`Download ${targetApp === "portalpay" ? "PortalPay" : "Paynex"} ZIP`}
            </a>
            <div className="ml-auto flex items-center gap-3 microtext text-muted-foreground border-l border-foreground/[0.05] pl-4">
              <span>{`Installs: ${installTotals[targetApp] ?? 0}`}</span>
              <span className="opacity-50">•</span>
              <span>{`App Installs: ${appInstallTotals[targetApp] ?? 0}`}</span>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3 w-full">
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="px-4 py-2 rounded-lg border border-foreground/[0.05] bg-background hover:bg-foreground/[0.02] text-sm font-medium transition-all shadow-sm"
                onClick={() => pushAndInstall("portalpay")}
                disabled={!connected}
                title="Install PortalPay APK to the connected device"
              >
                Install PortalPay
              </button>
              <a
                className="px-4 py-2 rounded-lg border border-foreground/[0.05] bg-background hover:bg-foreground/[0.02] text-sm font-medium transition-all shadow-sm"
                href="/api/admin/apk/zips/portalpay"
                target="_blank"
                rel="noreferrer"
                title="Download PortalPay installer ZIP"
              >
                Download PortalPay ZIP
              </a>
              <div className="ml-auto flex items-center gap-3 microtext text-muted-foreground border-l border-foreground/[0.05] pl-4">
                <span>{`Installs: ${installTotals.portalpay ?? 0}`}</span>
                <span className="opacity-50">•</span>
                <span>{`App Installs: ${appInstallTotals.portalpay ?? 0}`}</span>
              </div>
            </div>
            
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="px-4 py-2 rounded-lg border border-foreground/[0.05] bg-background hover:bg-foreground/[0.02] text-sm font-medium transition-all shadow-sm"
                onClick={() => pushAndInstall("paynex")}
                disabled={!connected}
                title="Install Paynex APK to the connected device"
              >
                Install Paynex
              </button>
              <a
                className="px-4 py-2 rounded-lg border border-foreground/[0.05] bg-background hover:bg-foreground/[0.02] text-sm font-medium transition-all shadow-sm"
                href="/api/admin/apk/zips/paynex"
                target="_blank"
                rel="noreferrer"
                title="Download Paynex installer ZIP"
              >
                Download Paynex ZIP
              </a>
              <div className="ml-auto flex items-center gap-3 microtext text-muted-foreground border-l border-foreground/[0.05] pl-4">
                <span>{`Installs: ${installTotals.paynex ?? 0}`}</span>
                <span className="opacity-50">•</span>
                <span>{`App Installs: ${appInstallTotals.paynex ?? 0}`}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Installation Progress */}
      {Object.values(deviceProgress).map((prog) => {
        const activeStep = prog.steps[prog.currentStepIndex];
        const completedSteps = prog.steps.filter((s) => s.status === "ok").length;
        const totalSteps = prog.steps.length;
        const progressPercent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
        const elapsed = activeStep?.startedAt ? Math.round((Date.now() - activeStep.startedAt) / 1000) : 0;
        const isSlow = elapsed > 10;

        return (
          <div key={prog.deviceId} className="rounded-md border p-3 bg-foreground/5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">{prog.deviceLabel}</span>
              <span className="text-muted-foreground">{progressPercent}%</span>
            </div>
            <div className="w-full h-2 bg-background rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-600 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex items-center gap-2 text-xs">
              {activeStep && activeStep.status === "active" && (
                <>
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                  <span>{activeStep.label}…</span>
                  {isSlow && <span className="text-amber-600">({elapsed}s - taking longer than expected)</span>}
                  {!isSlow && elapsed > 0 && <span className="text-muted-foreground">({elapsed}s)</span>}
                </>
              )}
            </div>
            <div className="grid grid-cols-5 gap-1 text-[10px]">
              {prog.steps.map((step) => {
                let icon = "○";
                let color = "text-muted-foreground";
                if (step.status === "ok") {
                  icon = "✓";
                  color = "text-emerald-600";
                } else if (step.status === "error") {
                  icon = "✗";
                  color = "text-red-600";
                } else if (step.status === "active") {
                  icon = "◉";
                  color = "text-blue-600";
                }
                return (
                  <div key={step.key} className={`flex flex-col items-center ${color}`} title={step.label}>
                    <span className="font-mono">{icon}</span>
                    <span className="truncate max-w-full text-center">{step.label}</span>
                    {step.durationMs != null && <span className="text-muted-foreground">({Math.round(step.durationMs / 1000)}s)</span>}
                  </div>
                );
              })}
            </div>
            {prog.error && (
              <div className="text-xs text-red-600 p-2 bg-red-50 dark:bg-red-950/20 rounded">
                Error: {prog.error}
              </div>
            )}
          </div>
        );
      })}

      <div className="rounded-xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-5">
        <div className="text-xs font-bold text-foreground/80 mb-3 uppercase tracking-wider">Logs</div>
        <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words max-h-60 overflow-auto m-0 font-mono">
          {logs || "—"}
        </pre>
      </div>

      <div className="rounded-xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-5 microtext">
        <div className="text-xs font-bold text-foreground/80 mb-3 uppercase tracking-wider">Requirements</div>
        <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
          <li>Use Chrome/Edge over HTTPS (or localhost).</li>
          <li>Enable Developer Options and USB debugging on the device.</li>
          <li>Allow the computer to access the device when prompted.</li>
          {isWindows && <li>On Windows, ensure the device exposes a WinUSB interface for ADB (use Zadig if needed).</li>}
        </ul>
      </div>
    </div>
  );
}

function ensureAuthenticate(Adb: any) {
  try {
    if (Adb && typeof Adb.authenticate !== "function") {
      if (Adb?.default && typeof Adb.default.authenticate === "function") {
        Adb.authenticate = Adb.default.authenticate.bind(Adb.default);
      } else if (Adb?.Adb && typeof Adb.Adb.authenticate === "function") {
        Adb.authenticate = Adb.Adb.authenticate.bind(Adb.Adb);
      }
    }
  } catch { }
}
