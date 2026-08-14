import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

// ── Types ──────────────────────────────────────────────────────
export type KYBClientRequest = {
    id: string;
    wallet: string;
    type?: "client_request";
    brandKey?: string;
    status: "pending" | "approved" | "rejected" | "blocked" | "orphaned";
    shopName: string;
    legalBusinessName?: string;
    businessType?: string;
    ein?: string;
    website?: string;
    phone?: string;
    email?: string;
    contactEmail?: string;
    billingEmail?: string;
    businessAddress?: {
        street: string;
        city: string;
        state: string;
        zip: string;
        country: string;
    };
    logoUrl?: string;
    faviconUrl?: string;
    primaryColor?: string;
    slug?: string;
    shopLogoUrl?: string;
    secondaryColor?: string;
    layoutMode?: "minimalist" | "balanced" | "maximalist";
    description?: string;
    notes?: string;
    reviewedBy?: string;
    reviewedAt?: number;
    createdAt: number;
    splitConfig?: {
        platformBps?: number;
        partnerBps: number;
        merchantBps: number;
        agents?: { wallet: string; bps: number; isCustom?: boolean }[];
    };
    splitConfigCredit?: {
        platformBps?: number;
        partnerBps: number;
        merchantBps: number;
        agents?: { wallet: string; bps: number; isCustom?: boolean }[];
    };
    splitHistory?: Array<{
        address: string;
        deployedAt: number;
        recipients?: string[];
        isCredit?: boolean;
    }>;
    deployedSplitAddress?: string;
    deployedSplitAddressCredit?: string;
    industryPack?: string | null;
    industryParams?: { restaurant?: { tables?: string[] };[key: string]: any } | null;
    customDomain?: string;
    customDomainVerified?: boolean;
};

export interface ClientRequestsKYBPDFProps {
    brandName: string;
    brandKey: string;
    brandColor?: string;
    generatedAt: string;
    generatedBy?: string;
    scopeLabel?: string;
    items: KYBClientRequest[];
    summaryStats?: {
        total: number;
        approved: number;
        pending: number;
        rejected: number;
        blocked: number;
        orphaned: number;
    };
}

