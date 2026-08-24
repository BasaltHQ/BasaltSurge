import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { findTicketByJiraKey, getJiraIssueFields, getJiraConfig } from "@/lib/jira";
import { notifyAdminReply } from "@/lib/notifications/support-dispatcher";
import * as crypto from "node:crypto";

export const dynamic = "force-dynamic";

/**
 * Jira Webhook Handler — Receives events from Jira and syncs to Surge.
 *
 * Supported events:
 * - comment_created: Syncs Jira comments back to in-app ticket
 * - jira:issue_updated: Syncs status changes from Jira
 * - jira:issue_created: Creates in-app ticket when created directly in Jira
 */
export async function POST(req: NextRequest) {
    try {
        // Resolve brand from query param (e.g. ?brand=basaltsurge) or default/legacy
        const brandKey = req.nextUrl.searchParams.get("brand") || "default";

        // Load config to get the correct webhook secret
        const config = await getJiraConfig(brandKey);
        const webhookSecret = config?.webhookSecret || process.env.JIRA_WEBHOOK_SECRET;

        if (webhookSecret) {
            const providedSecret =
                req.nextUrl.searchParams.get("secret") ||
                req.headers.get("x-jira-webhook-secret");

            if (providedSecret !== webhookSecret) {
                console.warn(`[Jira Webhook] Invalid secret for brand '${brandKey}'`);
                return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            }
        }

        const payload = await req.json();
        const event = payload.webhookEvent || payload.issue_event_type_name || "";

        console.log(`[Jira Webhook] Event: ${event} (Brand: ${brandKey})`);

        const container = await getContainer(undefined, "support_tickets");

        // ── Comment Created ────────────────────────────────────────────────
        if (event === "comment_created" || payload.comment) {
            const issueKey = payload.issue?.key;
            const comment = payload.comment;

            if (!issueKey || !comment) {
                return NextResponse.json({ ok: true, skipped: "no issue key or comment" });
            }

            // Skip if comment was made by our integration user (avoid loops)
            // Use config email if available, else env
            const integrationEmail = config?.userEmail || process.env.JIRA_USER_EMAIL;
            const commentAuthor = comment.author?.emailAddress || "";

            if (integrationEmail && commentAuthor === integrationEmail) {
                return NextResponse.json({ ok: true, skipped: "self-comment" });
            }

            // Find the Surge ticket linked to this Jira issue
            const ticket = await findTicketByJiraKey(container, issueKey);
            if (!ticket) {
                console.warn(`[Jira Webhook] No Surge ticket found for ${issueKey}`);
                return NextResponse.json({ ok: true, skipped: "no linked ticket" });
            }

            // Extract plain text from Jira ADF comment body
            const commentText = extractTextFromADF(comment.body) || comment.body?.toString() || "";

            const newResponse = {
                user: comment.author?.displayName || "Jira Agent",
                message: commentText,
                attachments: [],
                createdAt: Date.now(),
                isAdmin: true,
                source: "jira",
            };

            const updatedTicket = {
                ...ticket,
                responses: [...(ticket.responses || []), newResponse],
                updatedAt: Date.now(),
                status: ticket.status === "open" ? "in_progress" : ticket.status,
            };

            const partitionKey = ticket.wallet || ticket.user;
            await container.item(ticket.id, partitionKey).replace(updatedTicket);

            // Dispatch SES email notification to customer (fire-and-forget, non-blocking)
            notifyAdminReply(updatedTicket, commentText, comment.author?.displayName || "Support Specialist").catch((e) => {
                console.error("[Support Dispatcher] Jira sync customer notification failed:", e);
            });

            console.log(`[Jira Webhook] Comment synced to Surge ticket ${ticket.id}`);
            return NextResponse.json({ ok: true, synced: ticket.id });
        }

        // ── Issue Updated (Status Change) ──────────────────────────────────
        if (event === "jira:issue_updated" && payload.changelog?.items) {
            const issueKey = payload.issue?.key;
            if (!issueKey) return NextResponse.json({ ok: true, skipped: "no key" });

            const statusChange = payload.changelog.items.find(
                (item: any) => item.field === "status"
            );

            if (!statusChange) {
                return NextResponse.json({ ok: true, skipped: "no status change" });
            }

            const ticket = await findTicketByJiraKey(container, issueKey);
            if (!ticket) {
                return NextResponse.json({ ok: true, skipped: "no linked ticket" });
            }

            // Map Jira status to Surge status
            const jiraStatus = (statusChange.toString || "").toLowerCase();
            let surgeStatus = ticket.status;

            if (jiraStatus.includes("done") || jiraStatus.includes("resolved") || jiraStatus.includes("complete")) {
                surgeStatus = "resolved";
            } else if (jiraStatus.includes("in progress") || jiraStatus.includes("working")) {
                surgeStatus = "in_progress";
            } else if (jiraStatus.includes("closed") || jiraStatus.includes("declined") || jiraStatus.includes("canceled")) {
                surgeStatus = "closed";
            } else if (jiraStatus.includes("open") || jiraStatus.includes("waiting")) {
                surgeStatus = "open";
            }

            if (surgeStatus !== ticket.status) {
                const updatedTicket = { ...ticket, status: surgeStatus, updatedAt: Date.now() };
                const partitionKey = ticket.wallet || ticket.user;
                await container.item(ticket.id, partitionKey).replace(updatedTicket);
                console.log(`[Jira Webhook] Status synced: ${ticket.id} → ${surgeStatus}`);
            }

            return NextResponse.json({ ok: true, synced: ticket.id });
        }

        // ── Issue Created (Jira-first tickets) ─────────────────────────────
        if (event === "jira:issue_created") {
            const issueKey = payload.issue?.key;
            if (!issueKey) return NextResponse.json({ ok: true, skipped: "no key" });

            // Check if this issue has a Surge Ticket ID (meaning it came from the app)
            // Use the brandKey derived from query param (or default)
            const fields = await getJiraIssueFields(brandKey, issueKey);
            if (fields?.surgeTicketId) {
                // Already linked to an app ticket, skip
                return NextResponse.json({ ok: true, skipped: "already linked" });
            }

            // If wallet address is provided, create an in-app ticket
            if (fields?.surgeWallet) {
                const issue = payload.issue;
                const ticketId = crypto.randomUUID();
                const now = Date.now();

                // Inherit brand from custom field if present, otherwise use webhook brand param
                const targetBrandKey = fields.brandKey || brandKey;

                const newTicket = {
                    id: ticketId,
                    brandKey: targetBrandKey === "default" ? "platform" : targetBrandKey,
                    user: fields.surgeWallet,
                    wallet: fields.surgeWallet,
                    source: "jira",
                    requestType: "general",
                    subject: issue.fields?.summary || "Jira Ticket",
                    message: extractTextFromADF(issue.fields?.description) || issue.fields?.summary || "",
                    status: "open",
                    priority: issue.fields?.priority?.name?.toLowerCase() || "medium",
                    attachments: [],
                    createdAt: now,
                    updatedAt: now,
                    responses: [],
                    jiraIssueKey: issueKey,
                    jiraIssueId: issue.id,
                    jiraIssueUrl: `${config?.baseUrl || process.env.JIRA_BASE_URL}/browse/${issueKey}`,
                };

                await container.items.create(newTicket);
                console.log(`[Jira Webhook] Created Surge ticket ${ticketId} from Jira ${issueKey}`);
                return NextResponse.json({ ok: true, created: ticketId });
            }

            return NextResponse.json({ ok: true, skipped: "no wallet on jira-created issue" });
        }

        return NextResponse.json({ ok: true, skipped: "unhandled event" });
    } catch (err: any) {
        console.error("[Jira Webhook] Error:", err);
        return NextResponse.json({ error: err.message || "Webhook processing failed" }, { status: 500 });
    }
}
/**
 * Extract plain text from Jira's Atlassian Document Format (ADF).
 */
function extractTextFromADF(adf: any): string {
    if (!adf || typeof adf === "string") return adf || "";
    if (!adf.content) return "";

    const texts: string[] = [];

    function walk(nodes: any[]) {
        for (const node of nodes) {
            if (node.type === "text" && node.text) {
                texts.push(node.text);
            }
            if (node.content) {
                walk(node.content);
            }
        }
    }

    walk(adf.content);
    return texts.join("\n");
}
