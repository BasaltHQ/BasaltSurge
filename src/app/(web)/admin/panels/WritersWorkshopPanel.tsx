"use client";

import React, { useState, useEffect } from "react";
import { useActiveAccount } from "thirdweb/react";
import { Plus, Edit2, Trash2, Save, X, Eye, Book, BookOpen, Image as ImageIcon, FileText, Upload, AlertTriangle, ShieldCheck, Tag, Globe, Library, Users, CheckCircle, ChevronRight, ChevronLeft, HelpCircle, FolderTree, RefreshCw, Lock, ExternalLink, Archive, Code } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { BOOK_CATEGORIES, BookCategory } from "@/lib/book-categories";
import { client, chain } from "@/lib/thirdweb/client";
import { getContract, prepareContractCall, sendTransaction, readContract, waitForReceipt } from "thirdweb";
import { getPdfPageCount } from "@/app/(web)/actions/pdf-utils";
import OsirisUSBNArtifact from "@/lib/contracts/OsirisUSBN.json";

/**
 * Writer's Workshop Panel - Professional Publishing Wizard
 * Three Main Tabs:
 * 1. Details (Metadata, Contributors, Series, etc.)
 * 2. Content (Manuscript, Cover, Preview, AI)
 * 3. Rights (Territories, DRM, Price)
 */

type Step = "details" | "content" | "rights";

// Extended Book Type
type BookInventoryItem = {
    id?: string;
    sku: string;
    name: string;
    description?: string;
    priceUsd: number;
    stockQty: number; // -1 for digital
    isBook: boolean;
    industryPack?: string;
    attributes?: any;
    images?: string[]; // Shop Thumbnail (Array)
    bookCoverUrl?: string; // Cover
    bookFileUrl?: string; // Manuscript (KPF/PDF/EPUB)
    previewUrl?: string; // Preview file
    approvalStatus?: string;
    drmEnabled?: boolean;

    // Content details
    contentDetails?: {
        // Details
        subtitle?: string;
        author?: string; // Firstname Lastname combined for simplicity in UI, but could be split
        authorFirstName?: string;
        authorLastName?: string;
        contributors?: Array<{ firstName: string; lastName: string; role: string }>;
        edition?: number;
        language?: string;
        series?: string;
        seriesOrder?: number;
        seriesDescription?: string;
        isSeriesOrdered?: boolean;

        // Categorization
        genre?: string;
        categories?: string[]; // Up to 3, precise strings like "Fiction > Sci-Fi > Cyberpunk"
        tags?: string[]; // Keywords (up to 7)
        publisher?: string;
        isbn?: string;
        usbn?: string;
        usbnMinted?: boolean;
        usbnTxHash?: string;
        usbnMetadataUrl?: string;
        usbnTimestamp?: number;
        usbnCost?: string; // ETH cost (string format)
        usbnCostUsd?: string; // USD cost (string format: "$0.00")
        pages?: number;

        // Content & Rights
        rights?: 'copyright' | 'public_domain';
        aiGenerated?: { used: boolean; methods?: string[] };
        ageRestricted?: boolean;
        readingAge?: { min?: number; max?: number };
        contentDisclosure?: string; // "Adult", "Violence"

        // Revision
        revisionStatus?: 'PENDING';
        pendingRevision?: any;
    }
};

const LANGUAGES = [
    { code: "en", name: "English" }, { code: "es", name: "Spanish" },
    { code: "fr", name: "French" }, { code: "de", name: "German" },
    { code: "ja", name: "Japanese" }, { code: "zh", name: "Chinese" }
];

const CONTRIBUTOR_ROLES = ["Editor", "Illustrator", "Translator", "Introduction", "Narrator"];
const AGE_RANGES = Array.from({ length: 18 }, (_, i) => i + 1).map(n => ({ val: n, label: `${n}` })).concat([{ val: 19, label: "18+" }]);

// Styles - Adjusted to sit BELOW the main navbar (top-20 safety margin) and ensure visibility
const WIZARD_PANE_CLASS = "fixed inset-0 top-[80px] z-40 bg-background/95 backdrop-blur-sm flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-200 border-t shadow-2xl";

// --- Helpers ---
const fetchEthPrice = async () => {
    try {
        const res = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot");
        const data = await res.json();
        return parseFloat(data.data.amount);
    } catch (e) {
        console.error("Failed to fetch ETH price", e);
        return 0;
    }
};

const toScientific = (n: number) => {
    if (n === 0) return "0";
    return n.toExponential(2);
};