// ── Styles ─────────────────────────────────────────────────────
const s = StyleSheet.create({
    page: {
        flexDirection: "column",
        backgroundColor: "#FFFFFF",
        paddingTop: 32,
        paddingBottom: 48,
        paddingHorizontal: 32,
        fontFamily: "Helvetica",
        color: "#0F172A",
        fontSize: 8,
    },
    // Header
    headerContainer: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: 16,
        paddingBottom: 12,
        borderBottomWidth: 2,
        borderBottomColor: "#0F172A",
    },
    brandTitleBlock: {
        flexDirection: "column",
        maxWidth: "60%",
    },
    brandName: {
        fontSize: 16,
        fontFamily: "Helvetica-Bold",
        color: "#0F172A",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: 2,
    },
    documentSubtitle: {
        fontSize: 10,
        fontFamily: "Helvetica-Bold",
        color: "#10B981",
        letterSpacing: 0.8,
        textTransform: "uppercase",
        marginBottom: 3,
    },
    documentDescription: {
        fontSize: 7.5,
        color: "#64748B",
    },
    metaBlock: {
        alignItems: "flex-end",
        maxWidth: "40%",
    },
    metaRow: {
        flexDirection: "row",
        justifyContent: "flex-end",
        marginBottom: 2,
    },
    metaLabel: {
        fontSize: 7.5,
        fontFamily: "Helvetica-Bold",
        color: "#475569",
        marginRight: 4,
    },
    metaValue: {
        fontSize: 7.5,
        color: "#0F172A",
    },
    metaValueMono: {
        fontSize: 7,
        fontFamily: "Courier",
        color: "#0F172A",
    },

    // KPI Summary
    kpiRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        marginBottom: 16,
        gap: 6,
    },
    kpiCard: {
        flex: 1,
        backgroundColor: "#F8FAFC",
        borderWidth: 1,
        borderColor: "#E2E8F0",
        borderRadius: 4,
        padding: 6,
        alignItems: "center",
    },
    kpiCardPrimary: {
        backgroundColor: "#F0FDF4",
        borderColor: "#BBF7D0",
    },
    kpiLabel: {
        fontSize: 6.5,
        fontFamily: "Helvetica-Bold",
        color: "#64748B",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: 2,
    },
    kpiValue: {
        fontSize: 13,
        fontFamily: "Helvetica-Bold",
        color: "#0F172A",
    },
    kpiValuePrimary: {
        color: "#059669",
    },

    // Section Title
    sectionTitle: {
        fontSize: 9,
        fontFamily: "Helvetica-Bold",
        color: "#334155",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: 8,
        paddingBottom: 3,
        borderBottomWidth: 1,
        borderBottomColor: "#E2E8F0",
    },

    // Client Card
    card: {
        backgroundColor: "#FFFFFF",
        borderWidth: 1,
        borderColor: "#CBD5E1",
        borderRadius: 5,
        marginBottom: 12,
        overflow: "hidden",
    },
    cardHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        backgroundColor: "#F1F5F9",
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderBottomWidth: 1,
        borderBottomColor: "#E2E8F0",
    },
    cardHeaderLeft: {
        flexDirection: "column",
        flex: 1,
    },
    cardBusinessTitle: {
        fontSize: 10.5,
        fontFamily: "Helvetica-Bold",
        color: "#0F172A",
    },
    cardDbaSubtitle: {
        fontSize: 7.5,
        color: "#475569",
        marginTop: 1,
    },
    cardHeaderRight: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    dateBadge: {
        fontSize: 7,
        color: "#64748B",
    },
    statusBadge: {
        paddingVertical: 2,
        paddingHorizontal: 6,
        borderRadius: 3,
        borderWidth: 1,
    },
    statusText: {
        fontSize: 7,
        fontFamily: "Helvetica-Bold",
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },

    // Status Colors
    statusApproved: {
        backgroundColor: "#ECFDF5",
        borderColor: "#A7F3D0",
    },
    statusApprovedText: {
        color: "#047857",
    },
    statusPending: {
        backgroundColor: "#FFFBEB",
        borderColor: "#FDE68A",
    },
    statusPendingText: {
        color: "#B45309",
    },
    statusRejected: {
        backgroundColor: "#FEF2F2",
        borderColor: "#FECACA",
    },
    statusRejectedText: {
        color: "#B91C1C",
    },
    statusBlocked: {
        backgroundColor: "#FAF5FF",
        borderColor: "#E9D5FF",
    },
    statusBlockedText: {
        color: "#7E22CE",
    },
    statusOrphaned: {
        backgroundColor: "#F3F4F6",
        borderColor: "#E5E7EB",
    },
    statusOrphanedText: {
        color: "#4B5563",
    },

    // Card Body
    cardBody: {
        padding: 8,
    },
    grid2Col: {
        flexDirection: "row",
        gap: 8,
        marginBottom: 6,
    },
    colSection: {
        flex: 1,
        backgroundColor: "#F8FAFC",
        borderWidth: 1,
        borderColor: "#E2E8F0",
        borderRadius: 4,
        padding: 6,
    },
    colSectionHighlight: {
        flex: 1,
        backgroundColor: "#F0FDF4",
        borderWidth: 1,
        borderColor: "#DCFCE7",
        borderRadius: 4,
        padding: 6,
    },
    sectionSubheading: {
        fontSize: 7,
        fontFamily: "Helvetica-Bold",
        color: "#475569",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: 4,
        borderBottomWidth: 1,
        borderBottomColor: "#E2E8F0",
        paddingBottom: 2,
    },
    infoRow: {
        flexDirection: "row",
        marginBottom: 2.5,
    },
    infoLabel: {
        width: "36%",
        fontSize: 7,
        fontFamily: "Helvetica-Bold",
        color: "#64748B",
    },
    infoValue: {
        width: "64%",
        fontSize: 7,
        color: "#0F172A",
    },
    infoValueMono: {
        width: "64%",
        fontSize: 6.5,
        fontFamily: "Courier",
        color: "#0F172A",
    },
    infoValueHighlight: {
        width: "64%",
        fontSize: 7,
        fontFamily: "Helvetica-Bold",
        color: "#047857",
    },

    // Split pills inside card
    splitPillRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 4,
        marginTop: 3,
    },
    splitPill: {
        backgroundColor: "#FFFFFF",
        borderWidth: 1,
        borderColor: "#CBD5E1",
        borderRadius: 2,
        paddingVertical: 1.5,
        paddingHorizontal: 4,
    },
    splitPillText: {
        fontSize: 6,
        fontFamily: "Helvetica-Bold",
        color: "#1E293B",
    },

    // Notes box
    notesBox: {
        backgroundColor: "#F1F5F9",
        borderWidth: 1,
        borderColor: "#E2E8F0",
        borderRadius: 3,
        padding: 5,
        marginTop: 2,
    },
    notesLabel: {
        fontSize: 6.5,
        fontFamily: "Helvetica-Bold",
        color: "#475569",
        marginBottom: 1.5,
    },
    notesText: {
        fontSize: 6.5,
        fontFamily: "Helvetica-Oblique",
        color: "#334155",
    },

    // Footer
    footer: {
        position: "absolute",
        bottom: 18,
        left: 32,
        right: 32,
        borderTopWidth: 1,
        borderTopColor: "#E2E8F0",
        paddingTop: 6,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    footerText: {
        fontSize: 6.5,
        color: "#94A3B8",
    },
    pageNumber: {
        fontSize: 7,
        fontFamily: "Helvetica-Bold",
        color: "#64748B",
    },
});

