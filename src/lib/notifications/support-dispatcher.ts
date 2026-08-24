import { getContainer } from "@/lib/cosmos";
import { sendEmail } from "@/lib/aws/ses";
import { generateHtmlEmailTemplate } from "./email-template";

export interface SupportTicketData {
  id: string;
  brandKey?: string;
  user: string;
  email?: string;
  wallet?: string;
  source?: string;
  requestType?: string;
  subject: string;
  message: string;
  status?: string;
  priority?: string;
  attachments?: string[];
  createdAt?: number;
  updatedAt?: number;
  jiraIssueKey?: string;
  jiraIssueUrl?: string;
}

/**
 * Resolves brand visual assets and configuration.
 */
async function resolveBrandAssets(brandKey: string = "basaltsurge") {
  const bk = (brandKey || "basaltsurge").toLowerCase().trim();
  let brandName = "BasaltSurge";
  let brandColor = "#35ff7c";
  let logoUrl = "https://surge.basalthq.com/Surge.png";
  let logoShape: "square" | "circle" = "square";
  let contactEmail = "";

  try {
    const container = await getContainer();
    let doc: any = null;
    try {
      const { resource } = await container.item("brand:config", bk).read();
      doc = resource;
    } catch {
      // Not found, check fallback
      try {
        const { resources } = await container.items
          .query({
            query: "SELECT * FROM c WHERE LOWER(c.key) = @k AND c.type = 'brand:config'",
            parameters: [{ name: "@k", value: bk }],
          })
          .fetchAll();
        doc = resources?.[0];
      } catch {}
    }

    if (doc) {
      brandName = doc.name || doc.brandName || brandName;
      brandColor = doc.colors?.primary || doc.primaryColor || brandColor;
      logoUrl = doc.logos?.app || doc.logoUrl || logoUrl;
      logoShape = doc.logoShape || logoShape;
      contactEmail = doc.contactEmail || doc.supportEmail || doc.email?.senderEmail || "";
    }
  } catch (err) {
    console.warn("[Support Dispatcher] Brand asset lookup fallback:", err);
  }

  return { brandKey: bk, brandName, brandColor, logoUrl, logoShape, contactEmail };
}

/**
 * Resolves admin / support email recipients for a given brand.
 */
async function resolveAdminRecipients(brandKey: string, brandContactEmail?: string): Promise<string[]> {
  const bk = (brandKey || "basaltsurge").toLowerCase().trim();
  const recipients = new Set<string>();

  // 1. Explicit brand contact email from brand config
  if (brandContactEmail && brandContactEmail.includes("@")) {
    recipients.add(brandContactEmail.trim().toLowerCase());
  }

  // 2. Query notification_settings for platform and partner levels
  try {
    const container = await getContainer();
    const { resources: settingsDocs } = await container.items
      .query({
        query: "SELECT c.email, c.level, c.enabled, c.settings FROM c WHERE (c.level = 'platform' OR c.brandKey = @bk) AND c.type = 'notification_settings'",
        parameters: [{ name: "@bk", value: bk }],
      })
      .fetchAll();

    for (const doc of settingsDocs || []) {
      if (doc.enabled !== false && doc.email && doc.email.includes("@")) {
        // Check if support_ticket_created is explicitly disabled
        if (doc.settings?.support_ticket_created !== false) {
          recipients.add(doc.email.trim().toLowerCase());
        }
      }
    }
  } catch (err) {
    console.warn("[Support Dispatcher] Notification settings lookup fallback:", err);
  }

  // 3. Environment variable fallbacks
  const envSupport = process.env.SUPPORT_NOTIFICATION_EMAIL || process.env.ADMIN_NOTIFICATION_EMAIL;
  if (envSupport) {
    envSupport.split(",").forEach((e) => {
      const trimmed = e.trim().toLowerCase();
      if (trimmed.includes("@")) recipients.add(trimmed);
    });
  }

  // 4. Default SES fallback address (e.g. sales@basalthq.com)
  const defaultFrom = process.env.SES_FROM_ADDRESS || "BasaltCRM <sales@basalthq.com>";
  const match = defaultFrom.match(/<([^>]+)>/);
  const defaultEmail = match ? match[1] : defaultFrom;
  if (recipients.size === 0 && defaultEmail && defaultEmail.includes("@")) {
    recipients.add(defaultEmail.trim().toLowerCase());
  }

  return Array.from(recipients);
}

/**
 * Resolves customer's email address from ticket.user, wallet, or user records.
 */
