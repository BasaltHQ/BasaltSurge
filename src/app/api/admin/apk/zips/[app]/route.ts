import { NextRequest, NextResponse } from "next/server";
import { requireThirdwebAuth } from "@/lib/auth";
import * as fs from "node:fs";
import * as path from "node:path";
import archiver from "archiver";
import { Readable } from "node:stream";

export const runtime = "nodejs";

function getContainerType(): "platform" | "partner" {
    const ct = String(process.env.NEXT_PUBLIC_CONTAINER_TYPE || process.env.CONTAINER_TYPE || "platform").toLowerCase();
    return ct === "partner" ? "partner" : "platform";
}

function getBrandKey(): string {
    return String(process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "").toLowerCase();
}

/**
 * Returns a Readable stream of the APK file, or null if not found.
 */
async function getApkStream(appKey: string): Promise<{ stream: Readable; length?: number } | null> {
    // Prefer Hybrid Storage (S3 fronting Azure Blob fallback)
    try {
        const { StorageFactory } = await import("@/lib/storage");
        const storage = StorageFactory.getProvider();
        const container = String(process.env.PP_APK_CONTAINER || "portalpay").trim();
        const prefix = String(process.env.PP_APK_BLOB_PREFIX || "brands").trim().replace(/^\/+|\/+$/g, "");

        // In S3, the bucket IS the container, so the "container" name should NOT be
        // prepended to the key. In Azure Blob, container is a separate concept.
        // We try S3-style paths first (prefix/blob), then Azure-style (container/prefix/blob).
        const makeS3Path = (name: string) => prefix ? `${prefix}/${name}` : name;
        const makeAzurePath = (name: string) => prefix ? `${container}/${prefix}/${name}` : `${container}/${name}`;

        // Try brand-specific APK from storage
        const tryBlob = async (key: string): Promise<{ stream: Readable; length?: number } | null> => {
            const blobName = `${key}-signed.apk`;

            // Try S3-style path first (e.g. "brands/basaltsurge-touchpoint-signed.apk")
            for (const fullPath of [makeS3Path(blobName), makeAzurePath(blobName)]) {
                try {
                    console.log(`[APK ZIP] Checking storage: ${fullPath}`);
                    if (await storage.exists(fullPath)) {
                        const buf = await storage.download(fullPath);
                        console.log(`[APK ZIP] Found ${fullPath} (${buf.length} bytes)`);

                        const stream = new Readable();
                        stream.push(buf);
                        stream.push(null);

                        return { stream, length: buf.length };
                    }
                } catch (e: any) {
                    console.warn(`[APK ZIP] Failed to check ${fullPath}:`, e.message);
                }
            }
            return null;
        };

        // 1. Try exact match
        let result = await tryBlob(appKey);

        // 2. Try aliases
        if (!result) {
            if (appKey === "basaltsurge-touchpoint") {
                result = await tryBlob("basaltsurge-touchpoint");
            }
        }

        if (result) return result;
    } catch (e) {
        console.warn("Storage provider error in getApkStream:", e);
    }

    // Local filesystem fallback
    const APP_TO_PATH: Record<string, string> = {
        portalpay: path.join("android", "launcher", "recovered", "portalpay-signed.apk"),
        paynex: path.join("android", "launcher", "recovered", "paynex-signed.apk"),
        "basaltsurge-touchpoint": path.join("android", "launcher", "recovered", "basaltsurge-touchpoint-signed.apk"),
    };
    const rel = APP_TO_PATH[appKey];
    if (!rel) return null;

    try {
        const filePath = path.join(/*turbopackIgnore: true*/ process.cwd(), rel);
        if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            console.log(`[APK ZIP] Found ${appKey} in local filesystem`);
            return { stream: fs.createReadStream(filePath), length: stats.size };
        }
    } catch { }

    return null;
}

