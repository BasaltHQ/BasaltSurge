"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useActiveAccount } from "thirdweb/react";
import { Check, X, BookOpen, Clock, ShieldCheck, ShieldAlert, Rocket, Globe, Terminal, Eye, FileText, User, Calendar, Languages, Tag, DollarSign, Shield, ExternalLink, Search, ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight as ChevronRightIcon, Library } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { deployContract } from "thirdweb/deploys";
import { prepareTransaction, sendTransaction, waitForReceipt, parseEventLogs } from "thirdweb";
import { smartWallet } from "thirdweb/wallets";
import { client, chain } from "@/lib/thirdweb/client";
import osirisArtifact from "@/lib/contracts/OsirisUSBN.json";

/**
 * Publications Platform Panel
 * - For Platform Admins to review and approve book submissions
 * - Lists items where isBook=true and approvalStatus='PENDING'
 * - Manage USBN Contracts
 */

type Tab = "submissions" | "revisions" | "catalog" | "contracts";
type SortField = "name" | "author" | "priceUsd" | "updatedAt" | "createdAt";
type SortOrder = "asc" | "desc";

export default function PublicationsPanel() {
    const account = useActiveAccount();
    const [items, setItems] = useState<any[]>([]);
    const [approvedItems, setApprovedItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<Tab>("submissions");

    // Review Modal State
    const [reviewItem, setReviewItem] = useState<any | null>(null);

    // Catalog State (Pagination, Sorting, Search)
    const [catalogSearch, setCatalogSearch] = useState("");
    const [catalogSort, setCatalogSort] = useState<SortField>("updatedAt");
    const [catalogOrder, setCatalogOrder] = useState<SortOrder>("desc");
    const [catalogPageSize, setCatalogPageSize] = useState(10);
    const [catalogPage, setCatalogPage] = useState(0);

    // Deployment State
    const [deploying, setDeploying] = useState(false);
    const [deployedAddress, setDeployedAddress] = useState<string | null>(null);
    const [deployLogs, setDeployLogs] = useState<string[]>([]);

    async function load() {
        try {
            setLoading(true);
            // For platform admin, we need to fetch ALL items, not just one wallet's
            // Use the platform endpoint or pass a special header
            const r = await fetch("/api/inventory?all=true&isBook=true", {
                cache: "no-store",
                credentials: "include",
                headers: {
                    // Platform admin header to get all items
                    "x-platform-admin": "true",
                }
            });
            const j = await r.json();
            console.log("[PublicationsPanel] Load response:", r.status, j);

            // The GET endpoint returns { items, total } - not { ok, items }
            if (r.ok && Array.isArray(j.items)) {
                const books = j.items.filter((x: any) => x.isBook === true || x.industryPack === "publishing");

                // Filter for books pending approval
                const pending = books.filter((x: any) => x.approvalStatus === "PENDING");
                console.log("[PublicationsPanel] Pending books found:", pending.length);
                setItems(pending);

                // Filter for approved books
                const approved = books.filter((x: any) => x.approvalStatus === "APPROVED");
                console.log("[PublicationsPanel] Approved books found:", approved.length);
                setApprovedItems(approved);
            }
        } catch (e) {
            console.error("[PublicationsPanel] Load error:", e);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
    }, [account?.address]);

    // Catalog filtering, sorting, and pagination
    const filteredCatalog = useMemo(() => {
        let result = [...approvedItems];

        // Search
        if (catalogSearch.trim()) {
            const q = catalogSearch.toLowerCase();
            result = result.filter(item =>
                (item.name || "").toLowerCase().includes(q) ||
                (item.contentDetails?.author || item.attributes?.author || "").toLowerCase().includes(q) ||
                (item.sku || "").toLowerCase().includes(q) ||
                (item.contentDetails?.isbn || item.attributes?.isbn || "").toLowerCase().includes(q)
            );
        }

        // Sort
        result.sort((a, b) => {
            let aVal: any, bVal: any;
            switch (catalogSort) {
                case "name":
                    aVal = (a.name || "").toLowerCase();
                    bVal = (b.name || "").toLowerCase();
                    break;
                case "author":
                    aVal = (a.contentDetails?.author || a.attributes?.author || "").toLowerCase();
                    bVal = (b.contentDetails?.author || b.attributes?.author || "").toLowerCase();
                    break;
                case "priceUsd":
                    aVal = Number(a.priceUsd || 0);
                    bVal = Number(b.priceUsd || 0);
                    break;
                case "updatedAt":
                case "createdAt":
                    aVal = new Date(a[catalogSort] || 0).getTime();
                    bVal = new Date(b[catalogSort] || 0).getTime();
                    break;
                default:
                    aVal = 0;
                    bVal = 0;
            }
            if (catalogOrder === "asc") {
                return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            } else {
                return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
            }
        });

        return result;
    }, [approvedItems, catalogSearch, catalogSort, catalogOrder]);

    const catalogTotalPages = Math.ceil(filteredCatalog.length / catalogPageSize);
    const paginatedCatalog = filteredCatalog.slice(
        catalogPage * catalogPageSize,
        (catalogPage + 1) * catalogPageSize
    );

    // Reset page when search/filter changes
    useEffect(() => {
        setCatalogPage(0);
    }, [catalogSearch, catalogSort, catalogOrder, catalogPageSize]);

    async function decide(id: string, status: "APPROVED" | "REJECTED") {
        try {
            // Find the item first to get current data (we need full object for PUT/POST usually, but API might support partial)
            // The current /api/inventory POST is an upsert that needs all fields? 
            // Or we can use `id` param in POST?
            // Actually /api/inventory POST handles upsert by ID.
            // We need to fetch the item fully first or use the one we have in state.
            const item = items.find(i => i.id === id);
            if (!item) return;

            const updated = {
                ...item,
                approvalStatus: status,
            };

            await fetch("/api/inventory", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(updated)
            });

            // Animate out
            setItems(prev => prev.filter(i => i.id !== id));
        } catch (e) {
            alert("Action failed");
        }
    }

    async function decideRevision(item: any, decision: "APPROVED" | "REJECTED") {
        if (!confirm(`Are you sure you want to ${decision} this revision?`)) return;

        try {
            let updatedPayload = { ...item };
            const rev = item.contentDetails?.pendingRevision;

            if (decision === "APPROVED" && rev) {
                // APPLY CHANGES
                // 1. Top Level
                if (rev.name) updatedPayload.name = rev.name;
                if (rev.bookCoverUrl) updatedPayload.bookCoverUrl = rev.bookCoverUrl;
                if (rev.bookFileUrl) updatedPayload.bookFileUrl = rev.bookFileUrl;
                if (rev.attributes) updatedPayload.attributes = rev.attributes;

                // 2. Content Details (Merge)
                updatedPayload.contentDetails = {
                    ...item.contentDetails,
                    ...rev.contentDetails,
                };

                // 3. Cleanup Revision flags
                delete updatedPayload.contentDetails.pendingRevision;
                delete updatedPayload.contentDetails.revisionStatus;

            } else {
                // REJECT - Just clear flags
                // Create clean copy of contentDetails
                const newDetails = { ...item.contentDetails };
                delete newDetails.pendingRevision;
                delete newDetails.revisionStatus;
                updatedPayload.contentDetails = newDetails;
            }

            // Ensure status remains APPROVED
            updatedPayload.approvalStatus = "APPROVED";

            const res = await fetch("/api/inventory", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(updatedPayload)
            });

            if (res.ok) {
                // Update local state is tricky because 'item' was in approvedItems
                // We need to update approvedItems
                setApprovedItems(prev => prev.map(i => i.id === item.id ? updatedPayload : i));
                // If rejecting, it might look same but without revision flag
                // If approving, it has new data
            } else {
                alert("Failed to save decision");
            }
        } catch (e) {
            console.error(e);
            alert("Error saving revision decision");
        }
    }

    // Derived State for Revisions
    const revisionItems = useMemo(() => {
        return approvedItems.filter(i => i.contentDetails?.revisionStatus === 'PENDING');
    }, [approvedItems]);

    async function handleDeploy() {
        if (!account) return alert("Connect wallet first");
        setDeploying(true);
        setDeployLogs(prev => [...prev, "Starting deployment sequence..."]);

        try {
            setDeployLogs(prev => [...prev, "Configuring Smart Account (EIP-4337/7702)..."]);

            // Upgrade EOA
            const wallet = smartWallet({
                chain,
                gasless: true,
            });

            const smartAccount = await wallet.connect({
                client,
                personalAccount: account,
            });

            setDeployLogs(prev => [...prev, `Smart Account Ready: ${smartAccount.address}`]);
            setDeployLogs(prev => [...prev, "Preparing transaction (Sponsored via Factory)..."]);

            // STRATEGY: Use Deterministic Deployment Proxy (Arachnid)
            // Address: 0x4e59b44847b379578588920cA78FbF26c0B4956C (exists on Base)
            // This avoids "call to 0x0" issues with Smart Accounts by turning deployment into a standard call.
            const FACTORY_ADDRESS = "0x4e59b44847b379578588920cA78FbF26c0B4956C";

            // 1. Prepare Bytecode (strip 0x)
            let cleanBytecode = osirisArtifact.bytecode;
            if (cleanBytecode.startsWith("0x")) cleanBytecode = cleanBytecode.slice(2);

            // 2. Prepare Salt (32 bytes)
            // Use timestamp + random to ensure uniqueness
            const randomPart = Math.floor(Math.random() * 1000000000).toString(16).padStart(16, "0");
            const timePart = Date.now().toString(16).padStart(48, "0"); // Pad to ensure total length 
            // Actually just need specific length. 32 bytes = 64 hex chars.
            const saltHex = (timePart + randomPart).slice(-64).padStart(64, "0");

            // 3. Construct Data: cast(salt) + code
            // The factory takes strictly: salt (32 bytes) + init_code
            const deployData = `0x${saltHex}${cleanBytecode}`;

            const transaction = prepareTransaction({
                client,
                chain,
                to: FACTORY_ADDRESS,
                value: BigInt(0),
                data: deployData as `0x${string}`,
            });

            // 4. Send Transaction via Smart Account
            const { transactionHash } = await sendTransaction({
                account: smartAccount,
                transaction,
            });

            setDeployLogs(prev => [...prev, `Transaction Sent: ${transactionHash}`]);
            setDeployLogs(prev => [...prev, "Waiting for receipt..."]);

            // 5. Wait & Parse
            const receipt = await waitForReceipt({
                client,
                chain,
                transactionHash,
            });

            let address: string | null = null;

            // STRATEGY 1: Parse logs for 'Deployed(address)'
            const parsedLogs = parseEventLogs({
                events: osirisArtifact.abi as any,
                logs: receipt.logs,
            });
            const deployEvent = parsedLogs.find(e => e.eventName === "Deployed");
            if (deployEvent) {
                address = (deployEvent.args as any).addr;
            }

            // STRATEGY 2: Check for Factory 'Deployed' event or raw topics
            // The Deployed event topic is: 0xf40fcec21964ffb566044d083b4073f29f7f7929110ea19e1b3ebe375d89055e
            // (keccak256("Deployed(address)"))
            if (!address) {
                const DEPLOY_TOPIC = "0xf40fcec21964ffb566044d083b4073f29f7f7929110ea19e1b3ebe375d89055e";
                const log = receipt.logs.find(l => l.topics[0] === DEPLOY_TOPIC);
                if (log && log.topics[1]) {
                    // Extract address from indexed topic (pad 26 bytes to 64 chars -> take last 40)
                    // It's already 32 bytes (66 chars with 0x). 
                    // topic[1] is the address.
                    address = `0x${log.topics[1].slice(-40)}`;
                }
            }

            if (!address) {
                throw new Error(`Could not find address in logs. Tx: ${transactionHash}`);
            }

            setDeployedAddress(address);
            setDeployLogs(prev => [...prev, `Deployment Successful! Contract Address: ${address}`]);

            // 6. Verification
            setDeployLogs(prev => [...prev, "Verifying contract on Basescan..."]);
            try {
                const verifyRes = await fetch("/api/admin/verify-contract", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ address, chainId: chain.id }),
                });
                const verifyJson = await verifyRes.json();

                if (verifyJson.ok) {
                    setDeployLogs(prev => [...prev, `✓ ${verifyJson.message}`]);
                } else {
                    setDeployLogs(prev => [...prev, `⚠ Verification: ${verifyJson.error}`]);
                }

                // Link to explorer
                const explorerUrl = `https://basescan.org/address/${address}#code`;
                setDeployLogs(prev => [...prev, `Explorer: ${explorerUrl}`]);

            } catch (vError: any) {
                console.warn(vError);
                setDeployLogs(prev => [...prev, `Verification Error: ${vError.message}`]);
            }

            alert(`OsirisUSBN Deployed at: ${address}`);

        } catch (e: any) {
            console.error(e);
            setDeployLogs(prev => [...prev, `Error: ${e.message}`]);
            alert("Deployment failed: " + e.message);
        } finally {
            setDeploying(false);
        }
    }

    return (
        <div className="w-full space-y-6 pb-24 admin-panel-enter">
            <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-bold tracking-tight">Publications Review</h2>
                        <p className="text-muted-foreground">Approve or reject book submissions and manage contracts</p>
                    </div>
                    <div className="flex gap-1 border-b border-foreground/[0.05] pb-1">
                        <button data-tour="publications.activeTab.submissions" data-tour-action="activate" data-tour-active={activeTab === "submissions"}
                            onClick={() => setActiveTab("submissions")}
                            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'submissions' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.02]'}`}
                        >
                            Submissions ({items.length})
                        </button>
                        <button data-tour="publications.activeTab.catalog" data-tour-action="activate" data-tour-active={activeTab === "catalog"}
                            onClick={() => setActiveTab("catalog")}
                            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'catalog' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.02]'}`}
                        >
                            <Library className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                            Catalog ({approvedItems.length})
                        </button>
                        <button data-tour="publications.activeTab.contracts" data-tour-action="activate" data-tour-active={activeTab === "contracts"}
                            onClick={() => setActiveTab("contracts")}
                            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'contracts' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.02]'}`}
                        >
                            USBN Contracts
                        </button>
                        <button data-tour="publications.activeTab.revisions" data-tour-action="activate" data-tour-active={activeTab === "revisions"}
                            onClick={() => setActiveTab("revisions")}
                            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'revisions' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.02]'}`}
                        >
                            Revisions ({revisionItems.length})
                        </button>
                    </div>
                </div>
            </div>

            {activeTab === "revisions" && (
                <div data-tour="publications.activeTab.revisions.content" className="space-y-6">
                    {revisionItems.length === 0 ? (
                        <div className="text-center py-24 text-muted-foreground opacity-60">
                            <ShieldCheck className="w-16 h-16 mb-4 stroke-1 mx-auto" />
                            <p>No pending revisions.</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {revisionItems.map(item => {
                                const rev = item.contentDetails?.pendingRevision || {};
                                return (
                                    <div key={item.id} className="p-6 rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md">
                                        <div className="flex justify-between items-start mb-6">
                                            <div>
                                                <h3 className="text-xl font-bold">{item.name}</h3>
                                                <p className="text-sm text-muted-foreground">Revising Approved Book</p>
                                            </div>
                                            <div className="flex gap-2">
                                                <button onClick={() => decideRevision(item, "APPROVED")} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-bold flex items-center gap-2">
                                                    <Check className="w-4 h-4" /> Approve Changes
                                                </button>
                                                <button onClick={() => decideRevision(item, "REJECTED")} className="px-4 py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded text-sm font-bold flex items-center gap-2">
                                                    <X className="w-4 h-4" /> Reject
                                                </button>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-8">
                                            {/* Current Version */}
                                            <div className="p-4 bg-background/50 rounded border opacity-70">
                                                <h4 className="font-bold text-xs uppercase mb-4 text-muted-foreground">Current Live Version</h4>
                                                <div className="flex gap-4">
                                                    <div className="w-20 h-auto min-h-[5rem] bg-muted relative shrink-0">
                                                        {item.bookCoverUrl ? <img src={item.bookCoverUrl} className="w-full h-auto object-contain" /> : <div className="w-full h-24 flex items-center justify-center text-xs text-center p-1">No Cover</div>}
                                                    </div>
                                                    <div className="space-y-2 text-sm">
                                                        <div><span className="font-semibold">Title:</span> {item.name}</div>
                                                        <div><span className="font-semibold">Pages:</span> {item.contentDetails?.pages || "?"}</div>
                                                        <div><span className="font-semibold">Subtitle:</span> {item.contentDetails?.subtitle || "-"}</div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-semibold">Manuscript:</span>
                                                            <a href={item.bookFileUrl} target="_blank" className="text-blue-500 hover:underline truncate max-w-[150px] inline-block align-bottom">{item.bookFileUrl ? "View File" : "None"}</a>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Proposed Revision */}
                                            <div className="p-4 bg-background rounded border border-blue-500/30 shadow-sm relative overflow-hidden">
                                                <div className="absolute top-0 right-0 px-2 py-1 bg-blue-500 text-white text-[10px] font-bold rounded-bl">PROPOSED</div>
                                                <h4 className="font-bold text-xs uppercase mb-4 text-blue-600">New Version</h4>
                                                <div className="flex gap-4">
                                                    <div className="w-20 h-auto min-h-[5rem] bg-muted relative shrink-0 ring-2 ring-blue-500/20">
                                                        {(rev.bookCoverUrl || item.bookCoverUrl) ? <img src={rev.bookCoverUrl || item.bookCoverUrl} className="w-full h-auto object-contain" /> : <div className="w-full h-24 flex items-center justify-center text-xs text-center p-1">No Cover</div>}
                                                    </div>
                                                    <div className="space-y-2 text-sm">
                                                        <div className={rev.name && rev.name !== item.name ? "bg-blue-100 dark:bg-blue-900/30 px-1 -mx-1 rounded" : ""}>
                                                            <span className="font-semibold">Title:</span> {rev.name || item.name}
                                                        </div>
                                                        <div className={rev.contentDetails?.pages && rev.contentDetails.pages !== item.contentDetails?.pages ? "bg-blue-100 dark:bg-blue-900/30 px-1 -mx-1 rounded" : ""}>
                                                            <span className="font-semibold">Pages:</span> {rev.contentDetails?.pages || item.contentDetails?.pages || "?"}
                                                        </div>
                                                        <div className={rev.contentDetails?.subtitle && rev.contentDetails.subtitle !== item.contentDetails?.subtitle ? "bg-blue-100 dark:bg-blue-900/30 px-1 -mx-1 rounded" : ""}>
                                                            <span className="font-semibold">Subtitle:</span> {rev.contentDetails?.subtitle || item.contentDetails?.subtitle || "-"}
                                                        </div>
                                                        <div className={`flex items-center gap-2 ${rev.bookFileUrl && rev.bookFileUrl !== item.bookFileUrl ? "bg-blue-100 dark:bg-blue-900/30 px-1 -mx-1 rounded" : ""}`}>
                                                            <span className="font-semibold">Manuscript:</span>
                                                            <a href={rev.bookFileUrl || item.bookFileUrl} target="_blank" className="text-blue-500 hover:underline truncate max-w-[150px] inline-block align-bottom">{(rev.bookFileUrl || item.bookFileUrl) ? "View File" : "None"}</a>
                                                        </div>
                                                        <div className="text-xs text-muted-foreground mt-2">
                                                            {rev.timestamp ? `Submitted: ${new Date(rev.timestamp).toLocaleDateString()}` : ""}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {activeTab === "submissions" && (
                <>

                    {loading ? (
                        <div className="text-center py-12 text-muted-foreground">Scanning submissions...</div>
                    ) : items.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground opacity-60">
                            <ShieldCheck className="w-16 h-16 mb-4 stroke-1" />
                            <p className="text-lg">All caught up!</p>
                            <p className="text-sm">No pending submissions found.</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {items.map(item => (
                                <motion.div
                                    key={item.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="p-4 rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md flex gap-6 items-start"
                                >
                                    {/* Cover Preview (Small) */}
                                    <div className="w-24 h-auto min-h-[6rem] bg-muted rounded overflow-hidden shrink-0 border shadow-sm relative self-start">
                                        {(item.bookCoverUrl || item.attributes?.bookCoverUrl || (item as any).images?.[0]) ? (
                                            <img src={item.bookCoverUrl || item.attributes?.bookCoverUrl || (item as any).images?.[0]} className="w-full h-auto object-contain bg-black/5 dark:bg-white/5" />
                                        ) : (
                                            <div className="grid place-items-center h-24 w-full"><BookOpen className="opacity-20" /></div>
                                        )}
                                    </div>

                                    {/* Details */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <h3 className="font-bold text-lg">{item.name}</h3>
                                                <div className="text-sm text-muted-foreground flex items-center gap-2 mt-0.5">
                                                    <span className="font-medium text-foreground">{item.contentDetails?.author || item.attributes?.author || "Unknown Author"}</span>
                                                    {item.sku && <span className="font-mono text-xs opacity-50 px-1 border rounded">{item.sku}</span>}
                                                </div>
                                                <div className="text-[10px] font-mono text-muted-foreground mt-1 flex gap-2">
                                                    <span title={item.id}>ID: <span className="opacity-70">{item.id.slice(0, 8)}...</span></span>
                                                    <span title={item.wallet}>Owner: <span className="text-blue-600/70">{item.wallet?.slice(0, 6)}...</span></span>
                                                </div>
                                            </div>
                                            <span className="text-xs font-mono px-2 py-1 rounded bg-muted">
                                                ${item.priceUsd}
                                            </span>
                                        </div>

                                        <p className="text-sm text-muted-foreground mt-3 line-clamp-2">{item.description}</p>

                                        {/* Metadata Check */}
                                        <div className="mt-4 flex items-center gap-6 text-xs text-muted-foreground">
                                            <div className={`flex items-center gap-1 ${(item.bookFileUrl || item.attributes?.bookFileUrl || (item.attributes as any)?.downloadUrl) ? "text-green-600" : "text-red-500"}`}>
                                                {(item.bookFileUrl || item.attributes?.bookFileUrl || (item.attributes as any)?.downloadUrl) ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                                                Manuscript File
                                            </div>
                                            <div className={`flex items-center gap-1 ${(item.bookCoverUrl || item.attributes?.bookCoverUrl || (item as any).images?.[0]) ? "text-green-600" : "text-amber-500"}`}>
                                                {(item.bookCoverUrl || item.attributes?.bookCoverUrl || (item as any).images?.[0]) ? <Check className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
                                                Cover Image
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <BookOpen className="w-3 h-3" />
                                                {item.contentDetails?.pages || item.attributes?.pageCount || 0} Pages
                                            </div>
                                            <span className="flex items-center gap-1 opacity-70">
                                                Version {item.contentDetails?.edition || 1}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex flex-col gap-2 shrink-0 border-l pl-6 self-stretch justify-center">
                                        <button
                                            onClick={() => setReviewItem(item)}
                                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium transition-colors w-32 justify-center"
                                        >
                                            <Eye className="w-4 h-4" /> Review
                                        </button>
                                        <button
                                            onClick={() => decide(item.id, "APPROVED")}
                                            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md text-sm font-medium transition-colors w-32 justify-center"
                                        >
                                            <Check className="w-4 h-4" /> Approve
                                        </button>
                                        <button
                                            onClick={() => decide(item.id, "REJECTED")}
                                            className="flex items-center gap-2 px-4 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 rounded-md text-sm font-medium transition-colors w-32 justify-center"
                                        >
                                            <X className="w-4 h-4" /> Reject
                                        </button>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    )}
                </>
            )
            }

            {
                activeTab === "catalog" && (
                    <div data-tour="publications.activeTab.catalog.content" className="space-y-6">
                        {/* Controls Bar */}
                        <div className="flex flex-col md:flex-row gap-4 justify-between rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md p-4">
                            {/* Search */}
                            <div className="relative w-full md:w-96">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <input
                                    type="text"
                                    placeholder="Search by title, author, or ISBN..."
                                    value={catalogSearch}
                                    onChange={(e) => setCatalogSearch(e.target.value)}
                                    className="w-full pl-9 pr-4 h-10 rounded-lg border border-foreground/[0.05] bg-background focus:outline-none focus:border-foreground/30 transition-colors"
                                />
                            </div>

                            <div className="flex gap-4 items-center">
                                {/* Sorting */}
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">Sort by:</span>
                                    <select
                                        value={catalogSort}
                                        onChange={(e) => setCatalogSort(e.target.value as SortField)}
                                        className="h-10 px-3 rounded-lg border border-foreground/[0.05] bg-background text-sm"
                                    >
                                        <option value="updatedAt">Date Updated</option>
                                        <option value="createdAt">Date Created</option>
                                        <option value="name">Title</option>
                                        <option value="author">Author</option>
                                        <option value="priceUsd">Price</option>
                                    </select>
                                    <button
                                        onClick={() => setCatalogOrder(prev => prev === "asc" ? "desc" : "asc")}
                                        className="h-10 w-10 border border-foreground/[0.05] rounded-lg hover:bg-foreground/[0.02] flex items-center justify-center transition-colors"
                                    >
                                        <ArrowUpDown className="w-4 h-4" />
                                    </button>
                                </div>

                                {/* Page Size */}
                                <select
                                    value={catalogPageSize}
                                    onChange={(e) => setCatalogPageSize(Number(e.target.value))}
                                    className="h-10 px-3 rounded-lg border border-foreground/[0.05] bg-background text-sm"
                                >
                                    <option value={10}>10 items</option>
                                    <option value={20}>20 items</option>
                                    <option value={50}>50 items</option>
                                </select>
                            </div>
                        </div>

                        {/* Listings */}
                        {loading ? (
                            <div className="text-center py-12 text-muted-foreground">Loading catalog...</div>
                        ) : filteredCatalog.length === 0 ? (
                            <div className="text-center py-12 text-muted-foreground">
                                <Library className="w-12 h-12 mx-auto mb-4 opacity-30" />
                                <p>No books found matching your criteria.</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {paginatedCatalog.map((item) => (
                                    <motion.div
                                        key={item.id}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="p-4 rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md flex gap-6 items-center"
                                    >
                                        {/* Cover */}
                                        <div className="w-16 h-auto min-h-[4rem] bg-muted rounded overflow-hidden shrink-0 border shadow-sm relative self-start">
                                            {(item.bookCoverUrl || item.attributes?.bookCoverUrl || (item as any).images?.[0]) ? (
                                                <img src={item.bookCoverUrl || item.attributes?.bookCoverUrl || (item as any).images?.[0]} className="w-full h-auto object-contain bg-black/5 dark:bg-white/5" />
                                            ) : (
                                                <div className="grid place-items-center h-20 w-full"><BookOpen className="opacity-20" /></div>
                                            )}
                                        </div>

                                        {/* Main Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-start justify-between">
                                                <div>
                                                    <h3 className="font-bold truncate">{item.name}</h3>
                                                    <p className="text-sm text-muted-foreground">{item.contentDetails?.author || item.attributes?.author || "Unknown Author"}</p>
                                                    <div className="text-[10px] font-mono text-muted-foreground flex gap-2 mt-0.5">
                                                        <span title={item.id}>ID: <span className="opacity-70">{item.id.slice(0, 8)}...</span></span>
                                                        <span title={item.wallet}>Owner: <span className="text-blue-600/70">{item.wallet?.slice(0, 6)}...</span></span>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="font-bold">${item.priceUsd}</div>
                                                    <div className="text-xs text-muted-foreground">{item.sku}</div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                                                <span className="flex items-center gap-1">
                                                    <Calendar className="w-3 h-3" />
                                                    {new Date(item.updatedAt || item.createdAt).toLocaleDateString()}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <BookOpen className="w-3 h-3" />
                                                    {item.contentDetails?.pages || item.attributes?.pageCount || 0} Pages
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    Version {item.contentDetails?.edition || 1}
                                                </span>
                                                {item.contentDetails?.isbn && (
                                                    <span className="font-mono bg-muted px-1.5 py-0.5 rounded">
                                                        ISBN: {item.contentDetails.isbn}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Actions */}
                                        <div className="px-4">
                                            <button
                                                onClick={() => setReviewItem(item)}
                                                className="p-2 hover:bg-muted rounded-full transition-colors"
                                            >
                                                <Eye className="w-5 h-5 text-blue-500" />
                                            </button>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        )}

                        {/* Pagination */}
                        {catalogTotalPages > 1 && (
                            <div className="flex items-center justify-between border-t pt-4">
                                <div className="text-sm text-muted-foreground">
                                    Showing {catalogPage * catalogPageSize + 1} to {Math.min((catalogPage + 1) * catalogPageSize, filteredCatalog.length)} of {filteredCatalog.length} results
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setCatalogPage(Math.max(0, catalogPage - 1))}
                                        disabled={catalogPage === 0}
                                        className="p-2 border rounded-lg hover:bg-muted disabled:opacity-50"
                                    >
                                        <ChevronLeft className="w-4 h-4" />
                                    </button>
                                    <span className="text-sm font-medium">
                                        Page {catalogPage + 1} of {catalogTotalPages}
                                    </span>
                                    <button
                                        onClick={() => setCatalogPage(Math.min(catalogTotalPages - 1, catalogPage + 1))}
                                        disabled={catalogPage === catalogTotalPages - 1}
                                        className="p-2 border rounded-lg hover:bg-muted disabled:opacity-50"
                                    >
                                        <ChevronRightIcon className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )
            }

            {
                activeTab === "contracts" && (
                    <ContractsManager
                        account={account}
                        deploying={deploying}
                        setDeploying={setDeploying}
                        deployLogs={deployLogs}
                        setDeployLogs={setDeployLogs}
                        deployedAddress={deployedAddress}
                        setDeployedAddress={setDeployedAddress}
                    />
                )
            }

            {/* ===== REVIEW MODAL ===== */}
            <AnimatePresence>
                {reviewItem && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
                        onClick={() => setReviewItem(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-background border rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Header */}
                            <div className="sticky top-0 bg-background/95 backdrop-blur-sm border-b p-4 flex items-center justify-between z-10">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-blue-600/20 flex items-center justify-center">
                                        <FileText className="w-5 h-5 text-blue-500" />
                                    </div>
                                    <div>
                                        <h2 className="font-bold text-lg">Review Submission</h2>
                                        <p className="text-sm text-muted-foreground">Review all fields before approving</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setReviewItem(null)}
                                    className="p-2 hover:bg-muted rounded-lg transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Content */}
                            <div className="p-6 grid md:grid-cols-2 gap-6">
                                {/* Left Column - Cover & Preview */}
                                <div className="space-y-4">
                                    {/* Cover */}
                                    <div className="aspect-[2/3] rounded-lg border bg-muted overflow-hidden relative">
                                        {(reviewItem.bookCoverUrl || reviewItem.attributes?.bookCoverUrl || (reviewItem as any).images?.[0]) ? (
                                            <img
                                                src={reviewItem.bookCoverUrl || reviewItem.attributes?.bookCoverUrl || (reviewItem as any).images?.[0]}
                                                alt="Book Cover"
                                                className="w-full h-full object-contain bg-black/5 dark:bg-white/5"
                                            />
                                        ) : (
                                            <div className="w-full h-full grid place-items-center">
                                                <BookOpen className="w-16 h-16 opacity-20" />
                                            </div>
                                        )}
                                    </div>

                                    {/* Preview Button */}
                                    {(reviewItem.bookFileUrl || reviewItem.attributes?.bookFileUrl || (reviewItem.attributes as any)?.downloadUrl) && (
                                        <a
                                            href={`/reader/preview?preview=true&pdfUrl=${encodeURIComponent(reviewItem.bookFileUrl || reviewItem.attributes?.bookFileUrl || (reviewItem.attributes as any)?.downloadUrl || '')}&title=${encodeURIComponent(reviewItem.name || '')}&author=${encodeURIComponent(reviewItem.contentDetails?.author || reviewItem.attributes?.author || '')}&cover=${encodeURIComponent(reviewItem.bookCoverUrl || reviewItem.attributes?.bookCoverUrl || (reviewItem as any).images?.[0] || '')}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center justify-center gap-2 w-full py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-lg font-medium transition-all"
                                        >
                                            <Eye className="w-5 h-5" />
                                            Preview Book
                                            <ExternalLink className="w-4 h-4" />
                                        </a>
                                    )}

                                    {/* File Info */}
                                    <div className="p-4 rounded-lg border bg-muted/50 space-y-2">
                                        <h4 className="font-medium text-sm flex items-center gap-2">
                                            <FileText className="w-4 h-4" /> Files
                                        </h4>
                                        <div className={`flex items-center gap-2 text-sm ${(reviewItem.bookFileUrl || reviewItem.attributes?.bookFileUrl || (reviewItem.attributes as any)?.downloadUrl) ? "text-green-600" : "text-red-500"}`}>
                                            {(reviewItem.bookFileUrl || reviewItem.attributes?.bookFileUrl || (reviewItem.attributes as any)?.downloadUrl) ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                                            Manuscript {(reviewItem.bookFileUrl || reviewItem.attributes?.bookFileUrl || (reviewItem.attributes as any)?.downloadUrl) ? "Uploaded" : "Missing"}
                                        </div>
                                        <div className={`flex items-center gap-2 text-sm ${(reviewItem.bookCoverUrl || reviewItem.attributes?.bookCoverUrl || (reviewItem as any).images?.[0]) ? "text-green-600" : "text-amber-500"}`}>
                                            {(reviewItem.bookCoverUrl || reviewItem.attributes?.bookCoverUrl || (reviewItem as any).images?.[0]) ? <Check className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
                                            Cover {(reviewItem.bookCoverUrl || reviewItem.attributes?.bookCoverUrl || (reviewItem as any).images?.[0]) ? "Uploaded" : "Missing"}
                                        </div>
                                        <div className={`flex items-center gap-2 text-sm ${reviewItem.previewUrl ? "text-green-600" : "text-muted-foreground"}`}>
                                            {reviewItem.previewUrl ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                                            Preview {reviewItem.previewUrl ? "Provided" : "Not Provided"}
                                        </div>
                                    </div>
                                </div>

                                {/* Right Column - Details */}
                                <div className="space-y-4">
                                    {/* Title & Author */}
                                    <div>
                                        <h3 className="text-2xl font-bold">{reviewItem.name}</h3>
                                        {reviewItem.contentDetails?.subtitle && (
                                            <p className="text-lg text-muted-foreground mt-1">{reviewItem.contentDetails.subtitle}</p>
                                        )}
                                        <div className="flex items-center gap-2 mt-2 text-muted-foreground">
                                            <User className="w-4 h-4" />
                                            <span className="font-medium text-foreground">
                                                {reviewItem.contentDetails?.author || reviewItem.attributes?.author || "Unknown Author"}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Description */}
                                    {reviewItem.description && (
                                        <div className="p-4 rounded-lg border bg-muted/30">
                                            <h4 className="font-medium text-sm mb-2">Description</h4>
                                            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{reviewItem.description}</p>
                                        </div>
                                    )}

                                    {/* Key Details Grid */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="p-3 rounded-lg border bg-muted/30">
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                                                <DollarSign className="w-3 h-3" /> Price
                                            </div>
                                            <div className="font-bold">${reviewItem.priceUsd || 0}</div>
                                        </div>
                                        <div className="p-3 rounded-lg border bg-muted/30">
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                                                <BookOpen className="w-3 h-3" /> Pages
                                            </div>
                                            <div className="font-bold">{reviewItem.contentDetails?.pages || reviewItem.attributes?.pageCount || "—"}</div>
                                        </div>
                                        <div className="p-3 rounded-lg border bg-muted/30">
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                                                <Languages className="w-3 h-3" /> Language
                                            </div>
                                            <div className="font-bold uppercase">{reviewItem.contentDetails?.language || reviewItem.attributes?.language || "—"}</div>
                                        </div>
                                        <div className="p-3 rounded-lg border bg-muted/30">
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                                                <Shield className="w-3 h-3" /> DRM
                                            </div>
                                            <div className="font-bold">{reviewItem.drmEnabled ? "Enabled" : "Disabled"}</div>
                                        </div>
                                    </div>

                                    {/* IDs & Codes */}
                                    <div className="p-4 rounded-lg border bg-muted/30 space-y-2">
                                        <h4 className="font-medium text-sm">Identifiers</h4>
                                        <div className="grid grid-cols-2 gap-2 text-sm">
                                            <div>
                                                <span className="text-muted-foreground">SKU:</span>
                                                <span className="ml-2 font-mono">{reviewItem.sku || "—"}</span>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground">ISBN:</span>
                                                <span className="ml-2 font-mono">{reviewItem.contentDetails?.isbn || reviewItem.attributes?.isbn || "—"}</span>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground">USBN:</span>
                                                <span className="ml-2 font-mono">{reviewItem.contentDetails?.usbn || "—"}</span>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground">Wallet:</span>
                                                <span className="ml-2 font-mono text-xs">{reviewItem.wallet ? `${reviewItem.wallet.slice(0, 6)}...${reviewItem.wallet.slice(-4)}` : "—"}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Categories & Tags */}
                                    {(reviewItem.contentDetails?.categories?.length > 0 || reviewItem.attributes?.genre?.length > 0) && (
                                        <div className="p-4 rounded-lg border bg-muted/30">
                                            <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                                                <Tag className="w-4 h-4" /> Categories
                                            </h4>
                                            <div className="flex flex-wrap gap-1">
                                                {[...(reviewItem.contentDetails?.categories || []), ...(reviewItem.attributes?.genre || [])].map((cat: string, i: number) => (
                                                    <span key={i} className="px-2 py-1 bg-primary/10 text-primary rounded-full text-xs">{cat}</span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Tags */}
                                    {(reviewItem.contentDetails?.tags?.length > 0 || (reviewItem as any).tags?.length > 0) && (
                                        <div className="p-4 rounded-lg border bg-muted/30">
                                            <h4 className="font-medium text-sm mb-2">Keywords</h4>
                                            <div className="flex flex-wrap gap-1">
                                                {[...(reviewItem.contentDetails?.tags || []), ...((reviewItem as any).tags || [])].map((tag: string, i: number) => (
                                                    <span key={i} className="px-2 py-1 bg-muted text-muted-foreground rounded-md text-xs">{tag}</span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Rights & Disclosures */}
                                    <div className="p-4 rounded-lg border bg-muted/30 space-y-2">
                                        <h4 className="font-medium text-sm">Rights & Content</h4>
                                        <div className="grid grid-cols-2 gap-2 text-sm">
                                            <div>
                                                <span className="text-muted-foreground">Rights:</span>
                                                <span className="ml-2">{reviewItem.contentDetails?.rights || "—"}</span>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground">AI Generated:</span>
                                                <span className="ml-2">{reviewItem.contentDetails?.aiGenerated?.used ? "Yes" : "No"}</span>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground">Age Restricted:</span>
                                                <span className="ml-2">{reviewItem.contentDetails?.ageRestricted ? "Yes" : "No"}</span>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground">Publisher:</span>
                                                <span className="ml-2">{reviewItem.contentDetails?.publisher || reviewItem.attributes?.publisher || "—"}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Footer Actions */}
                            <div className="sticky bottom-0 bg-background/95 backdrop-blur-sm border-t p-4 flex items-center justify-between">
                                <button
                                    onClick={() => setReviewItem(null)}
                                    className="px-4 py-2 border rounded-lg hover:bg-muted transition-colors"
                                >
                                    Close
                                </button>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => { decide(reviewItem.id, "REJECTED"); setReviewItem(null); }}
                                        className="flex items-center gap-2 px-6 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 rounded-lg font-medium transition-colors"
                                    >
                                        <X className="w-4 h-4" /> Reject
                                    </button>
                                    <button
                                        onClick={() => { decide(reviewItem.id, "APPROVED"); setReviewItem(null); }}
                                        className="flex items-center gap-2 px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
                                    >
                                        <Check className="w-4 h-4" /> Approve
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div >
    );
}

// ============ CONTRACTS MANAGER COMPONENT ============

const SUPPORTED_CHAINS = [
    { id: 8453, name: "Base", explorer: "https://basescan.org" },
    { id: 84532, name: "Base Sepolia", explorer: "https://sepolia.basescan.org" },
    { id: 1, name: "Ethereum", explorer: "https://etherscan.io" },
    { id: 11155111, name: "Sepolia", explorer: "https://sepolia.etherscan.io" },
    { id: 10, name: "Optimism", explorer: "https://optimistic.etherscan.io" },
    { id: 42161, name: "Arbitrum", explorer: "https://arbiscan.io" },
    { id: 137, name: "Polygon", explorer: "https://polygonscan.com" },
];

interface USBNContract {
    chainId: number;
    chainName: string;
    address: string;
    deployedAt: string;
    verified: boolean;
    txHash?: string;
}

function ContractsManager({
    account,
    deploying,
    setDeploying,
    deployLogs,
    setDeployLogs,
    deployedAddress,
    setDeployedAddress
}: any) {
    const [contracts, setContracts] = useState<USBNContract[]>([]);
    const [selectedChainId, setSelectedChainId] = useState(8453);
    const [verifyAddress, setVerifyAddress] = useState("");
    const [verifying, setVerifying] = useState(false);

    // Load contracts on mount
    useEffect(() => {
        loadContracts();
    }, []);

    async function loadContracts() {
        try {
            const r = await fetch("/api/admin/usbn-contracts");
            const j = await r.json();
            if (j.ok) setContracts(j.contracts || []);
        } catch (e) {
            console.error(e);
        }
    }

    async function saveContract(chainId: number, address: string, txHash?: string) {
        const chainInfo = SUPPORTED_CHAINS.find(c => c.id === chainId);
        await fetch("/api/admin/usbn-contracts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chainId, chainName: chainInfo?.name, address, txHash }),
        });
        await loadContracts();
    }

    async function handleVerify(chainId: number, address: string) {
        setVerifying(true);
        setDeployLogs((prev: string[]) => [...prev, `Verifying ${address} on chain ${chainId}...`]);
        try {
            const r = await fetch("/api/admin/verify-contract", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ address, chainId }),
            });
            const j = await r.json();
            if (j.ok) {
                setDeployLogs((prev: string[]) => [...prev, `✓ ${j.message}`]);
                // Update verified status
                await fetch("/api/admin/usbn-contracts", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chainId, address, verified: true }),
                });
                await loadContracts();
            } else {
                setDeployLogs((prev: string[]) => [...prev, `⚠ ${j.error}`]);
            }
        } catch (e: any) {
            setDeployLogs((prev: string[]) => [...prev, `Error: ${e.message}`]);
        } finally {
            setVerifying(false);
        }
    }

    async function handleDeploy() {
        if (!account) return alert("Connect wallet first");
        setDeploying(true);
        setDeployLogs(["Starting deployment sequence..."]);

        try {
            const { smartWallet } = await import("thirdweb/wallets");
            const { base, baseSepolia, optimism, arbitrum, polygon, sepolia, ethereum } = await import("thirdweb/chains");

            // Get chain object
            const chainMap: Record<number, any> = {
                8453: base,
                84532: baseSepolia,
                1: ethereum,
                11155111: sepolia,
                10: optimism,
                42161: arbitrum,
                137: polygon,
            };
            const targetChain = chainMap[selectedChainId] || base;

            setDeployLogs((prev: any) => [...prev, `Target Chain: ${SUPPORTED_CHAINS.find(c => c.id === selectedChainId)?.name}`]);
            setDeployLogs((prev: any) => [...prev, "Configuring Smart Account (EIP-4337/7702)..."]);

            const wallet = smartWallet({ chain: targetChain, gasless: true });
            const smartAccount = await wallet.connect({ client, personalAccount: account });

            setDeployLogs((prev: any) => [...prev, `Smart Account: ${smartAccount.address}`]);
            setDeployLogs((prev: any) => [...prev, "Preparing transaction (Sponsored via Factory)..."]);

            // Use Arachnid Factory
            const FACTORY_ADDRESS = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
            let cleanBytecode = osirisArtifact.bytecode;
            if (cleanBytecode.startsWith("0x")) cleanBytecode = cleanBytecode.slice(2);

            const randomPart = Math.floor(Math.random() * 1000000000).toString(16).padStart(16, "0");
            const timePart = Date.now().toString(16).padStart(48, "0");
            const saltHex = (timePart + randomPart).slice(-64).padStart(64, "0");
            const deployData = `0x${saltHex}${cleanBytecode}`;

            const transaction = prepareTransaction({
                client,
                chain: targetChain,
                to: FACTORY_ADDRESS,
                value: BigInt(0),
                data: deployData as `0x${string}`,
            });

            const { transactionHash } = await sendTransaction({ account: smartAccount, transaction });
            setDeployLogs((prev: any) => [...prev, `Transaction Sent: ${transactionHash}`]);

            const receipt = await waitForReceipt({ client, chain: targetChain, transactionHash });

            // Find address from Deployed event
            let address: string | null = null;
            const DEPLOY_TOPIC = "0xf40fcec21964ffb566044d083b4073f29f7f7929110ea19e1b3ebe375d89055e";
            const log = receipt.logs.find(l => l.topics[0] === DEPLOY_TOPIC);
            if (log && log.topics[1]) {
                address = `0x${log.topics[1].slice(-40)}`;
            }

            if (!address) throw new Error("Could not find deployed address");

            setDeployedAddress(address);
            setDeployLogs((prev: any) => [...prev, `✓ Deployed: ${address}`]);

            // Save to DB
            await saveContract(selectedChainId, address, transactionHash);

            // Auto-verify
            await handleVerify(selectedChainId, address);

        } catch (e: any) {
            console.error(e);
            setDeployLogs((prev: any) => [...prev, `Error: ${e.message}`]);
        } finally {
            setDeploying(false);
        }
    }

    const selectedChain = SUPPORTED_CHAINS.find(c => c.id === selectedChainId);
    const chainContracts = contracts.filter(c => c.chainId === selectedChainId);

    return (
        <div className="w-full space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Deployment Card */}
                <div className="p-6 rounded-2xl border border-foreground/[0.05] bg-gradient-to-br from-foreground/[0.04] to-foreground/[0.01] backdrop-blur-md relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        <Rocket className="w-32 h-32" />
                    </div>
                    <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                        <Globe className="w-5 h-5 text-blue-400" /> Deploy OsirisUSBN
                    </h3>

                    {/* Chain Selector */}
                    <div className="mb-4">
                        <label className="text-xs text-slate-400 uppercase tracking-wider block mb-2">Target Chain</label>
                        <select
                            value={selectedChainId}
                            onChange={(e) => setSelectedChainId(Number(e.target.value))}
                            className="w-full h-10 px-4 bg-foreground/[0.03] border border-foreground/[0.05] rounded-lg transition-colors"
                        >
                            {SUPPORTED_CHAINS.map(c => (
                                <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                            ))}
                        </select>
                    </div>

                    <button
                        onClick={handleDeploy}
                        disabled={deploying || !account}
                        className="w-full px-6 py-3 bg-blue-500 hover:bg-blue-600 active:scale-95 transition-all rounded-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {deploying ? (
                            <><div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" /> Deploying...</>
                        ) : (
                            <><Rocket className="w-4 h-4" /> Deploy to {selectedChain?.name}</>
                        )}
                    </button>

                    {deployedAddress && (
                        <div className="mt-4 p-3 bg-green-500/20 border border-green-500/30 rounded-lg">
                            <div className="text-xs text-green-300 uppercase font-bold tracking-wider mb-1">Latest Deployment</div>
                            <div className="font-mono text-sm break-all">{deployedAddress}</div>
                        </div>
                    )}
                </div>

                {/* Logs Console */}
                <div className="p-6 rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] font-mono text-xs overflow-y-auto max-h-[350px]">
                    <div className="flex items-center gap-2 border-b border-foreground/[0.05] pb-2 mb-2 text-emerald-500">
                        <Terminal className="w-4 h-4" /> Deployment Logs
                    </div>
                    <div className="space-y-1 text-muted-foreground">
                        {deployLogs.length === 0 && <span className="opacity-50">Waiting for commands...</span>}
                        {deployLogs.map((log: string, i: number) => (
                            <div key={i} className="break-words">
                                <span className="text-emerald-600 mr-2">[{new Date().toLocaleTimeString()}]</span>
                                {log}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Deployed Contracts List */}
            <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md p-6">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-primary" />
                    Deployed Contracts
                    <span className="text-xs font-normal text-muted-foreground ml-2">({contracts.length} total)</span>
                </h3>

                {contracts.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">No contracts deployed yet</div>
                ) : (
                    <div className="space-y-3">
                        {contracts.map((c, i) => {
                            const chainInfo = SUPPORTED_CHAINS.find(ch => ch.id === c.chainId);
                            return (
                                <div key={i} className="p-4 rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] flex items-center justify-between gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-xs font-medium px-2 py-0.5 rounded bg-primary/10 text-primary">{c.chainName}</span>
                                            {c.verified && <span className="text-xs font-medium px-2 py-0.5 rounded bg-green-500/20 text-green-600">Verified</span>}
                                        </div>
                                        <div className="font-mono text-sm break-all">{c.address}</div>
                                        <div className="text-xs text-muted-foreground mt-1">{new Date(c.deployedAt).toLocaleString()}</div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        {!c.verified && (
                                            <button
                                                onClick={() => handleVerify(c.chainId, c.address)}
                                                disabled={verifying}
                                                className="px-3 py-1.5 text-xs font-medium bg-amber-500 hover:bg-amber-600 text-white rounded"
                                            >
                                                Verify
                                            </button>
                                        )}
                                        <a
                                            href={`${chainInfo?.explorer}/address/${c.address}#code`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-3 py-1.5 text-xs font-medium bg-muted hover:bg-muted/80 rounded"
                                        >
                                            Explorer
                                        </a>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Manual Verify Utility */}
            <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md p-6">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-amber-500" /> Manual Verification
                </h3>
                <div className="flex gap-4">
                    <select
                        value={selectedChainId}
                        onChange={(e) => setSelectedChainId(Number(e.target.value))}
                        className="h-10 px-4 border border-foreground/[0.05] rounded-lg bg-background text-sm"
                    >
                        {SUPPORTED_CHAINS.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                    <input
                        type="text"
                        placeholder="Contract Address (0x...)"
                        value={verifyAddress}
                        onChange={(e) => setVerifyAddress(e.target.value)}
                        className="flex-1 h-10 px-4 border border-foreground/[0.05] rounded-lg bg-background font-mono text-sm"
                    />
                    <button
                        onClick={() => {
                            if (verifyAddress) handleVerify(selectedChainId, verifyAddress);
                        }}
                        disabled={verifying || !verifyAddress}
                        className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-lg disabled:opacity-50"
                    >
                        {verifying ? "Verifying..." : "Verify Contract"}
                    </button>
                </div>
            </div>
        </div>
    );
}