async function resolveCustomerEmail(ticket: SupportTicketData, brandKey: string): Promise<string | null> {
  // Explicit email provided on ticket
  if (ticket.email && ticket.email.includes("@")) {
    return ticket.email.trim().toLowerCase();
  }

  const user = (ticket.user || ticket.wallet || "").trim();
  if (!user) return null;

  // Direct email address provided as user identifier
  if (user.includes("@") && !user.startsWith("0x")) {
    return user.toLowerCase();
  }

  // Wallet address lookup in notification_settings, shop:config, and client_requests
  if (user.startsWith("0x") || user.length > 20) {
    try {
      const container = await getContainer();
      const w = user.toLowerCase();

      // Check merchant/user notification settings
      const notifDocId = `notification_settings:merchant:${brandKey}:${w}`;
      try {
        const { resource } = await container.item(notifDocId, w).read<any>();
        if (resource?.email && resource.email.includes("@")) {
          return resource.email.trim().toLowerCase();
        }
      } catch {}

      // Check shop:config
      try {
        const { resource } = await container.item("shop:config", w).read<any>();
        if (resource?.email && resource.email.includes("@")) {
          return resource.email.trim().toLowerCase();
        }
      } catch {}

      // Check client_requests
      const { resources: reqs } = await container.items
        .query({
          query: "SELECT c.email FROM c WHERE LOWER(c.wallet) = @w AND c.type = 'client_request'",
          parameters: [{ name: "@w", value: w }],
        })
        .fetchAll();

      if (reqs?.[0]?.email && reqs[0].email.includes("@")) {
        return reqs[0].email.trim().toLowerCase();
      }
    } catch (err) {
      console.warn("[Support Dispatcher] Customer email lookup fallback:", err);
    }
  }

  return null;
}

/**
 * Dispatches an email notification to support staff/admins when a new ticket is opened.
 */
export async function notifyNewTicketCreated(ticket: SupportTicketData): Promise<void> {
  try {
    const { brandKey, brandName, brandColor, logoUrl, logoShape, contactEmail } = await resolveBrandAssets(ticket.brandKey);
    const adminRecipients = await resolveAdminRecipients(brandKey, contactEmail);
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://surge.basalthq.com";
    const adminPanelUrl = `${baseUrl}/admin?tab=supportAdmin`;

    const shortId = (ticket.id || "").slice(0, 8).toUpperCase();
    const subject = `[${brandName} Support] New Ticket #${shortId}: ${ticket.subject}`;

    const htmlContent = generateHtmlEmailTemplate({
      brandName,
      brandColor,
      logoUrl,
      logoShape,
      title: "New Support Ticket Opened",
      subtitle: `Ticket #${shortId} • Priority: ${(ticket.priority || "medium").toUpperCase()}`,
      message: `A new support request has been submitted by <strong>${ticket.user}</strong>.`,
      details: [
        { label: "Ticket ID", value: ticket.id, isCode: true },
        { label: "Subject", value: ticket.subject },
        { label: "Requester", value: ticket.user, isCode: ticket.user.startsWith("0x") },
        { label: "Category", value: ticket.requestType || "General" },
        { label: "Priority", value: (ticket.priority || "Medium").toUpperCase() },
        { label: "Brand", value: brandName },
        { label: "Initial Message", value: ticket.message },
      ],
      ctaText: "Open Support Admin Panel",
      ctaUrl: adminPanelUrl,
    });

    // Send to all resolved admin/staff emails
    for (const recipient of adminRecipients) {
      await sendEmail({
        to: recipient,
        subject,
        html: htmlContent,
        fromName: `${brandName} Support Desk`,
        brandKey,
      });
      console.log(`[Support Dispatcher] Alerted admin ${recipient} for new ticket #${shortId}`);
    }

    // Also send an automated acknowledgment receipt to customer if their email is available
    const customerEmail = await resolveCustomerEmail(ticket, brandKey);
    if (customerEmail && !adminRecipients.includes(customerEmail)) {
      const customerReceiptHtml = generateHtmlEmailTemplate({
        brandName,
        brandColor,
        logoUrl,
        logoShape,
        title: "Support Request Received",
        subtitle: `Reference: #${shortId}`,
        message: `Hello,<br/><br/>We have received your support request regarding <strong>"${ticket.subject}"</strong>. Our support team is reviewing your message and will respond shortly.`,
        details: [
          { label: "Ticket ID", value: ticket.id, isCode: true },
          { label: "Subject", value: ticket.subject },
          { label: "Status", value: "Open / Under Review" },
        ],
        ctaText: "View Your Support Tickets",
        ctaUrl: `${baseUrl}/admin?tab=support`,
      });

      await sendEmail({
        to: customerEmail,
        subject: `[${brandName}] Support Request Received (#${shortId})`,
        html: customerReceiptHtml,
        fromName: `${brandName} Support`,
        brandKey,
      });
      console.log(`[Support Dispatcher] Sent receipt to customer ${customerEmail} for ticket #${shortId}`);
    }
  } catch (err) {
    console.error("[Support Dispatcher] Failed to notify new ticket created:", err);
  }
}