function buildInstallerBat(appKey: string, isTouchpoint: boolean = false): string {
    const apkName = `${appKey}.apk`;
    const title = isTouchpoint ? "Touchpoint" : "PortalPay/Paynex";
    return [
        "@echo off",
        "setlocal",
        `echo ${title} Installer`,
        "echo.",
        "where adb >nul 2>nul",
        "if %ERRORLEVEL% NEQ 0 (",
        "  echo ERROR: adb.exe not found in PATH.",
        "  echo Download Android Platform Tools from https://developer.android.com/tools/releases/platform-tools",
        "  pause",
        "  exit /b 1",
        ")",
        "adb start-server",
        "echo Checking devices...",
        "adb devices",
        "echo Ensure USB debugging is enabled and the RSA prompt is accepted on the device.",
        "echo.",
        `echo Installing ${apkName} ...`,
        `adb install -r "%~dp0${apkName}"`,
        "if %ERRORLEVEL% NEQ 0 (",
        "  echo Install failed. See above adb output.",
        "  pause",
        "  exit /b 1",
        ")",
        "echo Install succeeded.",
        "echo Launch the app with network enabled to register the install on first run.",
        "pause",
        "endlocal",
        ""
    ].join("\r\n");
}

function buildInstallerSh(appKey: string, isTouchpoint: boolean = false): string {
    const apkName = `${appKey}.apk`;
    const title = isTouchpoint ? "Touchpoint" : "PortalPay/Paynex";
    return [
        "#!/bin/bash",
        "",
        `# ${title} Installer for macOS/Linux`,
        'set -e',
        "",
        'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
        `APK_NAME="${apkName}"`,
        "",
        'echo "PortalPay/Paynex Installer"',
        'echo ""',
        "",
        '# Check if adb is available',
        'if ! command -v adb &> /dev/null; then',
        '    echo "ERROR: adb not found in PATH."',
        '    echo "Download Android Platform Tools from https://developer.android.com/tools/releases/platform-tools"',
        '    echo "On macOS, you can also install via Homebrew: brew install android-platform-tools"',
        '    exit 1',
        'fi',
        "",
        '# Start ADB server',
        'adb start-server',
        "",
        '# List connected devices',
        'echo "Checking devices..."',
        'adb devices',
        'echo ""',
        'echo "Ensure USB debugging is enabled and the RSA prompt is accepted on the device."',
        'echo ""',
        "",
        '# Install the APK',
        'echo "Installing $APK_NAME ..."',
        'if adb install -r "$SCRIPT_DIR/$APK_NAME"; then',
        '    echo ""',
        '    echo "Install succeeded."',
        '    echo "Launch the app with network enabled to register the install on first run."',
        'else',
        '    echo ""',
        '    echo "Install failed. See above adb output."',
        '    exit 1',
        'fi',
        ""
    ].join("\n");
}

