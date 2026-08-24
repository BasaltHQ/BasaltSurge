import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { addJiraComment, updateJiraStatus } from "@/lib/jira";
import { notifyAdminReply } from "@/lib/notifications/support-dispatcher";

export const dynamic = "force-dynamic";

function headerJson(obj: any, init?: { status?: number }) {
    return NextResponse.json(obj, init);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: ticketId } = await params;
        const body = await req.json();
        const { status, response, attachments } = body;

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

        const updates: any = { updatedAt: Date.now() };
        if (status) updates.status = status;
        if (response || (attachments && attachments.length > 0)) {
            updates.responses = [
                ...(existingTicket.responses || []),
                {
                    user: "Support Agent", // Or actual admin user
                    message: response || "",
                    attachments: Array.isArray(attachments) ? attachments.slice(0, 3) : [],
                    createdAt: Date.now(),
                    isAdmin: true
                }
            ];
        }

        const updatedTicket = { ...existingTicket, ...updates };

        // Ensure partition key is present. Fallback to user if wallet is missing (legacy data)
        const partitionKey = existingTicket.wallet || existingTicket.user;

        if (!partitionKey) {
            throw new Error("Missing partition key (wallet/user) on existing ticket");
        }

        await container.item(existingTicket.id, partitionKey).replace(updatedTicket);

        // Dispatch SES email notification to customer (fire-and-forget, non-blocking)
        if (response || (attachments && attachments.length > 0)) {
            notifyAdminReply(updatedTicket, response || (attachments?.length ? `[${attachments.length} attachment(s)]` : "New response"), "Support Specialist").catch((e) => {
                console.error("[Support Dispatcher] Admin reply email notification failed:", e);
            });
        }

        // Sync to Jira (non-blocking)
        if (existingTicket.jiraIssueKey) {
            try {
                if (response || (attachments && attachments.length > 0)) {
                    await addJiraComment(
                        existingTicket.brandKey || "platform",
                        existingTicket.jiraIssueKey,
                        response || "",
                        true, // isAdmin
                        Array.isArray(attachments) ? attachments : []
                    );
                }
                if (status && status !== existingTicket.status) {
                    await updateJiraStatus(existingTicket.brandKey || "platform", existingTicket.jiraIssueKey, status);
                }
            } catch (jiraErr) {
                console.error("[Jira] Admin sync failed (non-blocking):", jiraErr);
            }
        }

        return headerJson({ ok: true, ticket: updatedTicket });
    } catch (e: any) {
        console.error("Update ticket failed", e);
        return headerJson({ error: e.message || "Failed to update ticket" }, { status: 500 });
    }
}
