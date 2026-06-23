import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { requireThirdwebAuth } from "@/lib/auth";

export const runtime = "nodejs";

const APP_TO_PATH: Record<string, string> = {
  portalpay: path.join("android", "launcher", "recovered", "portalpay-signed.apk"),
  paynex: path.join("android", "launcher", "recovered", "paynex-signed.apk"),
  "surge-touchpoint": path.join("android", "launcher", "recovered", "surge-touchpoint-signed.apk"),
};

/**
 * Streams a signed APK from the server filesystem to the browser without prompting a download.
 * The Admin panel can fetch this endpoint as an ArrayBuffer and install it to a USB-connected device via WebUSB/ADB.
 *
 * GET /api/admin/apk/{app}
 *   app: "portalpay" | "paynex" | "touchpoint"
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ app: string }> }
) {
  try {
    // Auth: only Admin or Superadmin may access APK streaming
    const caller = await requireThirdwebAuth(_req).catch(() => null);
    const roles = Array.isArray(caller?.roles) ? caller!.roles : [];
    if (!(roles.includes("admin") || roles.includes("superadmin"))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // Container gating: partner containers only see their own brand; platform sees all
    const host = _req.headers.get("x-forwarded-host") || _req.headers.get("host") || "";
    const { getContainerIdentity } = await import("@/lib/brand-config");
    const containerIdentity = await getContainerIdentity(host);
    const containerType = containerIdentity.containerType;
    const brandKey = containerIdentity.brandKey;

    const { app } = await context.params;
    const requestedApp = String(app || "").toLowerCase();

    // Parse optional brand override (e.g. from Platform Admin selecting a partner)
    // Only allow override if on Platform container (superadmin context implied by requireThirdwebAuth admin check)
    const { searchParams } = new URL(_req.url);
    const brandParam = searchParams.get("brand");

    // Resolve 'touchpoint' to brand-specific filename key
    // Platform -> surge-touchpoint (or [brandParam]-touchpoint if specified)
    // Partner -> [brandKey]-touchpoint
    let effectiveKey = requestedApp;
    if (requestedApp === "touchpoint") {
      if (containerType === "platform" && brandParam) {
        effectiveKey = `${brandParam.toLowerCase()}-touchpoint`;
      } else {
        effectiveKey = (brandKey && containerType === "partner")
          ? `${brandKey}-touchpoint`
          : "surge-touchpoint";
      }
    }

    if (containerType === "partner") {
      // Allow 'touchpoint' (which resolves to brand-touchpoint) OR exact brand match
      // If effectiveKey is [brandKey]-touchpoint, it's allowed.
      // If requestedApp is touchpoint, it's allowed (because we just resolved it to brand).
      // Check if trying to access other apps:
      if (requestedApp !== "touchpoint" && (!brandKey || requestedApp !== brandKey)) {
        return NextResponse.json({ error: "apk_not_visible" }, { status: 404 });
      }
    }

    // Prefer Azure Blob Storage if configured (auto-built APK artifacts)
    // Expected env:
    // - AZURE_STORAGE_CONNECTION_STRING (or managed identity via DefaultAzureCredential, future)
    // - PP_APK_CONTAINER (e.g., "apks")
    // - PP_APK_BLOB_PREFIX (optional, e.g., "brands")
    // Blob name defaults to: "<key>-signed.apk" or "<prefix>/<key>-signed.apk"
    // Prefer Azure Blob Storage if configured
    try {
      const { storage } = await import("@/lib/azure-storage");
      const container = String(process.env.PP_APK_CONTAINER || "portalpay").trim();
      const prefix = String(process.env.PP_APK_BLOB_PREFIX || "brands").trim().replace(/^\/+|\/+$/g, "");

      const getPossiblePaths = (name: string) => {
        const paths = [];
        if (prefix) paths.push(`${container}/${prefix}/${name}`);
        paths.push(`${container}/${name}`);
        if (prefix) paths.push(`${prefix}/${name}`);
        paths.push(`${name}`);
        return paths;
      };

      const blobName = `${effectiveKey}-signed.apk`;
      let foundPath: string | null = null;
      for (const p of getPossiblePaths(blobName)) {
        if (await storage.exists(p)) {
          foundPath = p;
          break;
        }
      }

      if (foundPath) {
        const buf = await storage.download(foundPath);
        const body = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(body);
            controller.close();
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "application/vnd.android.package-archive",
            "Content-Length": String(buf.length),
            "Content-Disposition": `inline; filename="${effectiveKey}.apk"`,
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            Pragma: "no-cache",
            Expires: "0",
          },
        });
      }
    } catch {
      // Fall back to local filesystem if blob not found or error
    }

    const rel = APP_TO_PATH[effectiveKey];
    if (!rel) {
      return NextResponse.json({ error: "unknown app" }, { status: 404 });
    }

    const filePath = path.join(/*turbopackIgnore: true*/ process.cwd(), rel);
    const data = await fs.readFile(filePath);
    // Convert Buffer to Uint8Array to satisfy NextResponse BodyInit (BufferSource)
    const body = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

    // Serve as an inline binary stream so client can consume via fetch(ArrayBuffer)
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(body);
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Length": String(data.length),
        "Content-Disposition": `inline; filename="${effectiveKey}.apk"`,
        // Prevent caching to always serve latest build
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (err: any) {
    // Hide server path details in errors
    return NextResponse.json({ error: "apk_not_found" }, { status: 404 });
  }
}