function buildReadme(appKey: string, brandKey: string, isTouchpoint: boolean = false): string {
    const appLabel = isTouchpoint
        ? `${brandKey.charAt(0).toUpperCase() + brandKey.slice(1)} Touchpoint`
        : (appKey === "paynex" ? "Paynex" : "PortalPay");
    return [
        `PortalPay Installer Package (${appLabel})`,
        ``,
        `Contents:`,
        `- ${appKey}.apk  (signed APK)`,
        `- install_${appKey}.bat  (Windows installer script using adb)`,
        `- install_${appKey}.sh   (macOS/Linux installer script using adb)`,
        ``,
        `Requirements:`,
        `- Android Platform Tools (adb) installed and on PATH`,
        `  - Windows: Download from https://developer.android.com/tools/releases/platform-tools`,
        `  - macOS: brew install android-platform-tools (or download from above)`,
        `  - Linux: apt install android-tools-adb (or download from above)`,
        `- Device with Developer Options -> USB debugging enabled`,
        `- Accept the RSA fingerprint prompt on first ADB connection`,
        ``,
        `Windows Steps:`,
        `1) Connect the Android device via USB`,
        `2) Double-click install_${appKey}.bat (or run in an elevated terminal)`,
        `3) After install completes, launch the app with network connectivity`,
        `4) On first launch, the app will phone-home to register the install for brand '${brandKey}'`,
        ``,
        `macOS/Linux Steps:`,
        `1) Connect the Android device via USB`,
        `2) Open Terminal and navigate to this folder`,
        `3) Make the script executable: chmod +x install_${appKey}.sh`,
        `4) Run the script: ./install_${appKey}.sh`,
        `5) After install completes, launch the app with network connectivity`,
        `6) On first launch, the app will phone-home to register the install for brand '${brandKey}'`,
        ``,
        `Note: If the device blocks ADB installs or staging, use enterprise provisioning (Device Owner) or native ADB CLI.`,
        ``
    ].join("\n");
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ app: string }> }) {
    try {
        const caller = await requireThirdwebAuth(req).catch(() => null);
        const roles = Array.isArray(caller?.roles) ? caller!.roles : [];
        if (!(roles.includes("admin") || roles.includes("superadmin"))) {
            return NextResponse.json({ error: "forbidden" }, { status: 403 });
        }

        const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
        const { getContainerIdentity } = await import("@/lib/brand-config");
        const containerIdentity = await getContainerIdentity(host);
        const containerType = containerIdentity.containerType;
        const envBrand = containerIdentity.brandKey;
        const { searchParams } = new URL(req.url);
        const brandParam = searchParams.get("brand");

        const { app } = await params;
        const requestedApp = String(app || "").toLowerCase().trim();
        if (!requestedApp) {
            return NextResponse.json({ error: "app_key_required" }, { status: 400 });
        }

        // Resolve touchpoint to brand-specific APK key
        let effectiveKey = requestedApp;
        let isTouchpoint = false;
        if (requestedApp === "touchpoint") {
            isTouchpoint = true;
            if (containerType === "platform" && brandParam) {
                effectiveKey = `${brandParam.toLowerCase()}-touchpoint`;
            } else {
                effectiveKey = (envBrand && containerType === "partner")
                    ? `${envBrand}-touchpoint`
                    : "basaltsurge-touchpoint";
            }
        }

        // Partner container gating
        if (containerType === "partner") {
            if (requestedApp !== "touchpoint" && (!envBrand || requestedApp !== envBrand)) {
                return NextResponse.json({ error: "zip_not_visible" }, { status: 404 });
            }
        }

        const apkData = await getApkStream(effectiveKey);
        // If not found in blob or local, user hasn't built it yet.
        if (!apkData) {
            return NextResponse.json({ error: "apk_not_found" }, { status: 404 });
        }

        // Stream ZIP generation
        const archive = archiver("zip", { zlib: { level: 9 } });
        const filename = `${effectiveKey}-installer.zip`;

        // Create a PassThrough stream to pipe the archive output to the response
        // Note: In Next.js App Router, we can pass a ReadableStream to Response.
        // We convert the Node stream to a Web ReadableStream.
        const stream = new ReadableStream({
            start(controller) {
                archive.on("data", (chunk) => controller.enqueue(chunk));
                archive.on("end", () => controller.close());
                archive.on("error", (err) => controller.error(err));
            }
        });

        // Add files to archive
        archive.append(apkData.stream, { name: `${effectiveKey}.apk` });
        archive.append(buildInstallerBat(effectiveKey, isTouchpoint), { name: `install_${effectiveKey}.bat` });
        archive.append(buildInstallerSh(effectiveKey, isTouchpoint), { name: `install_${effectiveKey}.sh` });
        archive.append(buildReadme(effectiveKey, envBrand || brandParam || "platform", isTouchpoint), { name: `README.txt` });

        // Start streaming
        archive.finalize();

        return new Response(stream, {
            headers: {
                "Content-Type": "application/zip",
                "Content-Disposition": `attachment; filename="${filename}"`,
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                Pragma: "no-cache",
                Expires: "0",
            },
        });
    } catch (e: any) {
        console.error("ZIP Stream Error:", e);
        return NextResponse.json({ error: "zip_failed", details: e.message }, { status: 500 });
    }
}