export default function WritersWorkshopPanel() {
    const account = useActiveAccount();
    const [items, setItems] = useState<BookInventoryItem[]>([]);
    const [loading, setLoading] = useState(false);

    // View State
    const [viewTab, setViewTab] = useState<"active" | "archived" | "series">("active");

    // Editor State
    const [isEditing, setIsEditing] = useState(false);
    const [activeStep, setActiveStep] = useState<Step>("details");
    const [editItem, setEditItem] = useState<BookInventoryItem | null>(null);
    const [saving, setSaving] = useState(false);
    const [minting, setMinting] = useState(false);
    const [reindexing, setReindexing] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");

    // UI Helpers
    const [tagInput, setTagInput] = useState("");
    const [contributorInput, setContributorInput] = useState({ fn: "", ln: "", role: "Editor" });
    const [uploadStates, setUploadStates] = useState({ cover: false, manuscript: false, preview: false, shopThumbnail: false });

    // Category Picker State
    const [catModalOpen, setCatModalOpen] = useState(false);
    const [catPath, setCatPath] = useState<BookCategory[]>([]); // Current navigation path

    useEffect(() => { load(); }, [account?.address]);

    // Background Fixer for Page Counts
    async function calculatePages(url: string, type: 'pdf' | 'epub'): Promise<number> {
        if (!url || typeof window === 'undefined') return 0;

        try {
            if (type === 'pdf') {
                // Use Server Action to avoid client-side worker/WASM issues with Turbopack
                return await getPdfPageCount(url);
            } else {
                // EPUB / Zip
                const JSZip = (await import('jszip')).default;

                const res = await fetch(url);
                const blob = await res.blob();
                const zip = await JSZip.loadAsync(blob);

                // HEURISTIC: TEXT SIZE / 3000
                let totalTextSize = 0;
                zip.forEach((path: string, file: any) => {
                    if (path.match(/\.(html|xhtml|htm|xml)$/i)) {
                        // @ts-ignore
                        if (file._data && file._data.uncompressedSize) {
                            // @ts-ignore
                            totalTextSize += file._data.uncompressedSize;
                        }
                    }
                });

                // Fallback to spine items if size fails
                if (totalTextSize === 0) {
                    const container = await zip.file("META-INF/container.xml")?.async("string");
                    if (container) {
                        const opfPath = container.match(/full-path="([^"]+)"/)?.[1];
                        if (opfPath) {
                            const opf = await zip.file(opfPath)?.async("string");
                            if (opf) {
                                const matches = opf.match(/<itemref/g);
                                if (matches) return matches.length * 5;
                            }
                        }
                    }
                }

                // Standard book page ~3000 bytes of markup-heavy HTML
                const estimated = Math.ceil(totalTextSize / 3000);
                return estimated > 0 ? estimated : 1;
            }
        } catch (e) {
            console.error("Page count calc failed", e);
            return 0;
        }
    }

    async function fixPageCounts(books: BookInventoryItem[]) {
        const toFix = books.filter(b => b.approvalStatus === "APPROVED" && (!b.contentDetails?.pages || b.contentDetails.pages === 0) && b.bookFileUrl);
        if (toFix.length === 0) return;

        console.log(`[WritersWorkshop] Auto-detecting pages for ${toFix.length} books...`);

        for (const book of toFix) {
            const ext = book.bookFileUrl?.split('.').pop()?.toLowerCase();
            const type = ext === 'pdf' ? 'pdf' : 'epub';
            if (!book.bookFileUrl) continue;

            const pages = await calculatePages(book.bookFileUrl, type);
            if (pages > 0) {
                console.log(`[WritersWorkshop] Updated ${book.name}: ${pages} pages`);
                await persistBook({
                    ...book,
                    contentDetails: {
                        ...book.contentDetails,
                        pages: pages
                    }
                });
                // Update local
                setItems(curr => curr.map(i => i.id === book.id ? { ...i, contentDetails: { ...i.contentDetails!, pages } } : i));
            }
        }
    }

    async function load() {
        if (!account?.address) return;
        setLoading(true);
        try {
            const r = await fetch("/api/inventory", {
                cache: "no-store",
                credentials: "include",
                headers: {
                    "x-wallet": account.address,
                }
            });
            const j = await r.json();
            console.log("[WritersWorkshop] Load response:", r.status, j);

            // The GET endpoint returns { items, total, page, pageSize } - not { ok, items }
            if (r.ok && Array.isArray(j.items)) {
                const books = j.items.filter((x: any) => x.isBook === true || x.industryPack === "publishing");
                console.log("[WritersWorkshop] Found books:", books.length);
                setItems(books);
                // Background fix
                fixPageCounts(books);
            } else if (j.error) {
                console.error("[WritersWorkshop] Load error:", j.error);
            }
        } catch (e) {
            console.error("[WritersWorkshop] Load exception:", e);
        } finally {
            setLoading(false);
        }
    }

    async function deleteItem(id: string) {
        if (!confirm("Are you sure you want to delete this book? This action cannot be undone.")) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/inventory?id=${id}`, {
                method: "DELETE",
                headers: { "x-wallet": account?.address || "" },
                credentials: "include"
            });
            const j = await res.json().catch(() => ({}));
            if (res.ok && j.ok) {
                setItems(prev => prev.filter(i => i.id !== id));
            } else {
                alert(`Failed to delete item: ${j.error || "Unknown error"}`);
            }
        } catch (e) {
            alert("Error deleting item");
        } finally {
            setLoading(false);
        }
    }

    async function archiveItem(item: BookInventoryItem) {
        if (!confirm(`Are you sure you want to archive "${item.name}"? It will be hidden from the shop.`)) return;
        setLoading(true);
        try {
            const payload = { ...item, approvalStatus: "ARCHIVED" };
            await fetch("/api/inventory", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
                body: JSON.stringify(payload)
            });
            await load();
        } catch (e) { alert("Failed to archive"); }
        finally { setLoading(false); }
    }

    async function unarchiveItem(item: BookInventoryItem) {
        setLoading(true);
        try {
            const payload = { ...item, approvalStatus: "DRAFT" }; // Revert to Draft
            await fetch("/api/inventory", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
                body: JSON.stringify(payload)
            });
            await load();
        } catch (e) { alert("Failed to unarchive"); }
        finally { setLoading(false); }
    }

    function startNew() {
        const skuTime = Date.now().toString();
        // Generate Deterministic USBN
        const walletPart = account?.address ? account.address.substring(2, 8).toUpperCase() : "UNK";
        const generatedUSBN = `USBN-${walletPart}-${skuTime.slice(-6)}`;

        setEditItem({
            sku: `BOOK-${skuTime.slice(-6)}`,
            name: "",
            priceUsd: 9.99,
            stockQty: -1,
            isBook: true,
            approvalStatus: "PENDING",
            drmEnabled: true,
            contentDetails: {
                language: "en",
                rights: "copyright",
                contributors: [],
                tags: [],
                categories: [],
                aiGenerated: { used: false },
                readingAge: {},
                authorFirstName: "",
                authorLastName: "",
                usbn: generatedUSBN,
                usbnMinted: false
            }
        });
        setActiveStep("details");
        setIsEditing(true);
    }

    function edit(item: BookInventoryItem) {
        const skuTime = Date.now().toString();
        const walletPart = account?.address ? account.address.substring(2, 8).toUpperCase() : "UNK";
        const sourceDetails = item.contentDetails || {};
        const attrs = (item.attributes as any) || {};

        const hydrated = {
            ...item,
            bookCoverUrl: item.bookCoverUrl || ((item as any).images && (item as any).images[0]) || "", // Fallback to inventory image
            contentDetails: {
                ...sourceDetails,
                // Robust Fallbacks (prioritizing sourceDetails if present, but filling gaps)
                contributors: sourceDetails.contributors || [],
                tags: sourceDetails.tags || (item as any).tags || [],
                categories: sourceDetails.categories || attrs.genre || [],
                aiGenerated: sourceDetails.aiGenerated || { used: false },
                readingAge: sourceDetails.readingAge || {},
                authorFirstName: sourceDetails.authorFirstName || (attrs.author || "").split(' ')[0] || "",
                authorLastName: sourceDetails.authorLastName || (attrs.author || "").split(' ').slice(1).join(' ') || "",
                publisher: sourceDetails.publisher || attrs.publisher,
                isbn: sourceDetails.isbn || attrs.isbn,
                pages: sourceDetails.pages || attrs.pageCount,
                language: sourceDetails.language || attrs.language,
                usbn: sourceDetails.usbn || `USBN-${walletPart}-${skuTime.slice(-6)}`,
                usbnMinted: sourceDetails.usbnMinted || false
            }
        };
        setEditItem(hydrated);
        setActiveStep("details");
        setIsEditing(true);
    }

    async function handleUpload(file: File, type: "cover" | "manuscript" | "preview" | "shopThumbnail") {
        if (!file || !editItem) return;
        setUploadStates(p => ({ ...p, [type]: true }));
        try {
            const isImage = type === "cover" || type === "shopThumbnail";
            const body = new FormData();
            body.append("file", file);
            const res = await fetch(isImage ? "/api/public/images" : "/api/uploads", { method: "POST", body });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error);
            const url = isImage ? j.images?.[0]?.url : j.files?.[0]?.url;

            setEditItem(prev => {
                if (!prev) return null;
                const next = { ...prev };
                if (type === "cover") next.bookCoverUrl = url;
                if (type === "manuscript") next.bookFileUrl = url;
                if (type === "preview") next.previewUrl = url;
                if (type === "shopThumbnail") next.images = [url]; // Set as primary shop image
                return next;
            });
        } catch (e) { alert("Upload failed"); }
        finally { setUploadStates(p => ({ ...p, [type]: false })); }
    }

    async function save(asDraft = false) {
        if (!editItem) return;

        // Find original item to compare changes if APPROVED
        const originalItem = items.find(i => i.id === editItem.id);
        const isApproved = originalItem?.approvalStatus === "APPROVED";

        // Combine author name
        const fullAuthor = `${editItem.contentDetails?.authorFirstName || ""} ${editItem.contentDetails?.authorLastName || ""}`.trim();

        // 1. Construct the "New State" Payload (what we WANT the book to be)
        const newAttributes = {
            title: editItem.name,
            author: fullAuthor,
            publisher: editItem.contentDetails?.publisher,
            isbn: editItem.contentDetails?.isbn,
            pageCount: editItem.contentDetails?.pages,
            language: editItem.contentDetails?.language,
            edition: editItem.contentDetails?.edition?.toString(),
            genre: editItem.contentDetails?.categories || [],
            downloadUrl: editItem.bookFileUrl,
            bookCoverUrl: editItem.bookCoverUrl, // Explicitly save cover url in attributes too
            previewUrl: editItem.previewUrl,
            drmEnabled: editItem.drmEnabled,
            format: 'Ebook',
            condition: 'New'
        };

        const newContentDetails = {
            ...editItem.contentDetails,
            author: fullAuthor
        };

        const newItemState = {
            ...editItem,
            tags: editItem.contentDetails?.tags || [],
            category: editItem.contentDetails?.categories?.[0],
            isBook: true,
            industryPack: 'publishing',
            attributes: newAttributes,
            contentDetails: newContentDetails
        };

        let finalPayload: any = { ...newItemState };

        // 2. Revision Logic
        if (isApproved && !asDraft) {
            // specific fields that trigger revision: name, bookFileUrl, bookCoverUrl
            // We do NOT want to overwrite the LIVE item if these changed.
            // Instead, we store the CHANGES in `pendingRevision`.
            // Note: We ALLOW 'images' (Shop Thumbnail) to update immediately as requested ("inventory item image... should not override... distinct").
            // User did NOT say shop thumbnail needs approval, but typically it might. For now, following instructions to keep them distinct.
            // Assuming Shop Changes (Inventory) might be auto-approved or allowed, but MANUSCRIPT/COVER need reapproval.

            console.log("[WritersWorkshop] Item is APPROVED. Creating Pending Revision.");

            // Keep LIVE fields from Original
            finalPayload = {
                ...originalItem!,
                // We MIGHT allow some harmless updates immediately (like price, stock, shop images?)
                // User said: "Inventory item image... should only show in item card... cover... stored separately".
                // User said: "Submit for reapproval if manuscript and cover image are updated."
                // So, let's keep LIVE manuscript/cover/title.

                // Allow Shop Image update immediately? Or revision?
                // "Inventory item image... can be set via add/edit modals... should not override"
                // Let's allow Shop Image (images array) to update immediately for now, unless unsafe.
                images: editItem.images,
                priceUsd: editItem.priceUsd, // Allow price updates immediately? Usually safe.

                // CRITICAL: Revert these to ORIGINAL for the "Main" entry
                name: originalItem!.name,
                bookFileUrl: originalItem!.bookFileUrl,
                bookCoverUrl: originalItem!.bookCoverUrl,
                attributes: originalItem!.attributes,
                contentDetails: {
                    ...originalItem!.contentDetails,
                    // Store the Revision Request here
                    pendingRevision: {
                        name: editItem.name,
                        bookFileUrl: editItem.bookFileUrl,
                        bookCoverUrl: editItem.bookCoverUrl,
                        attributes: newAttributes,
                        contentDetails: newContentDetails,
                        timestamp: Date.now()
                    },
                    revisionStatus: 'PENDING'
                },
                approvalStatus: 'APPROVED' // Keep it APPROVED live
            };
        } else {
            // Draft or Pending, or Brand New - Just overwrite/create
            finalPayload.approvalStatus = asDraft ? "DRAFT" : "PENDING";
        }

        try {
            setSaving(true);
            const res = await fetch("/api/inventory", {
                method: "POST",
                credentials: "include",
                cache: "no-store",
                headers: {
                    "Content-Type": "application/json",
                    "x-wallet": account?.address || "",
                },
                body: JSON.stringify(finalPayload)
            });
            const j = await res.json().catch(() => ({}));
            console.log("[WritersWorkshop] Save response:", res.status, j);

            if (res.ok && j?.ok) {
                setIsEditing(false);
                load();
                if (isApproved && !asDraft) alert("Your changes have been submitted for review. The previous version remains live until approved.");
            } else {
                alert(`Failed to save book: ${j?.error || res.statusText || "Unknown error"}`);
            }
        } catch (e: any) {
            console.error("[WritersWorkshop] Save error:", e);
            alert(`Network error saving book: ${e?.message || "Unknown"}`);
        } finally { setSaving(false); }
    }

    function refreshUSBN() {
        const skuTime = Date.now().toString();
        const walletPart = account?.address ? account.address.substring(2, 8).toUpperCase() : "UNK";
        const generatedUSBN = `USBN-${walletPart}-${skuTime.slice(-6)}`;

        setEditItem(prev => {
            if (!prev) return null;
            return {
                ...prev,
                contentDetails: {
                    ...prev.contentDetails,
                    usbn: generatedUSBN,
                    usbnMinted: false,
                    usbnTxHash: undefined
                }
            };
        });
    }

    const [verifying, setVerifying] = useState(false);

    async function checkOnChainStatus() {
        if (!editItem?.contentDetails?.usbn) return;
        setVerifying(true);
        try {
            // Fetch verified contract 
            let targetAddr = "0x252b2f74b139f0cc21335c9403fb300f2b923204";
            try {
                const res = await fetch("/api/admin/usbn-contracts");
                const d = await res.json();
                const matched = d.contracts?.find((c: any) => c.chainId === chain.id) || d.contracts?.[0];
                if (matched?.address) targetAddr = matched.address;
            } catch { }

            const contract = getContract({
                client,
                chain,
                address: targetAddr,
                abi: OsirisUSBNArtifact.abi as any
            });

            const data = await readContract({
                contract,
                method: "getBookDetails",
                params: [editItem.contentDetails.usbn]
            });

            // Check if returned USBN matches
            const registeredUSBN = data?.[0];

            if (registeredUSBN && registeredUSBN === editItem.contentDetails.usbn) {
                if (!editItem.contentDetails.usbnMinted) {
                    setEditItem(prev => (!prev ? null : {
                        ...prev,
                        contentDetails: { ...prev.contentDetails!, usbnMinted: true }
                    }));
                }
            } else {
                if (editItem.contentDetails.usbnMinted) {
                    setEditItem(prev => (!prev ? null : {
                        ...prev,
                        contentDetails: { ...prev.contentDetails!, usbnMinted: false, usbnTxHash: undefined }
                    }));
                }
            }
        } catch (e) {
            console.error("Verification error - Preserving status", e);
        } finally {
            setVerifying(false);
        }
    }

    // Effect to auto-check when entering Rights
    useEffect(() => {
        if (isEditing && activeStep === "rights" && editItem?.approvalStatus === "APPROVED") {
            checkOnChainStatus();
        }
    }, [isEditing, activeStep, editItem?.id]);


    async function persistBook(item: BookInventoryItem) {
        const fullAuthor = `${item.contentDetails?.authorFirstName || ""} ${item.contentDetails?.authorLastName || ""}`.trim();
        const publishingAttributes = {
            title: item.name,
            author: fullAuthor,
            bookCoverUrl: item.bookCoverUrl,
            publisher: item.contentDetails?.publisher,
            isbn: item.contentDetails?.isbn,
            pageCount: item.contentDetails?.pages,
            language: item.contentDetails?.language,
            edition: item.contentDetails?.edition?.toString(),
            genre: item.contentDetails?.categories || [],
            downloadUrl: item.bookFileUrl,
            previewUrl: item.previewUrl,
            drmEnabled: item.drmEnabled,
            format: 'Ebook',
            condition: 'New'
        };

        const payload = {
            ...item,
            attributes: publishingAttributes,
            contentDetails: { ...item.contentDetails, author: fullAuthor },
            industryPack: 'publishing',
            isBook: true
        };

        await fetch("/api/inventory", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
            body: JSON.stringify(payload)
        });
    }

    function handleUSBNReset() {
        if (confirm("Generate a new USBN? This allows you to mint a fresh record.")) {
            refreshUSBN();
        }
    }

    // --- USBN Minting ---
    async function reindexCost() {
        if (!editItem || !editItem.contentDetails?.usbnTxHash || !account) return;
        setReindexing(true);
        try {
            const receipt = await waitForReceipt({
                client,
                chain,
                transactionHash: editItem.contentDetails.usbnTxHash as any
            });

            if (receipt && receipt.gasUsed && receipt.effectiveGasPrice) {
                const costWei = BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice);
                const costEth = Number(costWei) / 1e18;
                const ethScientific = toScientific(costEth);

                // Get USD Price
                const ethPrice = await fetchEthPrice();
                const costUsd = ethPrice > 0 ? (costEth * ethPrice) : 0;
                const costUsdStr = costUsd < 0.01 ? "< $0.01" : `$${costUsd.toFixed(2)}`;

                const ethCostDisplay = `${ethScientific} ETH`;

                // Update
                const updatedDetails = {
                    ...editItem.contentDetails,
                    usbnCost: ethCostDisplay,
                    usbnCostUsd: costUsdStr
                };
                const updatedItem = { ...editItem, contentDetails: updatedDetails };
                setEditItem(updatedItem);

                // Save silently
                await persistBook(updatedItem);
                alert(`Cost Indexing Complete: ${ethCostDisplay} (${costUsdStr})`);
            } else {
                alert("Could not retrieve cost from receipt.");
            }
        } catch (e) {
            console.error("Reindexing failed", e);
            alert("Reindexing failed");
        } finally {
            setReindexing(false);
        }
    }

    async function mintUSBN() {
        if (!editItem || !editItem.contentDetails?.usbn || !account) return;
        setMinting(true);
        try {
            // Fetch verified contract or use user-provided fallback
            let targetAddr = "0x252b2f74b139f0cc21335c9403fb300f2b923204";
            try {
                const res = await fetch("/api/admin/usbn-contracts");
                const d = await res.json();
                const matched = d.contracts?.find((c: any) => c.chainId === chain.id) || d.contracts?.[0];
                if (matched?.address) targetAddr = matched.address;
            } catch { }

            const contract = getContract({
                client,
                chain,
                address: targetAddr,
                abi: OsirisUSBNArtifact.abi as any
            });

            // Auto-generate metadata URL for on-chain record
            // Uses USBN-based lookup for cleaner URLs
            const origin = window.location.origin;
            const metadataUrl = `${origin}/api/metadata/usbn/${editItem.contentDetails.usbn}`;

            const transaction = prepareContractCall({
                contract,
                method: "registerBook",
                params: [
                    editItem.contentDetails.usbn,
                    editItem.name,
                    `${editItem.contentDetails.authorFirstName} ${editItem.contentDetails.authorLastName}`,
                    metadataUrl
                ]
            });

            const { transactionHash } = await sendTransaction({
                account,
                transaction
            });

            // Wait for receipt to get gas cost
            let ethCost = "Gas Only (Base)";
            let usdCost = "";

            try {
                const receipt = await waitForReceipt({
                    client,
                    chain,
                    transactionHash
                });

                if (receipt && receipt.gasUsed && receipt.effectiveGasPrice) {
                    const costWei = BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice);
                    const costEth = Number(costWei) / 1e18;

                    const ethScientific = toScientific(costEth);
                    ethCost = `${ethScientific} ETH`;

                    // USD
                    const ethPrice = await fetchEthPrice();
                    const valUsd = ethPrice > 0 ? (costEth * ethPrice) : 0;
                    usdCost = valUsd < 0.01 ? "< $0.01" : `$${valUsd.toFixed(2)}`;
                }
            } catch (err) {
                console.warn("Failed to fetch receipt for gas cost", err);
            }

            // 1. Update State
            const updatedDetails = {
                ...editItem.contentDetails,
                usbnMinted: true,
                usbnTxHash: transactionHash,
                usbnMetadataUrl: metadataUrl,
                usbnTimestamp: Date.now(),
                usbnCost: ethCost,
                usbnCostUsd: usdCost
            };
            const updatedItem = { ...editItem, contentDetails: updatedDetails };

            setEditItem(updatedItem);

            // 2. Persist to Backend (Silent Auto-Save)
            const fullAuthor = `${updatedDetails.authorFirstName || ""} ${updatedDetails.authorLastName || ""}`.trim();
            const publishingAttributes = {
                title: updatedItem.name,
                author: fullAuthor,
                publisher: updatedDetails.publisher,
                isbn: updatedDetails.isbn,
                pageCount: updatedDetails.pages,
                language: updatedDetails.language,
                edition: updatedDetails.edition?.toString(),
                genre: updatedDetails.categories || [],
                downloadUrl: updatedItem.bookFileUrl,
                previewUrl: updatedItem.previewUrl,
                drmEnabled: updatedItem.drmEnabled,
                format: 'Ebook',
                condition: 'New'
            };

            const payload = {
                ...updatedItem,
                attributes: publishingAttributes,
                contentDetails: { ...updatedDetails, author: fullAuthor },
                industryPack: 'publishing',
                isBook: true
            };

            // Save silently
            await fetch("/api/inventory", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
                body: JSON.stringify(payload)
            });

            alert(`USBN Registered Successfully & Saved!\nTransaction: ${transactionHash.slice(0, 10)}...`);
        } catch (e: any) {
            console.error("Minting failed", e);
            alert("Minting failed: " + (e.message || "Unknown error"));
        } finally {
            setMinting(false);
        }
    }

    // Category Logic
    function handleCategorySelect(finalCat: BookCategory) {
        // Construct full path string
        const fullPath = [...catPath.map(c => c.name), finalCat.name].join(" › ");
        setEditItem(prev => {
            if (!prev) return null;
            const currentCats = prev.contentDetails?.categories || [];
            if (currentCats.includes(fullPath) || currentCats.length >= 3) return prev;
            return {
                ...prev,
                contentDetails: {
                    ...prev.contentDetails,
                    categories: [...currentCats, fullPath]
                }
            };
        });
        setCatModalOpen(false);
        setCatPath([]);
    }

    // Step Logic
    function canAdvanceToContent() {
        if (!editItem) return false;
        return !!editItem.name && !!editItem.contentDetails?.authorLastName;
    }

    function StepButton({ step, label, current }: { step: Step, label: string, current: string }) {
        const isActive = current === step;
        const isPast = (step === "details" && current !== "details") || (step === "content" && current === "rights");

        return (
            <button
                disabled={!isEditing}
                onClick={() => {
                    if (step === "details") setActiveStep("details");
                    if (step === "content" && canAdvanceToContent()) setActiveStep("content");
                    if (step === "rights" && canAdvanceToContent() && editItem?.bookFileUrl) setActiveStep("rights");
                }}
                className={`flex-1 flex flex-col items-center gap-1 py-3 border-b-2 transition-colors ${isActive ? "border-primary text-primary" :
                    isPast ? "border-primary/40 text-muted-foreground hover:text-primary" :
                        "border-transparent text-muted-foreground/50 cursor-not-allowed"
                    }`}
            >
                <div className={`text-xs font-bold uppercase tracking-wider whitespace-nowrap ${isActive ? "text-foreground" : ""}`}>{label}</div>
            </button>
        );
    }

    if (isEditing && editItem) {
        return (
            <div className={WIZARD_PANE_CLASS}>
                {/* Top Bar */}
                <div className="h-16 border-b flex items-center justify-between px-6 bg-muted/10 shrink-0">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setIsEditing(false)} className="p-2 bg-muted/50 hover:bg-red-500 hover:text-white rounded-full transition-colors" title="Close">
                            <X className="w-5 h-5" />
                        </button>
                        <h2 className="font-bold text-lg">{editItem.id ? `Edit: ${editItem.name}` : "Create New Title"}</h2>
                    </div>
                    <div className="flex gap-4 w-[600px]">
                        <StepButton step="details" label="1. Details" current={activeStep} />
                        <StepButton step="content" label="2. Content" current={activeStep} />
                        <StepButton step="rights" label="3. Rights & Pricing" current={activeStep} />
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => save(true)} className="px-4 py-2 text-sm font-medium hover:underline text-muted-foreground">Save as Draft</button>
                        <button onClick={() => save(false)} disabled={saving} className="px-6 py-2 bg-primary text-primary-foreground font-medium rounded-md shadow flex items-center gap-2">
                            {saving ? "Publishing..." : "Publish Book"}
                        </button>
                    </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-y-auto bg-muted/5">
                    <div className="max-w-4xl mx-auto py-10 px-6 pb-24 space-y-8">

                        {/* === STEP 1: DETAILS === */}
                        {activeStep === "details" && (
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
                                <div className="p-6 bg-background rounded-xl border shadow-sm space-y-6">
                                    <h3 className="text-lg font-bold">Book Details</h3>

                                    {/* Language */}
                                    <div className="space-y-1">
                                        <label className="text-sm font-bold">Language</label>
                                        <p className="text-xs text-muted-foreground mb-2">Choose the primary language your book is written in.</p>
                                        <select
                                            className="w-full max-w-xs p-2 bg-background border rounded"
                                            value={editItem.contentDetails?.language}
                                            onChange={e => setEditItem({ ...editItem, contentDetails: { ...editItem.contentDetails, language: e.target.value } })}
                                        >
                                            {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                                        </select>
                                    </div>

                                    {/* Title */}
                                    <div className="space-y-4">
                                        <div>
                                            <label className="text-sm font-bold">Book Title</label>
                                            <input
                                                className="w-full mt-1 p-2 bg-background border rounded"
                                                value={editItem.name}
                                                onChange={e => setEditItem({ ...editItem, name: e.target.value })}
                                                placeholder="The Master Work Function"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-sm font-bold">Subtitle <span className="text-muted-foreground font-normal">(Optional)</span></label>
                                            <input
                                                className="w-full mt-1 p-2 bg-background border rounded"
                                                value={editItem.contentDetails?.subtitle || ""}
                                                onChange={e => setEditItem({ ...editItem, contentDetails: { ...editItem.contentDetails, subtitle: e.target.value } })}
                                                placeholder="A Scalar Potential for Hybrid..."
                                            />
                                        </div>
                                    </div>

                                    {/* Series */}
                                    <div className="p-4 bg-muted/20 rounded border space-y-3">
                                        <div className="flex items-center gap-2">
                                            <Library className="w-4 h-4 text-primary" />
                                            <span className="font-bold text-sm">Series</span>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            <div className="md:col-span-2">
                                                <label className="text-xs font-medium">Series Title</label>
                                                <input className="w-full mt-1 p-2 bg-background border rounded text-sm" placeholder="The Utility Network"
                                                    value={editItem.contentDetails?.series || ""}
                                                    onChange={e => setEditItem({ ...editItem, contentDetails: { ...editItem.contentDetails, series: e.target.value } })}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs font-medium">Volume #</label>
                                                <input type="number" className="w-full mt-1 p-2 bg-background border rounded text-sm" placeholder="1"
                                                    value={editItem.contentDetails?.seriesOrder || ""}
                                                    onChange={e => setEditItem({ ...editItem, contentDetails: { ...editItem.contentDetails, seriesOrder: parseInt(e.target.value) } })}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Shop Thumbnail (Inventory Image) */}
                                    <div className="flex gap-6 items-start p-4 bg-muted/10 rounded border">
                                        <div className="w-24 h-24 bg-background rounded-md border flex items-center justify-center overflow-hidden relative shadow-sm shrink-0">
                                            {editItem.images && editItem.images.length > 0 ? (
                                                <img src={editItem.images[0]} className="w-full h-full object-contain" />
                                            ) : (
                                                <ImageIcon className="text-muted-foreground opacity-20" />
                                            )}
                                            {uploadStates.shopThumbnail && (
                                                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                                </div>
                                            )}
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-bold flex items-center gap-2">Shop Thumbnail</h4>
                                            <p className="text-xs text-muted-foreground mb-2">
                                                This image is used for the Shop Grid card. It is separate from your official Book Cover.
                                            </p>
                                            <label className="cursor-pointer inline-flex px-3 py-1.5 bg-secondary text-secondary-foreground rounded text-xs font-bold hover:bg-secondary/80">
                                                {uploadStates.shopThumbnail ? "Uploading..." : "Upload Thumbnail"}
                                                <input type="file" className="hidden" accept="image/*" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0], "shopThumbnail")} />
                                            </label>
                                        </div>
                                    </div>

                                    {/* Edition & Author */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div>
                                            <label className="text-sm font-bold">Edition Number</label>
                                            <input type="number" className="w-full mt-1 p-2 bg-background border rounded" placeholder="1"
                                                value={editItem.contentDetails?.edition || ""}
                                                onChange={e => setEditItem({ ...editItem, contentDetails: { ...editItem.contentDetails, edition: parseInt(e.target.value) } })}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-sm font-bold">Primary Author</label>
                                            <div className="flex gap-2 mt-1">
                                                <input className="flex-1 p-2 bg-background border rounded text-sm" placeholder="First Name"
                                                    value={editItem.contentDetails?.authorFirstName || ""}
                                                    onChange={e => setEditItem({ ...editItem, contentDetails: { ...editItem.contentDetails, authorFirstName: e.target.value } })}
                                                />
                                                <input className="flex-1 p-2 bg-background border rounded text-sm" placeholder="Last Name"
                                                    value={editItem.contentDetails?.authorLastName || ""}
                                                    onChange={e => setEditItem({ ...editItem, contentDetails: { ...editItem.contentDetails, authorLastName: e.target.value } })}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Contributors */}
                                    <div className="space-y-2">
                                        <label className="text-sm font-bold">Contributors</label>
                                        <div className="flex gap-2 items-end p-3 bg-muted/10 rounded border">
                                            <div className="flex-1">
                                                <span className="text-xs">First Name</span>
                                                <input className="w-full p-1 bg-background border rounded text-sm" value={contributorInput.fn} onChange={e => setContributorInput({ ...contributorInput, fn: e.target.value })} />
                                            </div>
                                            <div className="flex-1">
                                                <span className="text-xs">Last Name</span>
                                                <input className="w-full p-1 bg-background border rounded text-sm" value={contributorInput.ln} onChange={e => setContributorInput({ ...contributorInput, ln: e.target.value })} />
                                            </div>
                                            <div className="w-32">
                                                <span className="text-xs">Role</span>
                                                <select className="w-full p-1 bg-background border rounded text-sm h-8" value={contributorInput.role} onChange={e => setContributorInput({ ...contributorInput, role: e.target.value })}>
                                                    {CONTRIBUTOR_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                                                </select>
                                            </div>
                                            <button
                                                onClick={() => {
                                                    if (!contributorInput.fn || !contributorInput.ln) return;
                                                    setEditItem({
                                                        ...editItem,
                                                        contentDetails: {
                                                            ...editItem.contentDetails,
                                                            contributors: [...(editItem.contentDetails?.contributors || []), { firstName: contributorInput.fn, lastName: contributorInput.ln, role: contributorInput.role }]
                                                        }
                                                    });
                                                    setContributorInput({ fn: "", ln: "", role: "Editor" });
                                                }}
                                                className="px-3 py-1 bg-secondary text-secondary-foreground rounded text-sm font-medium h-8"
                                            >Add</button>
                                        </div>
                                        {/* List */}
                                        <ul className="space-y-1 mt-2">
                                            {editItem.contentDetails?.contributors?.map((c, i) => (
                                                <li key={i} className="flex items-center gap-2 text-sm bg-muted/20 p-2 rounded">
                                                    <span className="font-medium">{c.firstName} {c.lastName}</span>
                                                    <span className="text-muted-foreground">({c.role})</span>
                                                    <button onClick={() => {
                                                        const n = [...(editItem.contentDetails?.contributors || [])];
                                                        n.splice(i, 1);
                                                        setEditItem({ ...editItem, contentDetails: { ...editItem.contentDetails, contributors: n } });
                                                    }} className="ml-auto text-red-500 hover:underline text-xs">Remove</button>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>

                                    {/* Description */}
                                    <div>
                                        <label className="text-sm font-bold">Description</label>
                                        <textarea className="w-full mt-1 p-2 bg-background border rounded h-40"
                                            value={editItem.description || ""}
                                            onChange={e => setEditItem({ ...editItem, description: e.target.value })}
                                            placeholder="Summarize your book..."
                                        />
                                    </div>

                                    {/* Publishing Rights */}
                                    <div className="space-y-2">
                                        <label className="text-sm font-bold">Publishing Rights</label>
                                        <div className="space-y-2">
                                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                                <input type="radio" name="rights"
                                                    checked={editItem.contentDetails?.rights === 'copyright' || !editItem.contentDetails?.rights}
                                                    onChange={() => setEditItem({ ...editItem, contentDetails: { ...editItem.contentDetails, rights: 'copyright' } })}
                                                />
                                                I own the copyright and I hold the necessary publishing rights.
                                            </label>
                                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                                <input type="radio" name="rights"
                                                    checked={editItem.contentDetails?.rights === 'public_domain'}
                                                    onChange={() => setEditItem({ ...editItem, contentDetails: { ...editItem.contentDetails, rights: 'public_domain' } })}
                                                />
                                                This is a public domain work.
                                            </label>
                                        </div>
                                    </div>

                                    {/* Audience Info */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div className="space-y-2">
                                            <label className="text-sm font-bold">Sexually Explicit Images or Title?</label>
                                            <div className="flex gap-4">
                                                <label className="flex items-center gap-2 text-sm"><input type="radio" name="adult" checked={!!editItem.contentDetails?.ageRestricted} onChange={() => setEditItem({ ...editItem, contentDetails: { ...editItem.contentDetails, ageRestricted: true } })} /> Yes</label>
                                                <label className="flex items-center gap-2 text-sm"><input type="radio" name="adult" checked={!editItem.contentDetails?.ageRestricted} onChange={() => setEditItem({ ...editItem, contentDetails: { ...editItem.contentDetails, ageRestricted: false } })} /> No</label>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-bold">Reading Age</label>
                                            <div className="flex gap-2">
                                                <select className="p-2 bg-background border rounded text-sm w-full">
                                                    <option>Select Min</option>
                                                    {AGE_RANGES.map(a => <option key={`min-${a.val}`} value={a.val}>{a.label}</option>)}
                                                </select>
                                                <select className="p-2 bg-background border rounded text-sm w-full">
                                                    <option>Select Max</option>
                                                    {AGE_RANGES.map(a => <option key={`max-${a.val}`} value={a.val}>{a.label}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Categories & Keywords */}
                                    <div className="space-y-6 pt-4 border-t">
                                        {/* Categories */}
                                        <div className="space-y-2">
                                            <label className="text-sm font-bold">Categories <span className="text-muted-foreground font-normal">(Up to 3)</span></label>
                                            <p className="text-xs text-muted-foreground">Choose specific categories to help readers find your book.</p>

                                            <div className="space-y-2">
                                                {editItem.contentDetails?.categories?.map((c, i) => (
                                                    <div key={i} className="flex items-center justify-between p-3 bg-muted/20 border rounded-md text-sm">
                                                        <span className="font-medium text-primary flex items-center gap-2"><FolderTree className="w-4 h-4" /> {c}</span>
                                                        <button onClick={() => {
                                                            const nc = [...(editItem.contentDetails?.categories || [])];
                                                            nc.splice(i, 1);
                                                            setEditItem({ ...editItem, contentDetails: { ...editItem.contentDetails, categories: nc } });
                                                        }} className="text-muted-foreground hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                                                    </div>
                                                ))}
                                                {(editItem.contentDetails?.categories?.length || 0) < 3 && (
                                                    <button onClick={() => { setCatPath([]); setCatModalOpen(true); }} className="w-full py-3 border-2 border-dashed rounded-md text-sm font-medium text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors flex items-center justify-center gap-2">
                                                        <Plus className="w-4 h-4" /> Set Categories
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {/* Keywords */}
                                        <div>
                                            <label className="text-sm font-bold">Keywords <span className="text-muted-foreground font-normal">(Up to 7)</span></label>
                                            <div className="flex gap-2 mb-2">
                                                <input
                                                    className="flex-1 p-2 bg-background border rounded"
                                                    placeholder="artificial intelligence economics..."
                                                    value={tagInput}
                                                    onChange={e => setTagInput(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && (setTagInput(""), setEditItem({ ...editItem, contentDetails: { ...editItem.contentDetails, tags: [...(editItem.contentDetails?.tags || []), tagInput].slice(0, 7) } }))}
                                                />
                                                <button className="px-4 border rounded hover:bg-muted" onClick={() => (setTagInput(""), setEditItem({ ...editItem, contentDetails: { ...editItem.contentDetails, tags: [...(editItem.contentDetails?.tags || []), tagInput].slice(0, 7) } }))}>Add</button>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {editItem.contentDetails?.tags?.map((t, i) => (
                                                    <span key={i} className="px-2 py-1 bg-secondary rounded text-xs flex items-center gap-1">
                                                        {t} <button onClick={() => {
                                                            const nt = [...(editItem.contentDetails?.tags || [])];
                                                            nt.splice(i, 1);
                                                            setEditItem({ ...editItem, contentDetails: { ...editItem.contentDetails, tags: nt } });
                                                        }} className="hover:text-red-500"><X className="w-3 h-3" /></button>
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex justify-end">
                                    <button onClick={() => canAdvanceToContent() ? setActiveStep("content") : alert("Please fill Title and Author.")} className="px-6 py-3 bg-primary text-primary-foreground rounded-md shadow font-bold flex items-center gap-2">
                                        Save and Continue <ChevronRight className="w-4 h-4" />
                                    </button>
                                </div>
                            </motion.div>
                        )}


                        {/* === STEP 2: CONTENT === */}
                        {activeStep === "content" && (
                            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
                                <div className="p-6 bg-background rounded-xl border shadow-sm space-y-8">
                                    <h3 className="text-lg font-bold">eBook Content</h3>

                                    {/* Manuscript */}
                                    <div className="bg-muted/10 p-4 rounded-xl border border-muted-foreground/20">
                                        <div className="flex justify-between items-start mb-4">
                                            <div>
                                                <h4 className="font-bold flex items-center gap-2"><Book className="w-5 h-5 text-primary" /> Manuscript</h4>
                                                <p className="text-sm text-muted-foreground">Upload your manuscript (i.e. your book's interior content). We recommend using a KPF or EPUB file.</p>
                                            </div>
                                            {editItem.bookFileUrl && <span className="text-green-600 flex items-center gap-1 text-sm font-bold bg-green-100 px-2 py-0.5 rounded"><CheckCircle className="w-3 h-3" /> Uploaded</span>}
                                        </div>

                                        <div className="flex items-center gap-4">
                                            <label className="cursor-pointer px-4 py-2 bg-secondary text-secondary-foreground rounded-md font-medium text-sm border hover:bg-secondary/80 flex items-center gap-2">
                                                {uploadStates.manuscript ? "Uploading..." : "Upload Manuscript"}
                                                <input type="file" className="hidden" accept=".kpf,.epub,.pdf" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0], "manuscript")} />
                                            </label>
                                            {editItem.bookFileUrl && <span className="text-xs font-mono text-muted-foreground truncate max-w-xs">{editItem.bookFileUrl.split('/').pop()}</span>}
                                        </div>
                                    </div>

                                    {/* DRM */}
                                    <div>
                                        <h4 className="font-bold mb-2">Digital Rights Management (DRM)</h4>
                                        <div className="space-y-2 bg-muted/20 p-4 rounded border">
                                            <p className="text-xs text-muted-foreground mb-2">DRM protects the rights of copyright holders.</p>
                                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                                <input type="radio" name="drm" checked={editItem.drmEnabled} onChange={() => setEditItem({ ...editItem, drmEnabled: true })} />
                                                Yes, apply Digital Rights Management
                                            </label>
                                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                                <input type="radio" name="drm" checked={!editItem.drmEnabled} onChange={() => setEditItem({ ...editItem, drmEnabled: false })} />
                                                No, do not apply DRM
                                            </label>
                                        </div>
                                    </div>

                                    {/* Cover */}
                                    <div className="bg-muted/10 p-4 rounded-xl border border-muted-foreground/20">
                                        <div className="flex justify-between items-start mb-4">
                                            <div>
                                                <h4 className="font-bold flex items-center gap-2"><ImageIcon className="w-5 h-5 text-primary" /> eBook Cover</h4>
                                                <p className="text-sm text-muted-foreground">Upload a cover you already have (JPG/TIFF only).</p>
                                            </div>
                                            {editItem.bookCoverUrl && <span className="text-green-600 flex items-center gap-1 text-sm font-bold bg-green-100 px-2 py-0.5 rounded"><CheckCircle className="w-3 h-3" /> Uploaded</span>}
                                        </div>
                                        <div className="flex gap-6 items-center">
                                            <label className="cursor-pointer px-4 py-2 bg-amber-500 text-white rounded-md font-medium text-sm hover:bg-amber-600 shadow flex items-center gap-2">
                                                {uploadStates.cover ? "Uploading..." : "Upload your cover file"}
                                                <input type="file" className="hidden" accept="image/*" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0], "cover")} />
                                            </label>
                                            {editItem.bookCoverUrl && (
                                                <div className="h-24 w-16 bg-muted rounded shadow-sm overflow-hidden border">
                                                    <img src={editItem.bookCoverUrl} className="h-full w-full object-cover" />
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* AI Content */}
                                    <div>
                                        <h4 className="font-bold mb-2">AI-Generated Content</h4>
                                        <div className="bg-muted/5 p-4 rounded border space-y-4">
                                            <p className="text-sm">Did you use AI tools in creating texts, images, and/or translations in your book?</p>
                                            <div className="flex gap-4">
                                                <label className="flex items-center gap-2 text-sm font-medium"><input type="radio" name="ai"
                                                    checked={editItem.contentDetails?.aiGenerated?.used}
                                                    onChange={() => setEditItem({ ...editItem, contentDetails: { ...editItem.contentDetails, aiGenerated: { used: true } } })} /> Yes</label>
                                                <label className="flex items-center gap-2 text-sm font-medium"><input type="radio" name="ai"
                                                    checked={!editItem.contentDetails?.aiGenerated?.used}
                                                    onChange={() => setEditItem({ ...editItem, contentDetails: { ...editItem.contentDetails, aiGenerated: { used: false } } })} /> No</label>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Previewer */}
                                    <div>
                                        <h4 className="font-bold mb-2">eBook Preview</h4>
                                        <div className="p-6 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 rounded-xl border border-indigo-500/20 text-center space-y-3">
                                            <div className="flex items-center justify-center gap-2 text-muted-foreground mb-2">
                                                <BookOpen className="w-5 h-5" />
                                                <p className="text-sm">Preview your book in our immersive reader</p>
                                            </div>
                                            {editItem.bookFileUrl ? (
                                                <button
                                                    onClick={() => {
                                                        // Build preview URL with all needed data
                                                        const params = new URLSearchParams({
                                                            preview: "true",
                                                            pdfUrl: editItem.bookFileUrl || "",
                                                            title: editItem.name || "Untitled",
                                                        });
                                                        if (editItem.bookCoverUrl) params.set("cover", editItem.bookCoverUrl);
                                                        if (editItem.contentDetails?.author) params.set("author", editItem.contentDetails.author);
                                                        else if (editItem.contentDetails?.authorFirstName || editItem.contentDetails?.authorLastName) {
                                                            params.set("author", `${editItem.contentDetails.authorFirstName || ""} ${editItem.contentDetails.authorLastName || ""}`.trim());
                                                        }
                                                        const url = `/reader/preview?${params.toString()}`;
                                                        window.open(url, "OsirisReader", "width=1200,height=900,menubar=no,toolbar=no,location=no,status=no");
                                                    }}
                                                    className="px-6 py-3 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg font-bold hover:shadow-lg hover:shadow-purple-500/30 transition-all flex items-center gap-2 mx-auto"
                                                >
                                                    <Eye className="w-5 h-5" /> Launch Previewer
                                                </button>
                                            ) : (
                                                <p className="text-sm text-amber-500 font-medium">Upload your manuscript first to preview</p>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex justify-between">
                                    <button onClick={() => setActiveStep("details")} className="px-6 py-3 border hover:bg-muted rounded-md font-medium text-muted-foreground flex items-center gap-2">
                                        <ChevronLeft className="w-4 h-4" /> Back
                                    </button>
                                    <button onClick={() => editItem.bookFileUrl ? setActiveStep("rights") : alert("You must upload a manuscript first.")} className="px-6 py-3 bg-primary text-primary-foreground rounded-md shadow font-bold flex items-center gap-2">
                                        Save and Continue <ChevronRight className="w-4 h-4" />
                                    </button>
                                </div>
                            </motion.div>
                        )}

                        {/* === STEP 3: RIGHTS & PRICING === */}
                        {activeStep === "rights" && (
                            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
                                <div className="p-6 bg-background rounded-xl border shadow-sm space-y-8">
                                    <h3 className="text-lg font-bold">eBook Pricing</h3>

                                    {/* ISBN */}
                                    <div className="space-y-2">
                                        <label className="font-bold text-sm">ISBN <span className="text-muted-foreground font-normal">(Optional)</span></label>
                                        <p className="text-xs text-muted-foreground">eBooks are not required to have an ISBN.</p>
                                        <input className="w-full max-w-sm p-2 bg-background border rounded"
                                            value={editItem.contentDetails?.isbn || ""}
                                            onChange={e => setEditItem({ ...editItem, contentDetails: { ...editItem.contentDetails, isbn: e.target.value } })}
                                        />
                                    </div>

                                    {/* Publisher */}
                                    <div className="space-y-2">
                                        <label className="font-bold text-sm">Publisher <span className="text-muted-foreground font-normal">(Optional)</span></label>
                                        <input className="w-full max-w-sm p-2 bg-background border rounded"
                                            value={editItem.contentDetails?.publisher || "Self-Published"}
                                            onChange={e => setEditItem({ ...editItem, contentDetails: { ...editItem.contentDetails, publisher: e.target.value } })}
                                        />
                                    </div>

                                    {/* USBN SECTION */}
                                    {/* USBN SECTION - Only visible if APPROVED */}
                                    {editItem.approvalStatus === "APPROVED" ? (
                                        <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-6 rounded-lg text-white space-y-4">
                                            <div>
                                                <div className="flex items-center justify-between mb-1">
                                                    <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Assigned USBN (PortalPay Universal Standard Book Number)</h4>
                                                    {!editItem.contentDetails?.usbnMinted && (
                                                        <button
                                                            onClick={refreshUSBN}
                                                            className="flex items-center gap-1 text-[10px] bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded transition-colors text-slate-300"
                                                            title="Regenerate USBN"
                                                        >
                                                            <RefreshCw className="w-3 h-3" /> Refresh
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="text-3xl font-mono font-bold tracking-wider text-green-400">
                                                    {editItem.contentDetails?.usbn || "Generating..."}
                                                </div>
                                                <p className="text-xs text-slate-400 mt-2">
                                                    This unique identifier is deterministically generated from your wallet address and book SKU. It requires no gas to assign.
                                                </p>
                                            </div>

                                            {/* Mint Option */}
                                            <div className="pt-4 border-t border-slate-700">
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <div className="font-bold text-sm">On-Chain Registration (OsirisUSBN)</div>
                                                        <div className="text-xs text-slate-400">Push metadata to the blockchain. Creates a permanent record on Base.</div>
                                                    </div>
                                                    {editItem.contentDetails?.usbnMinted || editItem.contentDetails?.usbnTxHash ? (
                                                        <div className="flex flex-col items-end text-right">
                                                            <span className="flex items-center gap-2 text-green-400 font-bold text-sm bg-green-400/10 px-3 py-1 rounded-full border border-green-400/20 mb-3 ml-auto">
                                                                <ShieldCheck className="w-4 h-4" /> Registered On-Chain
                                                            </span>

                                                            <div className="bg-slate-900/50 rounded-lg p-3 text-xs border border-slate-700 space-y-2 max-w-xs">
                                                                <div className="flex justify-between gap-4">
                                                                    <span className="text-slate-400">Transaction:</span>
                                                                    {editItem.contentDetails.usbnTxHash ? (
                                                                        <a
                                                                            href={`https://basescan.org/tx/${editItem.contentDetails.usbnTxHash}`}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="text-blue-400 font-mono hover:underline flex items-center gap-1"
                                                                        >
                                                                            {editItem.contentDetails.usbnTxHash.slice(0, 8)}... <ExternalLink className="w-3 h-3" />
                                                                        </a>
                                                                    ) : <span className="text-slate-500">Pending</span>}
                                                                </div>

                                                                {editItem.contentDetails.usbnTimestamp && (
                                                                    <div className="flex justify-between gap-4">
                                                                        <span className="text-slate-400">Timestamp:</span>
                                                                        <span className="text-slate-300">{new Date(editItem.contentDetails.usbnTimestamp).toLocaleString()}</span>
                                                                    </div>
                                                                )}

                                                                <div className="flex justify-between gap-4 items-center">
                                                                    <span className="text-slate-400">Est. Cost:</span>
                                                                    <div className="flex items-center gap-2">
                                                                        <div className="text-right">
                                                                            <span className="text-slate-300 block">{editItem.contentDetails.usbnCost || "Unknown"}</span>
                                                                            {editItem.contentDetails.usbnCostUsd && (
                                                                                <span className="text-[10px] text-green-400 block font-mono">{editItem.contentDetails.usbnCostUsd}</span>
                                                                            )}
                                                                        </div>
                                                                        {(!editItem.contentDetails.usbnCost || editItem.contentDetails.usbnCost === "Gas Only (Base)") && (
                                                                            <button
                                                                                onClick={reindexCost}
                                                                                disabled={reindexing}
                                                                                className="p-1 hover:bg-slate-700 rounded text-blue-400 transition-colors"
                                                                                title="Re-index Cost"
                                                                            >
                                                                                <RefreshCw className={`w-3 h-3 ${reindexing ? "animate-spin" : ""}`} />
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </div>

                                                                {/* Metadata Preview */}
                                                                <div className="pt-3 border-t border-slate-700/50 mt-3">
                                                                    <div className="text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-wider flex justify-between items-center">
                                                                        On-Chain Metadata
                                                                        <a
                                                                            href={editItem.contentDetails?.usbnMetadataUrl || (editItem.contentDetails?.usbn ? `/api/metadata/usbn/${editItem.contentDetails.usbn}` : "#")}
                                                                            target="_blank"
                                                                            className="text-amber-400 hover:underline flex items-center gap-1 normal-case"
                                                                        >
                                                                            JSON <ExternalLink className="w-2 h-2" />
                                                                        </a>
                                                                    </div>
                                                                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[10px]">
                                                                        <div>
                                                                            <span className="block text-slate-500">Title</span>
                                                                            <span className="text-slate-300 font-medium truncate block" title={editItem.name}>{editItem.name}</span>
                                                                        </div>
                                                                        <div>
                                                                            <span className="block text-slate-500">Author</span>
                                                                            <span className="text-slate-300 font-medium truncate block">{editItem.contentDetails?.author || "Unknown"}</span>
                                                                        </div>
                                                                        <div>
                                                                            <span className="block text-slate-500">Publisher</span>
                                                                            <span className="text-slate-300">{editItem.contentDetails?.publisher || "Self-Published"}</span>
                                                                        </div>
                                                                        <div>
                                                                            <span className="block text-slate-500">Pages</span>
                                                                            <span className="text-slate-300">{editItem.contentDetails?.pages || 0}</span>
                                                                        </div>
                                                                        {editItem.contentDetails?.isbn && (
                                                                            <div className="col-span-2">
                                                                                <span className="block text-slate-500">ISBN</span>
                                                                                <span className="text-slate-300 font-mono">{editItem.contentDetails.isbn}</span>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            <div className="flex items-center gap-2 mt-3 ml-auto">
                                                                <button onClick={() => persistBook(editItem).then(() => alert("Saved!"))} className="text-[10px] bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded flex items-center gap-1 shadow">
                                                                    <Save className="w-3 h-3" /> Sync DB
                                                                </button>
                                                                <button onClick={handleUSBNReset} className="text-[10px] text-slate-500 hover:text-red-400 border border-transparent hover:border-red-400/30 px-2 py-1 rounded transition-all">
                                                                    Reset / New
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={mintUSBN}
                                                            disabled={minting}
                                                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-bold text-sm shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-2 disabled:opacity-50"
                                                        >
                                                            {minting ? "Minting..." : "Mint USBN Record"} <Globe className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="p-8 bg-muted/20 border rounded-lg text-center space-y-3 flex flex-col items-center justify-center">
                                            <div className="p-3 bg-background rounded-full border shadow-sm">
                                                <Lock className="w-6 h-6 text-muted-foreground" />
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-muted-foreground">USBN Assignment Pending</h4>
                                                <p className="text-xs text-muted-foreground max-w-xs mx-auto mt-1">
                                                    Your Universal Standard Book Number (USBN) will be assigned and available for minting once your book is approved for publication.
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    <hr className="border-border/50" />

                                    {/* Pricing */}
                                    <div>
                                        <h4 className="font-bold mb-4">Pricing, Royalty, and Distribution</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                            <div>
                                                <label className="block text-sm font-bold mb-1">List Price (USD)</label>
                                                <div className="relative">
                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-muted-foreground">$</span>
                                                    <input type="number" step="0.01" className="w-full p-2 pl-6 bg-background border rounded font-bold"
                                                        value={editItem.priceUsd}
                                                        onChange={e => setEditItem({ ...editItem, priceUsd: parseFloat(e.target.value) })}
                                                    />
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-1">70% Royalty Plan selected (approx ${(editItem.priceUsd * 0.7).toFixed(2)} / sale)</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Terms */}
                                    <div className="p-4 bg-muted/20 border rounded-lg">
                                        <p className="text-xs text-muted-foreground leading-relaxed">
                                            By clicking Publish, I confirm that I agree to the <a href="#" className="underline text-primary">Terms and Conditions</a>.
                                            I understand that my book must be reviewed and can take up to 72 hours to become available for purchase.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex justify-between">
                                    <button onClick={() => setActiveStep("content")} className="px-6 py-3 border hover:bg-muted rounded-md font-medium text-muted-foreground flex items-center gap-2">
                                        <ChevronLeft className="w-4 h-4" /> Back
                                    </button>
                                    <button onClick={() => save(false)} disabled={saving} className="px-8 py-3 bg-primary text-primary-foreground rounded-md shadow-lg font-bold flex items-center gap-2 transform active:scale-95 transition-all">
                                        {saving ? "Publishing..." : "Publish eBook"}
                                    </button>
                                </div>
                            </motion.div>
                        )}

                    </div>
                </div>

                {/* === CATEGORY MODAL === */}
                <AnimatePresence>
                    {catModalOpen && (
                        <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-background rounded-xl border shadow-xl w-full max-w-2xl h-[600px] flex flex-col overflow-hidden">
                                <div className="p-4 border-b flex justify-between items-center bg-muted/10">
                                    <h3 className="font-bold flex items-center gap-2"><FolderTree className="w-5 h-5" /> Select Category</h3>
                                    <button onClick={() => setCatModalOpen(false)} className="p-1 hover:bg-muted rounded-full"><X className="w-5 h-5" /></button>
                                </div>

                                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                                    {/* Breadcrumbs */}
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                                        <button onClick={() => setCatPath([])} className="hover:text-primary hover:underline">All Categories</button>
                                        {catPath.map((c, i) => (
                                            <React.Fragment key={i}>
                                                <ChevronRight className="w-4 h-4" />
                                                <button onClick={() => setCatPath(catPath.slice(0, i + 1))} className="hover:text-primary hover:underline font-medium text-foreground">{c.name}</button>
                                            </React.Fragment>
                                        ))}
                                    </div>

                                    {/* List */}
                                    <div className="grid grid-cols-1 gap-2">
                                        {(catPath.length > 0 ? catPath[catPath.length - 1].subcategories : BOOK_CATEGORIES)?.map((c) => (
                                            <div key={c.name} className="flex items-center justify-between p-3 border rounded hover:bg-muted/50 transition-colors group">
                                                <span className="font-medium">{c.name}</span>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => handleCategorySelect(c)}
                                                        className="px-3 py-1 bg-primary/10 text-primary text-xs font-bold rounded opacity-0 group-hover:opacity-100 transition-opacity uppercase tracking-wider"
                                                    >Select</button>
                                                    {c.subcategories && (
                                                        <button
                                                            onClick={() => setCatPath([...catPath, c])}
                                                            className="p-1 hover:bg-muted rounded text-muted-foreground"
                                                        ><ChevronRight className="w-5 h-5" /></button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {catPath.length > 0 && !catPath[catPath.length - 1].subcategories && (
                                        <div className="text-center py-10 text-muted-foreground">
                                            <CheckCircle className="w-12 h-12 mx-auto mb-2 text-primary opacity-50" />
                                            <p>No further subcategories.</p>
                                            <button onClick={() => handleCategorySelect(catPath[catPath.length - 1])} className="mt-4 px-6 py-2 bg-primary text-primary-foreground rounded font-bold">Select "{catPath[catPath.length - 1].name}"</button>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Writer's Workshop</h2>
                    <p className="text-muted-foreground">Manage your titles and bookshelf</p>
                </div>
                <button
                    onClick={startNew}
                    className="px-4 py-2 bg-amber-500 text-white rounded-md flex items-center gap-2 shadow hover:bg-amber-600 transition-all font-bold text-sm"
                >
                    <Plus className="w-4 h-4" /> Create
                </button>
            </div>

            {loading ? (
                <div className="text-center py-20 text-muted-foreground">Loading bookshelf...</div>
            ) : items.length === 0 ? (
                <div className="text-center py-24 border rounded-xl border-dashed bg-muted/10 space-y-4">
                    <Book className="w-16 h-16 text-muted-foreground mx-auto opacity-20" />
                    <h3 className="text-xl font-bold text-muted-foreground">No titles yet</h3>
                    <button onClick={startNew} className="text-primary font-bold hover:underline">Create a new title</button>
                </div>
            ) : (
                <div className="space-y-6">
                    {/* Tab Navigation */}
                    <div className="flex items-center gap-6 border-b">
                        <button data-tour="writersWorkshop.viewTab.active" data-tour-action="activate" data-tour-active={viewTab === "active"}
                            onClick={() => setViewTab("active")}
                            className={`pb-3 text-sm font-bold transition-colors ${viewTab === "active" ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
                        >
                            Active Titles
                        </button>
                        <button data-tour="writersWorkshop.viewTab.archived" data-tour-action="activate" data-tour-active={viewTab === "archived"}
                            onClick={() => setViewTab("archived")}
                            className={`pb-3 text-sm font-bold transition-colors ${viewTab === "archived" ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
                        >
                            Archived
                        </button>
                        <button data-tour="writersWorkshop.viewTab.series" data-tour-action="activate" data-tour-active={viewTab === "series"}
                            onClick={() => setViewTab("series")}
                            className={`pb-3 text-sm font-bold transition-colors ${viewTab === "series" ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
                        >
                            Series Management
                        </button>
                    </div>

                    {viewTab === "series" ? (
                        <SeriesManager items={items} load={load} account={account} />
                    ) : (
                        <>
                            <h3 className="font-bold text-lg">
                                {viewTab === "active" ? `Your Bookshelf (${items.filter(i => i.approvalStatus !== "ARCHIVED").length})` : `Archived Publications (${items.filter(i => i.approvalStatus === "ARCHIVED").length})`}
                            </h3>
                            <div className="grid grid-cols-1 gap-4">
                                {items.filter(item => viewTab === "active" ? item.approvalStatus !== "ARCHIVED" : item.approvalStatus === "ARCHIVED").map(item => {
                                    const status = item.approvalStatus || "DRAFT";
                                    const statusColors: Record<string, string> = {
                                        "DRAFT": "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
                                        "PENDING": "bg-amber-500/20 text-amber-500 border-amber-500/30",
                                        "APPROVED": "bg-green-500/20 text-green-500 border-green-500/30",
                                        "REJECTED": "bg-red-500/20 text-red-400 border-red-500/30",
                                        "ARCHIVED": "bg-purple-500/20 text-purple-400 border-purple-500/30",
                                    };
                                    const cover = item.bookCoverUrl || ((item as any).images && (item as any).images[0]);
                                    const author = item.contentDetails?.author || item.attributes?.author || "Unknown Author";
                                    const subtitle = item.contentDetails?.subtitle || item.attributes?.subtitle;

                                    return (
                                        <div key={item.id} className="bg-background border rounded-lg p-4 flex gap-6 hover:shadow-md transition-shadow">
                                            <div className="h-48 w-32 bg-muted/20 backdrop-blur-md shrink-0 shadow-sm border rounded-md overflow-hidden relative flex items-center justify-center group-hover:shadow-md transition-all">
                                                {cover ? (
                                                    <img
                                                        src={cover}
                                                        className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-105"
                                                        alt={item.name}
                                                        loading="lazy"
                                                    />
                                                ) : (
                                                    <div className="flex flex-col items-center justify-center text-muted-foreground gap-2 p-2 text-center h-full w-full">
                                                        <div className="w-8 h-8 rounded-full bg-foreground/5 flex items-center justify-center">
                                                            <Book className="w-4 h-4 opacity-50" />
                                                        </div>
                                                        <span className="text-[10px] font-medium leading-tight">No Cover</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1 py-1">
                                                <div className="flex items-start justify-between gap-4">
                                                    <h4 className="font-bold text-lg text-primary hover:underline cursor-pointer" onClick={() => edit(item)}>{item.name}</h4>
                                                    <span className={`px-2 py-0.5 text-xs font-bold rounded border shrink-0 ${statusColors[status] || statusColors["DRAFT"]}`}>
                                                        {status}
                                                    </span>
                                                </div>
                                                <div className="text-sm text-muted-foreground font-medium mb-1">
                                                    {author} {subtitle ? ` - ${subtitle}` : ""}
                                                </div>
                                                <div className="text-xs text-muted-foreground space-y-1">
                                                    <p><span className="font-bold">eBook</span> • ${item.priceUsd}</p>
                                                    <p className="flex items-center gap-2">
                                                        <span>{item.contentDetails?.pages || 0} Pages</span>
                                                        <span className="opacity-50">|</span>
                                                        <span>Version {item.contentDetails?.edition || 1}</span>
                                                        <span className="opacity-50">|</span>
                                                        <span>SKU: {item.sku}</span>
                                                    </p>
                                                </div>
                                                <div className="mt-4 flex gap-4">
                                                    <button onClick={() => edit(item)} className="px-3 py-1 bg-amber-400/10 text-amber-700 border border-amber-400/50 rounded text-xs font-bold hover:bg-amber-400/20">
                                                        {status === "DRAFT" ? "Continue Editing" : "Edit Details"}
                                                    </button>
                                                    {status === "APPROVED" && (
                                                        <>
                                                            <button className="text-xs text-muted-foreground hover:text-foreground font-medium">Promote</button>
                                                            <button
                                                                onClick={() => { edit(item); setActiveStep("rights"); }}
                                                                className="px-3 py-1 bg-green-400/10 text-green-700 border border-green-400/50 rounded text-xs font-bold hover:bg-green-400/20 flex items-center gap-1"
                                                                title="Manage On-Chain Record"
                                                            >
                                                                <ShieldCheck className="w-3 h-3" /> USBN
                                                            </button>
                                                        </>
                                                    )}
                                                    {item.approvalStatus !== "APPROVED" && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); deleteItem(item.id || ""); }}
                                                            className="px-3 py-1 bg-red-400/10 text-red-600 border border-red-400/30 rounded text-xs font-bold hover:bg-red-400/20 ml-auto flex items-center gap-1"
                                                            title="Delete Book"
                                                        >
                                                            <Trash2 className="w-3 h-3" /> Delete
                                                        </button>
                                                    )}
                                                    {item.approvalStatus !== "ARCHIVED" && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); archiveItem(item); }}
                                                            className="px-3 py-1 bg-zinc-500/10 text-zinc-500 border border-zinc-500/30 rounded text-xs font-bold hover:bg-zinc-500/20 flex items-center gap-1"
                                                            title="Archive"
                                                        >
                                                            <Archive className="w-3 h-3" />
                                                        </button>
                                                    )}
                                                    {item.approvalStatus === "ARCHIVED" && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); unarchiveItem(item); }}
                                                            className="px-3 py-1 bg-purple-500/10 text-purple-500 border border-purple-500/30 rounded text-xs font-bold hover:bg-purple-500/20 flex items-center gap-1"
                                                            title="Unarchive"
                                                        >
                                                            <RefreshCw className="w-3 h-3" /> Restore
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

function SeriesManager({ items, load, account }: { items: BookInventoryItem[], load: () => void, account: any }) {
    const [editingSeries, setEditingSeries] = useState<string | null>(null);
    const [seriesDesc, setSeriesDesc] = useState("");
    const [isOrdered, setIsOrdered] = useState(false);
    const [saving, setSaving] = useState(false);

    // Derived Series List
    const seriesList = React.useMemo(() => {
        const map = new Map<string, BookInventoryItem[]>();
        items.forEach(i => {
            if (i.contentDetails?.series) {
                const s = i.contentDetails.series;
                if (!map.has(s)) map.set(s, []);
                map.get(s)?.push(i);
            }
        });
        return Array.from(map.entries()).map(([name, books]) => ({
            name,
            books: books.sort((a, b) => (a.contentDetails?.seriesOrder || 0) - (b.contentDetails?.seriesOrder || 0)),
            description: books[0].contentDetails?.seriesDescription || "",
            isOrdered: books[0].contentDetails?.isSeriesOrdered || false
        })).sort((a, b) => a.name.localeCompare(b.name));
    }, [items]);

    async function saveSeries() {
        if (!editingSeries) return;
        setSaving(true);
        try {
            // Find all books in this series
            const books = items.filter(i => i.contentDetails?.series === editingSeries);

            // Update each book
            for (const book of books) {
                const fullAuthor = `${book.contentDetails?.authorFirstName || ""} ${book.contentDetails?.authorLastName || ""}`.trim();
                const updatedDetails = {
                    ...book.contentDetails,
                    seriesDescription: seriesDesc,
                    isSeriesOrdered: isOrdered
                };

                await fetch("/api/inventory", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
                    body: JSON.stringify({
                        ...book,
                        contentDetails: updatedDetails,
                        attributes: {
                            ...book.attributes,
                            // Ensure denormalized attributes are preserved
                            author: fullAuthor
                        }
                    })
                });
            }
            await load();
            setEditingSeries(null); // Close modal
        } catch (e) {
            alert("Failed to update series metadata");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 w-full space-y-6 pb-24">
            <h3 className="font-bold text-lg">Your Series ({seriesList.length})</h3>

            {seriesList.length === 0 && (
                <div className="text-center py-12 border rounded-xl border-dashed bg-muted/10">
                    <Library className="w-12 h-12 text-muted-foreground mx-auto opacity-20 mb-2" />
                    <p className="text-muted-foreground">No series found. Add a series name to your books to see them here.</p>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {seriesList.map(s => (
                    <div key={s.name} className="border rounded-lg p-5 bg-background shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-2">
                                <Library className="w-5 h-5 text-primary" />
                                <h4 className="font-bold text-lg">{s.name}</h4>
                            </div>
                            <button
                                onClick={() => {
                                    setEditingSeries(s.name);
                                    setSeriesDesc(s.description);
                                    setIsOrdered(s.isOrdered);
                                }}
                                className="p-2 hover:bg-muted rounded text-xs border bg-background"
                            >
                                <Edit2 className="w-4 h-4" />
                            </button>
                        </div>

                        <p className="text-sm text-muted-foreground line-clamp-2 min-h-[2.5em] mb-4">
                            {s.description || "No description set for this series."}
                        </p>

                        <div className="bg-muted/20 rounded p-3 text-xs space-y-1">
                            <div className="font-bold mb-1 text-muted-foreground uppercase tracking-wider">Books in Series</div>
                            {s.books.map(b => (
                                <div key={b.id} className="flex justify-between">
                                    <span className="truncate max-w-[200px]">{b.name}</span>
                                    <span className="font-mono text-muted-foreground">Vol. {b.contentDetails?.seriesOrder || "?"}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {/* Edit Modal */}
            {editingSeries && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-background rounded-xl border shadow-xl w-full max-w-lg p-6 space-y-4">
                        <h3 className="font-bold text-xl">Manage Series: {editingSeries}</h3>

                        <div>
                            <label className="text-sm font-bold">Series Description</label>
                            <p className="text-xs text-muted-foreground mb-1">This description will aid in merchandising the series.</p>
                            <textarea
                                className="w-full p-2 border rounded bg-background h-32"
                                value={seriesDesc}
                                onChange={e => setSeriesDesc(e.target.value)}
                                placeholder="Enter a description for the entire series..."
                            />
                        </div>

                        <div>
                            <label className="flex items-center gap-2 cursor-pointer border p-3 rounded hover:bg-muted/10">
                                <input
                                    type="checkbox"
                                    checked={isOrdered}
                                    onChange={e => setIsOrdered(e.target.checked)}
                                    className="w-4 h-4"
                                />
                                <div>
                                    <div className="font-bold text-sm">Strictly Ordered</div>
                                    <div className="text-xs text-muted-foreground">Customers should read these in order (e.g. Vol 1, 2, 3).</div>
                                </div>
                            </label>
                        </div>

                        <div className="flex justify-end gap-2 pt-4">
                            <button onClick={() => setEditingSeries(null)} className="px-4 py-2 border rounded hover:bg-muted">Cancel</button>
                            <button onClick={saveSeries} disabled={saving} className="px-4 py-2 bg-primary text-primary-foreground rounded font-bold">
                                {saving ? "Saving..." : "Save Changes"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