// Helper for formatted dates
function fmtDate(ts: any): string {
    if (!ts) return "—";
    let num = typeof ts === "number" ? ts : typeof ts === "string" ? new Date(ts).getTime() : ts?.$date ? new Date(ts.$date).getTime() : 0;
    if (!num || isNaN(num)) return "—";
    return new Date(num).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

function fmtBps(bps?: number): string {
    if (typeof bps !== "number") return "0.00%";
    return `${(bps / 100).toFixed(2)}%`;
}

function getStatusStyle(status: string) {
    switch (status) {
        case "approved":
            return { box: s.statusApproved, text: s.statusApprovedText, label: "APPROVED" };
        case "pending":
            return { box: s.statusPending, text: s.statusPendingText, label: "PENDING REVIEW" };
        case "rejected":
            return { box: s.statusRejected, text: s.statusRejectedText, label: "REJECTED" };
        case "blocked":
            return { box: s.statusBlocked, text: s.statusBlockedText, label: "BLOCKED" };
        case "orphaned":
            return { box: s.statusOrphaned, text: s.statusOrphanedText, label: "ORPHANED" };
        default:
            return { box: s.statusPending, text: s.statusPendingText, label: String(status).toUpperCase() };
    }
}

export const ClientRequestsKYBPDF: React.FC<ClientRequestsKYBPDFProps> = ({
    brandName,
    brandKey,
    brandColor = "#10B981",
    generatedAt,
    generatedBy = "System Administrator",
    scopeLabel = "All Active & Filtered Merchants",
    items = [],
    summaryStats,
}) => {
    const stats = summaryStats || {
        total: items.length,
        approved: items.filter((i) => i.status === "approved").length,
        pending: items.filter((i) => i.status === "pending").length,
        rejected: items.filter((i) => i.status === "rejected").length,
        blocked: items.filter((i) => i.status === "blocked").length,
        orphaned: items.filter((i) => i.status === "orphaned").length,
    };

    return (
        <Document
            title={`KYB Dossier - ${brandName} - ${generatedAt}`}
            author={generatedBy}
            subject="Merchant Know Your Business (KYB) Verification & Settlement Registry"
            creator="PortalPay Compliance Engine"
        >
            <Page size="LETTER" style={s.page}>
                {/* ── Running Header ── */}
                <View style={[s.headerContainer, { borderBottomColor: brandColor }]}>
                    <View style={s.brandTitleBlock}>
                        <Text style={[s.brandName, { color: brandColor }]}>{brandName}</Text>
                        <Text style={s.documentSubtitle}>Merchant KYB &amp; Underwriting Dossier</Text>
                        <Text style={s.documentDescription}>
                            Authoritative compliance snapshot, legal entity verification, and Web3 settlement routing records.
                        </Text>
                    </View>
                    <View style={s.metaBlock}>
                        <View style={s.metaRow}>
                            <Text style={s.metaLabel}>Date:</Text>
                            <Text style={s.metaValue}>{generatedAt}</Text>
                        </View>
                        <View style={s.metaRow}>
                            <Text style={s.metaLabel}>Scope:</Text>
                            <Text style={s.metaValue}>{scopeLabel}</Text>
                        </View>
                        <View style={s.metaRow}>
                            <Text style={s.metaLabel}>Brand Key:</Text>
                            <Text style={s.metaValueMono}>{brandKey}</Text>
                        </View>
                        {generatedBy && (
                            <View style={s.metaRow}>
                                <Text style={s.metaLabel}>Operator:</Text>
                                <Text style={s.metaValueMono}>
                                    {generatedBy.length > 20 ? `${generatedBy.slice(0, 8)}...${generatedBy.slice(-6)}` : generatedBy}
                                </Text>
                            </View>
                        )}
                    </View>
                </View>

                {/* ── KPI Executive Summary Strip ── */}
                <View style={s.kpiRow}>
                    <View style={s.kpiCard}>
                        <Text style={s.kpiLabel}>Total Records</Text>
                        <Text style={s.kpiValue}>{stats.total}</Text>
                    </View>
                    <View style={[s.kpiCard, s.kpiCardPrimary]}>
                        <Text style={[s.kpiLabel, { color: "#047857" }]}>Approved (Live)</Text>
                        <Text style={[s.kpiValue, s.kpiValuePrimary]}>{stats.approved}</Text>
                    </View>
                    <View style={s.kpiCard}>
                        <Text style={s.kpiLabel}>Pending Review</Text>
                        <Text style={[s.kpiValue, { color: "#D97706" }]}>{stats.pending}</Text>
                    </View>
                    <View style={s.kpiCard}>
                        <Text style={s.kpiLabel}>Rejected / Blocked</Text>
                        <Text style={[s.kpiValue, { color: "#DC2626" }]}>{stats.rejected + stats.blocked}</Text>
                    </View>
                    <View style={s.kpiCard}>
                        <Text style={s.kpiLabel}>Orphaned / Unlinked</Text>
                        <Text style={s.kpiValue}>{stats.orphaned}</Text>
                    </View>
                </View>

                {/* ── Section Title ── */}
                <Text style={s.sectionTitle}>
                    Merchant Profiles &amp; KYB Verification Registry ({items.length} {items.length === 1 ? "Client" : "Clients"})
                </Text>

                {/* ── Client Cards ── */}
                {items.map((req, idx) => {
                    const statusInfo = getStatusStyle(req.status);
                    const legalName = req.legalBusinessName || req.shopName || "Unnamed Business";
                    const dba = req.shopName && req.shopName !== req.legalBusinessName ? req.shopName : null;
                    const addr = req.businessAddress;
                    const formattedAddr = addr
                        ? [addr.street, addr.city ? `${addr.city}, ${addr.state || ""} ${addr.zip || ""}`.trim() : "", addr.country]
                            .filter(Boolean)
                            .join(" • ")
                        : "—";

                    // Split calculation summaries
                    const creditSplit = req.splitConfig;
                    const debitSplit = req.splitConfigCredit;
                    const creditAgentCount = creditSplit?.agents?.length || 0;
                    const debitAgentCount = debitSplit?.agents?.length || 0;

                    return (
                        <View key={req.id || `${req.wallet}-${idx}`} style={s.card} wrap={false}>
                            {/* Card Top Banner */}
                            <View style={s.cardHeader}>
                                <View style={s.cardHeaderLeft}>
                                    <Text style={s.cardBusinessTitle}>
                                        {idx + 1}. {legalName}
                                    </Text>
                                    {dba && <Text style={s.cardDbaSubtitle}>DBA: {dba}</Text>}
                                </View>
                                <View style={s.cardHeaderRight}>
                                    <Text style={s.dateBadge}>Applied: {fmtDate(req.createdAt)}</Text>
                                    <View style={[s.statusBadge, statusInfo.box]}>
                                        <Text style={[s.statusText, statusInfo.text]}>{statusInfo.label}</Text>
                                    </View>
                                </View>
                            </View>

                            {/* Card Content Grid */}
                            <View style={s.cardBody}>
                                {/* Upper Row: Entity KYB & Contact Info */}
                                <View style={s.grid2Col}>
                                    {/* Entity & Compliance Box */}
                                    <View style={s.colSection}>
                                        <Text style={s.sectionSubheading}>1. Legal Entity &amp; KYB Compliance</Text>
                                        <View style={s.infoRow}>
                                            <Text style={s.infoLabel}>Legal Entity:</Text>
                                            <Text style={s.infoValue}>{legalName}</Text>
                                        </View>
                                        <View style={s.infoRow}>
                                            <Text style={s.infoLabel}>Entity Type:</Text>
                                            <Text style={s.infoValue}>{req.businessType ? req.businessType.toUpperCase() : "—"}</Text>
                                        </View>
                                        <View style={s.infoRow}>
                                            <Text style={s.infoLabel}>EIN / Tax ID:</Text>
                                            <Text style={s.infoValueMono}>{req.ein || "—"}</Text>
                                        </View>
                                        <View style={s.infoRow}>
                                            <Text style={s.infoLabel}>Industry Pack:</Text>
                                            <Text style={s.infoValue}>{req.industryPack || "Standard E-Commerce"}</Text>
                                        </View>
                                        <View style={s.infoRow}>
                                            <Text style={s.infoLabel}>Shop Slug:</Text>
                                            <Text style={s.infoValueMono}>{req.slug ? `@${req.slug}` : "—"}</Text>
                                        </View>
                                    </View>

                                    {/* Registered Location & Contact */}
                                    <View style={s.colSection}>
                                        <Text style={s.sectionSubheading}>2. Location &amp; Contact Information</Text>
                                        <View style={s.infoRow}>
                                            <Text style={s.infoLabel}>Address:</Text>
                                            <Text style={s.infoValue}>{formattedAddr}</Text>
                                        </View>
                                        <View style={s.infoRow}>
                                            <Text style={s.infoLabel}>Primary Phone:</Text>
                                            <Text style={s.infoValue}>{req.phone || "—"}</Text>
                                        </View>
                                        <View style={s.infoRow}>
                                            <Text style={s.infoLabel}>Contact Email:</Text>
                                            <Text style={s.infoValue}>{req.contactEmail || req.email || "—"}</Text>
                                        </View>
                                        {req.billingEmail && (
                                            <View style={s.infoRow}>
                                                <Text style={s.infoLabel}>Billing Email:</Text>
                                                <Text style={s.infoValue}>{req.billingEmail}</Text>
                                            </View>
                                        )}
                                        <View style={s.infoRow}>
                                            <Text style={s.infoLabel}>Website:</Text>
                                            <Text style={s.infoValue}>{req.website || "—"}</Text>
                                        </View>
                                    </View>
                                </View>

                                {/* Lower Row: Settlement & Split Routing */}
                                <View style={s.grid2Col}>
                                    {/* Settlement Infrastructure */}
                                    <View style={s.colSectionHighlight}>
                                        <Text style={[s.sectionSubheading, { color: "#065F46", borderBottomColor: "#BBF7D0" }]}>
                                            3. Settlement &amp; Web3 Infrastructure
                                        </Text>
                                        <View style={s.infoRow}>
                                            <Text style={s.infoLabel}>Merchant Wallet:</Text>
                                            <Text style={s.infoValueMono}>{req.wallet}</Text>
                                        </View>
                                        <View style={s.infoRow}>
                                            <Text style={s.infoLabel}>Credit Split:</Text>
                                            <Text style={s.infoValueMono}>
                                                {req.deployedSplitAddress || "Unallocated / Direct"}
                                            </Text>
                                        </View>
                                        {req.deployedSplitAddressCredit && (
                                            <View style={s.infoRow}>
                                                <Text style={s.infoLabel}>Debit Split:</Text>
                                                <Text style={s.infoValueMono}>{req.deployedSplitAddressCredit}</Text>
                                            </View>
                                        )}
                                        {req.splitHistory && req.splitHistory.length > 0 && (
                                            <View style={s.infoRow}>
                                                <Text style={s.infoLabel}>Split History:</Text>
                                                <Text style={s.infoValue}>{req.splitHistory.length} Version(s) Deployed</Text>
                                            </View>
                                        )}
                                        {/* Split Allocations summary */}
                                        <View style={s.splitPillRow}>
                                            {creditSplit && (
                                                <View style={s.splitPill}>
                                                    <Text style={s.splitPillText}>
                                                        Credit: Merch {fmtBps(creditSplit.merchantBps)} | Part {fmtBps(creditSplit.partnerBps)} | Plat {fmtBps(creditSplit.platformBps)}
                                                        {creditAgentCount > 0 ? ` | +${creditAgentCount} Ag` : ""}
                                                    </Text>
                                                </View>
                                            )}
                                            {debitSplit && (
                                                <View style={s.splitPill}>
                                                    <Text style={s.splitPillText}>
                                                        Debit: Merch {fmtBps(debitSplit.merchantBps)} | Part {fmtBps(debitSplit.partnerBps)} | Plat {fmtBps(debitSplit.platformBps)}
                                                        {debitAgentCount > 0 ? ` | +${debitAgentCount} Ag` : ""}
                                                    </Text>
                                                </View>
                                            )}
                                        </View>
                                    </View>

                                    {/* Application Notes & Governance */}
                                    <View style={s.colSection}>
                                        <Text style={s.sectionSubheading}>4. Governance &amp; Metadata</Text>
                                        <View style={s.infoRow}>
                                            <Text style={s.infoLabel}>Custom Domain:</Text>
                                            <Text style={s.infoValue}>
                                                {req.customDomain ? `${req.customDomain} ${req.customDomainVerified ? "(Verified)" : "(Pending DNS)"}` : "None (Platform Subdomain)"}
                                            </Text>
                                        </View>
                                        {req.reviewedBy && (
                                            <View style={s.infoRow}>
                                                <Text style={s.infoLabel}>Underwritten By:</Text>
                                                <Text style={s.infoValueMono}>
                                                    {req.reviewedBy.slice(0, 8)}...{req.reviewedBy.slice(-6)}
                                                </Text>
                                            </View>
                                        )}
                                        {req.reviewedAt && (
                                            <View style={s.infoRow}>
                                                <Text style={s.infoLabel}>Reviewed Date:</Text>
                                                <Text style={s.infoValue}>{fmtDate(req.reviewedAt)}</Text>
                                            </View>
                                        )}
                                        {req.notes ? (
                                            <View style={s.notesBox}>
                                                <Text style={s.notesLabel}>Underwriter / Application Notes:</Text>
                                                <Text style={s.notesText}>{req.notes}</Text>
                                            </View>
                                        ) : (
                                            <View style={s.notesBox}>
                                                <Text style={s.notesText}>No underwriting notes provided.</Text>
                                            </View>
                                        )}
                                    </View>
                                </View>
                            </View>
                        </View>
                    );
                })}

                {/* ── Running Footer ── */}
                <View style={s.footer} fixed>
                    <Text style={s.footerText}>
                        CONFIDENTIAL — FOR INTERNAL REFERENCE &amp; COMPLIANCE USE ONLY • {brandName.toUpperCase()}
                    </Text>
                    <Text
                        style={s.pageNumber}
                        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
                    />
                </View>
            </Page>
        </Document>
    );
};

export default ClientRequestsKYBPDF;
