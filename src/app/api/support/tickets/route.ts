import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { createJiraTicket } from "@/lib/jira";
import { notifyNewTicketCreated } from "@/lib/notifications/support-dispatcher";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

// Helper for JSON responses
function headerJson(obj: any, init?: { status?: number }) {
    return NextResponse.json(obj, init);
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { brandKey, user, email, source, subject, message, priority, requestType, attachments } = body;

        if (!brandKey || !user || !subject || !message) {
            return headerJson({ error: "Missing required fields" }, { status: 400 });
        }

        const container = await getContainer(undefined, "support_tickets");
        const ticketId = crypto.randomUUID();
        const now = Date.now();

        const ticket = {
            id: ticketId,
            brandKey,
            user, // Wallet address or email
            email: email ? String(email).trim().toLowerCase() : undefined,
            wallet: user, // Partition key
            source: source || 'merchant', // 'merchant' | 'partner'
            requestType: requestType || 'general', // 'general' | 'bug' | 'feature' | 'billing' | 'integration' | 'other'
            subject,
            message,
            status: 'open',
            priority: priority || 'medium',
            attachments: Array.isArray(attachments) ? attachments.slice(0, 3) : [], // Max 3 images
            createdAt: now,
            updatedAt: now,
            responses: []
        };

        await container.items.create(ticket);

        // Dispatch SES email notification to admins/support team (fire-and-forget, non-blocking)
        notifyNewTicketCreated(ticket as any).catch((e) => {
            console.error("[Support Dispatcher] New ticket email notification failed:", e);
        });

        // Sync to Jira Service Desk (fire-and-forget, don't block ticket creation)
        try {
            const jiraResult = await createJiraTicket(ticket as any);
            if (jiraResult) {
                // Update ticket with Jira reference
                const partitionKey = ticket.wallet || ticket.user;
                const linkedTicket = {
                    ...ticket,
                    jiraIssueKey: jiraResult.issueKey,
                    jiraIssueId: jiraResult.issueId,
                    jiraIssueUrl: jiraResult.issueUrl,
                };
                await container.item(ticket.id, partitionKey).replace(linkedTicket);
                return headerJson({ ok: true, ticket: linkedTicket });
            }
        } catch (jiraErr) {
            console.error("[Jira] Sync failed (non-blocking):", jiraErr);
        }

        return headerJson({ ok: true, ticket });
    } catch (e: any) {
        console.error("Create ticket failed", e);
        return headerJson({ error: e.message || "Failed to create ticket" }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    try {
        const url = new URL(req.url);
        const brandKey = url.searchParams.get("brandKey");
        const user = url.searchParams.get("user");

        if (!brandKey && !user) {
            return headerJson({ error: "brandKey or user required" }, { status: 400 });
        }

        const container = await getContainer(undefined, "support_tickets");

        let querySpec;
        if (brandKey) {
            querySpec = {
                query: "SELECT * FROM c WHERE c.brandKey = @brandKey ORDER BY c.createdAt DESC",
                parameters: [{ name: "@brandKey", value: brandKey }]
            };
        } else {
            querySpec = {
                query: "SELECT * FROM c WHERE c.user = @user ORDER BY c.createdAt DESC",
                parameters: [{ name: "@user", value: user }]
            };
        }

        const { resources: tickets } = await container.items.query(querySpec).fetchAll();

        return headerJson({ ok: true, tickets });
    } catch (e: any) {
        console.error("List tickets failed", e);
        return headerJson({ error: e.message || "Failed to list tickets" }, { status: 500 });
    }
}