/**
 * Dispatches an email notification to support staff/admins when a customer replies to a ticket.
 */
export async function notifyCustomerReply(ticket: SupportTicketData, replyMessage: string, replyAuthor?: string): Promise<void> {
  try {
    const { brandKey, brandName, brandColor, logoUrl, logoShape, contactEmail } = await resolveBrandAssets(ticket.brandKey);
    const adminRecipients = await resolveAdminRecipients(brandKey, contactEmail);
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://surge.basalthq.com";
    const adminPanelUrl = `${baseUrl}/admin?tab=supportAdmin`;

    const shortId = (ticket.id || "").slice(0, 8).toUpperCase();
    const subject = `[${brandName} Support] Customer Reply on #${shortId}: ${ticket.subject}`;

    const htmlContent = generateHtmlEmailTemplate({
      brandName,
      brandColor,
      logoUrl,
      logoShape,
      title: "New Customer Correspondence",
      subtitle: `Ticket #${shortId} • From ${replyAuthor || ticket.user}`,
      message: `A new message was posted on ticket <strong>"${ticket.subject}"</strong>:`,
      details: [
        { label: "Ticket ID", value: ticket.id, isCode: true },
        { label: "Subject", value: ticket.subject },
        { label: "From", value: replyAuthor || ticket.user, isCode: (replyAuthor || ticket.user).startsWith("0x") },
        { label: "Message", value: replyMessage },
      ],
      ctaText: "Reply in Support Admin",
      ctaUrl: adminPanelUrl,
    });

    for (const recipient of adminRecipients) {
      await sendEmail({
        to: recipient,
        subject,
        html: htmlContent,
        fromName: `${brandName} Support Desk`,
        brandKey,
      });
      console.log(`[Support Dispatcher] Alerted admin ${recipient} for customer reply on #${shortId}`);
    }
  } catch (err) {
    console.error("[Support Dispatcher] Failed to notify customer reply:", err);
  }
}

/**
 * Dispatches an email notification to the customer when a support agent replies.
 */
export async function notifyAdminReply(ticket: SupportTicketData, replyMessage: string, agentName?: string): Promise<void> {
  try {
    const { brandKey, brandName, brandColor, logoUrl, logoShape } = await resolveBrandAssets(ticket.brandKey);
    const customerEmail = await resolveCustomerEmail(ticket, brandKey);
    if (!customerEmail) {
      console.log(`[Support Dispatcher] Skipping customer notification: no email resolved for ${ticket.user}`);
      return;
    }

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://surge.basalthq.com";
    const shortId = (ticket.id || "").slice(0, 8).toUpperCase();
    const subject = `[${brandName} Support] Response on Ticket #${shortId}: ${ticket.subject}`;

    const htmlContent = generateHtmlEmailTemplate({
      brandName,
      brandColor,
      logoUrl,
      logoShape,
      title: "New Response on Your Ticket",
      subtitle: `Ticket #${shortId} • Update from Support Team`,
      message: `Our support team has replied to your ticket regarding <strong>"${ticket.subject}"</strong>:`,
      details: [
        { label: "Ticket ID", value: ticket.id, isCode: true },
        { label: "Agent", value: agentName || "Support Specialist" },
        { label: "Response", value: replyMessage },
        { label: "Status", value: ticket.status || "In Progress" },
      ],
      ctaText: "View Full Conversation",
      ctaUrl: `${baseUrl}/admin?tab=support`,
    });

    await sendEmail({
      to: customerEmail,
      subject,
      html: htmlContent,
      fromName: `${brandName} Support`,
      brandKey,
    });
    console.log(`[Support Dispatcher] Sent agent reply email to customer ${customerEmail} for ticket #${shortId}`);
  } catch (err) {
    console.error("[Support Dispatcher] Failed to notify admin reply to customer:", err);
  }
}
