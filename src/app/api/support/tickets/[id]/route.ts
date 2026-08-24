import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { addJiraComment } from "@/lib/jira";
import { notifyCustomerReply } from "@/lib/notifications/support-dispatcher";

export const dynamic = "force-dynamic";

function headerJson(obj: any, init?: { status?: number }) {
    return NextResponse.json(obj, init);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: ticketId } = await params;
        const body = await req.json();
        const { response, user, attachments } = body;

        if ((!response && (!attachments || attachments.length === 0)) || !user) {
            return headerJson({ error: "Missing response/attachments or user" }, { status: 400 });
        }

        const container = await getContainer(undefined, "support_tickets");

        // Query by ID first to get the partition key safely
        const querySpec = {
            query: "SELECT * FROM c WHERE c.id = @id",
            parameters: [{ name: "@id", value: ticketId }]
        };
        const { resources } = await container.items.query(querySpec).fetchAll();
        const existingTicket = resources[0];

        if (!existingTicket) {
            return headerJson({ error: "Ticket not found" }, { status: 404 });
        }

        // Verify user owns the ticket (simple check)
        // In a real app, we'd verify the session/auth token matches the ticket owner
        if (existingTicket.user !== user && existingTicket.wallet !== user) {
            return headerJson({ error: "Unauthorized" }, { status: 403 });
        }

        const updates: any = {
            updatedAt: Date.now(),
            status: 'open' // Re-open ticket if user replies
        };

        updates.responses = [
            ...(existingTicket.responses || []),
            {
                user: "You",
                message: response || "",
                attachments: Array.isArray(attachments) ? attachments.slice(0, 3) : [],
                createdAt: Date.now(),
                isAdmin: false
            }
        ];

        const updatedTicket = { ...existingTicket, ...updates };

        const partitionKey = existingTicket.wallet || existingTicket.user;
        if (!partitionKey) {
            throw new Error("Missing partition key on existing ticket");
        }

        await container.item(existingTicket.id, partitionKey).replace(updatedTicket);

        // Dispatch SES email notification to admins/support team (fire-and-forget, non-blocking)
        notifyCustomerReply(updatedTicket, response || (attachments?.length ? `[${attachments.length} attachment(s)]` : "New correspondence"), user).catch((e) => {
            console.error("[Support Dispatcher] Customer reply email notification failed:", e);
        });

        // Sync user reply to Jira (non-blocking)
        if (existingTicket.jiraIssueKey) {
            try {
                await addJiraComment(
                    existingTicket.brandKey || "platform",
                    existingTicket.jiraIssueKey,
                    response || "",
                    false, // isAdmin = false (user reply)
                    Array.isArray(attachments) ? attachments : []
                );
            } catch (jiraErr) {
                console.error("[Jira] User reply sync failed (non-blocking):", jiraErr);
            }
        }

        return headerJson({ ok: true, ticket: updatedTicket });
    } catch (e: any) {
        console.error("User update ticket failed", e);
        return headerJson({ error: e.message || "Failed to update ticket" }, { status: 500 });
    }
}
