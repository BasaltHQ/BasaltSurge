import { getContainer } from "@/lib/cosmos";
import { sendEmail } from "@/lib/aws/ses";
import { getSiteConfigForWallet } from "@/lib/site-config";
import { generateHtmlEmailTemplate } from "./email-template";

export interface NotificationEventData {
  title: string;
  subtitle?: string;
  message: string;
  details?: { label: string; value: string; isCode?: boolean }[];
  ctaText?: string;
  ctaUrl?: string;
}

/**
 * Dispatches a comprehensive HTML notification email to the configured recipient
 * if the user has enabled that specific event level and alert type.
 *
 * @param level The operational level: 'merchant' | 'partner' | 'platform'
 * @param wallet The target operator's wallet address (case-insensitive)
 * @param event The event key (e.g., 'purchase_completed', 'low_stock', etc.)
 * @param data Subject details and dynamic values for the email template
 */
export async function triggerNotification(
  level: "merchant" | "partner" | "platform",
  wallet: string,
  event: string,
  data: NotificationEventData
): Promise<boolean> {
  try {
    const w = String(wallet || "").toLowerCase();
    if (!w) return false;

    const container = await getContainer();

    // 1. Resolve Brand Key & Assets based on context level
    let brandKey = "basaltsurge";
    let brandName = "BasaltSurge";
    let brandColor = "#35ff7c"; // neon green
    let logoUrl = "https://surge.basalthq.com/Surge.png";
    let senderName = "BasaltSurge Alert";
    let logoShape: "square" | "circle" = "square";

    if (level === "merchant") {
      try {
        const siteConfig = await getSiteConfigForWallet(w);
        brandKey = (siteConfig?.brandKey || brandKey).toLowerCase();
        brandName = siteConfig?.theme?.brandName || brandName;
        brandColor = siteConfig?.theme?.primaryColor || brandColor;
        logoUrl = siteConfig?.theme?.brandLogoUrl || logoUrl;
        senderName = `${brandName} Console`;

        // Resolve logo shape from shop config if available
        try {
          const shopDocId = (() => {
            const key = String(brandKey || "").toLowerCase();
            if (!key || key === "basaltsurge" || key === "portalpay") return "shop:config";
            return `shop:config:${key}`;
          })();
          const { resource: shopConfigDoc } = await container.item(shopDocId, w).read<any>();
          if (shopConfigDoc?.theme?.logoShape) {
            logoShape = shopConfigDoc.theme.logoShape;
          }
        } catch { }
      } catch (err) {
        console.error("[Notification Dispatcher] Failed to resolve merchant brand assets:", err);
      }
    } else if (level === "partner") {
      try {
        // Try reading brand key for whitelabel partner overrides if applicable
        const { resources: partnerBrands } = await container.items.query({
          query: "SELECT * FROM c WHERE LOWER(c.wallet) = @w AND c.type = 'brand:config'",
          parameters: [{ name: "@w", value: w }]
        }).fetchAll();

        const brandDoc = partnerBrands?.[0];
        if (brandDoc) {
          brandKey = (brandDoc.key || brandKey).toLowerCase();
          brandName = brandDoc.name || brandName;
          brandColor = brandDoc.colors?.primary || brandColor;
          logoUrl = brandDoc.logos?.app || logoUrl;
          senderName = `${brandName} Partner Portal`;
        }
      } catch (err) {
        console.error("[Notification Dispatcher] Failed to resolve partner brand assets:", err);
      }
    }

    // 2. Fetch Notification Settings using whitelabel-scoped brandKey
    const docId = `notification_settings:${level}:${brandKey}:${w}`;
    let settingsDoc: any = null;
    try {
      const { resource } = await container.item(docId, w).read();
      settingsDoc = resource;
    } catch {
      // Settings doc doesn't exist yet
    }

    // Default configuration: if doc doesn't exist, we assume all default events are enabled
    const isDocEnabled = settingsDoc ? settingsDoc.enabled === true : true;
    const recipientEmail = settingsDoc?.email || "";
    
    // Default enabled events fallback
    const defaultEvents: Record<string, boolean> = {
      purchase_completed: true,
      split_released: true,
      low_stock: false,
      team_pin_changed: true,
      merchant_signup: true,
      split_deployed: true,
      device_offline: true,
      partner_signup: true,
      contract_upgraded: true,
      node_error: true,
      system_status: true,
    };

    const isEventEnabled = settingsDoc?.settings
      ? settingsDoc.settings[event] !== false
      : defaultEvents[event] ?? true;

    if (!isDocEnabled || !recipientEmail || !isEventEnabled) {
      console.log(`[Notification Dispatcher] Skipped sending. level=${level}, wallet=${w}, event=${event}, reason: ${!recipientEmail ? "No email address set" : "Disabled by settings"}`);
      return false;
    }

    // Ensure image paths are absolute URLs
    if (logoUrl.startsWith("/")) {
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://surge.basalthq.com";
      logoUrl = `${baseUrl}${logoUrl}`;
    }

    // 3. Render HTML template usingresolved brand styling
    const htmlContent = generateHtmlEmailTemplate({
      brandName,
      brandColor,
      logoUrl,
      logoShape,
      title: data.title,
      subtitle: data.subtitle,
      message: data.message,
      details: data.details,
      ctaText: data.ctaText,
      ctaUrl: data.ctaUrl,
    });

    // 4. Send email
    await sendEmail({
      to: recipientEmail,
      subject: `[${brandName}] ${data.title}`,
      html: htmlContent,
      fromName: senderName,
      brandKey: brandKey,
    });

    console.log(`[Notification Dispatcher] Successfully sent email to ${recipientEmail} for event=${event}`);
    return true;
  } catch (err) {
    console.error("[Notification Dispatcher] Delivery execution failed:", err);
    return false;
  }
}
