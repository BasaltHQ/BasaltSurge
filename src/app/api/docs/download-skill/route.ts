import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { getBrandConfig } from "@/config/brands";
import { getBaseUrl } from "@/lib/base-url";
import { replacePlatformReferences } from "@/lib/platformBranding";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // 1. Resolve container details dynamically
    let brandKey = String(process.env.NEXT_PUBLIC_BRAND_KEY || process.env.BRAND_KEY || "").toLowerCase();
    if (!brandKey) {
      const host = req.headers.get("host") || req.headers.get("x-forwarded-host") || "";
      const { deriveContainerIdentityFromHostname } = await import("@/lib/brand-config");
      const derived = await deriveContainerIdentityFromHostname(host);
      brandKey = derived?.brandKey || "basaltsurge";
    }
    
    const brand = getBrandConfig(brandKey);
    const brandName = brand.name || "BasaltSurge";
    const appUrl = brand.appUrl || getBaseUrl();
    
    // 2. Read the SKILL.md file
    const skillPath = join(process.cwd(), ".agents", "skills", "portalpay-ecommerce-integration", "SKILL.md");
    let content = await readFile(skillPath, "utf-8");
    
    // 3. Process platform/tenant references dynamically
    content = replacePlatformReferences(content, brandKey, brandName, appUrl);
    
    // 4. Return as attachment download
    const filename = `${brandKey}-ecommerce-integration-skill.md`;
    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    });
  } catch (err: any) {
    console.error("[download-skill] Error serving skill:", err);
    return NextResponse.json({ error: "Failed to download skill file" }, { status: 500 });
  }
}
