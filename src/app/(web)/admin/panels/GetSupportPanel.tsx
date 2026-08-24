"use client";

import React, { useRef, useEffect, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import {
    MessageSquare, Plus, Send, AlertCircle, CheckCircle2, Clock, HelpCircle,
    ChevronLeft, User, Store, Briefcase, Bug, Lightbulb, CreditCard,
    Puzzle, HelpingHand, ImagePlus, X, Link as LinkIcon, Trash2, Pencil
} from "lucide-react";
import { ImageMarkupModal, MarkupButton } from "@/components/support/ImageMarkupModal";

// Request type presets
const REQUEST_TYPES = [
    { key: "general", label: "General", icon: HelpingHand, description: "General questions or inquiries" },
    { key: "bug", label: "Bug Report", icon: Bug, description: "Report a problem or error" },
    { key: "feature", label: "Feature Request", icon: Lightbulb, description: "Suggest a new feature" },
    { key: "billing", label: "Billing", icon: CreditCard, description: "Payment or billing issues" },
    { key: "integration", label: "Integration", icon: Puzzle, description: "API or integration help" },
    { key: "other", label: "Other", icon: HelpCircle, description: "Something else" },
];

export default function GetSupportPanel({ brandKey }: { brandKey?: string }) {
    const account = useActiveAccount();
    const [tickets, setTickets] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [view, setView] = useState<'list' | 'create' | 'detail'>('list');
    const [selectedTicket, setSelectedTicket] = useState<any>(null);

    // Form state
    const [requestType, setRequestType] = useState("general");
    const [subject, setSubject] = useState("");
    const [message, setMessage] = useState("");
    const [priority, setPriority] = useState("medium");
    const [role, setRole] = useState<string>(brandKey ? "partner" : "merchant");
    const [contactEmail, setContactEmail] = useState("");
    const [hasDiscoveredEmail, setHasDiscoveredEmail] = useState(false);
    const [emailError, setEmailError] = useState("");
    const [attachments, setAttachments] = useState<string[]>([]);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState("");
    const [imageUrl, setImageUrl] = useState("");
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Markup modal
    const [markupImage, setMarkupImage] = useState<string | null>(null);
    const [markupIndex, setMarkupIndex] = useState<number>(-1);

    // Reply state
    const [reply, setReply] = useState("");
    const [replyAttachments, setReplyAttachments] = useState<string[]>([]);
    const [sending, setSending] = useState(false);
    const [replyUploading, setReplyUploading] = useState(false);
    const replyFileInputRef = useRef<HTMLInputElement>(null);

    // Chat scroll
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (brandKey || account?.address) {
            fetchTickets();
        }
    }, [brandKey, account?.address]);

    // Discover existing email for connected wallet
    useEffect(() => {
        async function fetchUserEmail() {
            if (!account?.address) return;
            try {
                const res = await fetch(`/api/notifications/settings?level=${role}`);
                const data = await res.json();
                if (data?.email && data.email.includes("@")) {
                    setContactEmail(data.email);
                    setHasDiscoveredEmail(true);
                    return;
                }
            } catch {}
            try {
                const res = await fetch(`/api/shop/lookup?wallet=${encodeURIComponent(account.address)}`);
                const data = await res.json();
                if (data?.email && data.email.includes("@")) {
                    setContactEmail(data.email);
                    setHasDiscoveredEmail(true);
                }
            } catch {}
        }
        fetchUserEmail();
    }, [account?.address, role]);

    useEffect(() => {
        if (view === 'detail') {
            scrollToBottom();
        }
    }, [view, selectedTicket?.responses]);

    useEffect(() => {
        setRole(brandKey ? "partner" : "merchant");
    }, [brandKey]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    async function fetchTickets() {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (brandKey) params.append("brandKey", brandKey);
            if (account?.address) params.append("user", account.address);

            const res = await fetch(`/api/support/tickets?${params.toString()}`);
            const data = await res.json();
            if (data.ok) {
                setTickets(data.tickets || []);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    // Get subject prefix based on request type
    const getSubjectPrefix = (type: string) => {
        const prefixes: Record<string, string> = {
            bug: "[Bug] ",
            feature: "[Feature Request] ",
            billing: "[Billing] ",
            integration: "[Integration] ",
        };
        return prefixes[type] || "";
    };

    async function createTicket() {
        if (!subject || !message) return;

        const trimmedEmail = contactEmail.trim();
        if (!trimmedEmail) {
            setEmailError("Please provide an email address so our support team can reply to you.");
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
            setEmailError("Please enter a valid email address.");
            return;
        }
        setEmailError("");

        setCreating(true);
        try {
            const fullSubject = getSubjectPrefix(requestType) + subject;
            const res = await fetch("/api/support/tickets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    brandKey: brandKey || "platform",
                    user: account?.address || "anonymous",
                    email: trimmedEmail,
                    source: role,
                    requestType,
                    subject: fullSubject,
                    message,
                    priority,
                    attachments
                })
            });
            const data = await res.json();
            if (data.ok) {
                setSubject("");
                setMessage("");
                setPriority("medium");
                setRequestType("general");
                setAttachments([]);
                setView('list');
                fetchTickets();
            }
        } catch (e) {
            console.error(e);
        } finally {
            setCreating(false);
        }
    }

    // Image upload functions
    async function uploadImages(files: File[]): Promise<string[]> {
        if (!files.length) return [];
        const fd = new FormData();
        fd.append("target", "support");
        for (const f of files.slice(0, 3)) fd.append("file", f);

        const res = await fetch("/api/public/images", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "Upload failed");
        return (data.images || []).map((img: any) => img.url).filter(Boolean);
    }

    async function handleFileUpload(files: FileList | null, isReply = false) {
        if (!files || files.length === 0) return;
        const setter = isReply ? setReplyUploading : setUploading;
        const attachSetter = isReply ? setReplyAttachments : setAttachments;
        const current = isReply ? replyAttachments : attachments;

        if (current.length >= 3) return;

        setter(true);
        setUploadError("");
        try {
            const capacity = 3 - current.length;
            const toUpload = Array.from(files).slice(0, capacity);
            const urls = await uploadImages(toUpload);
            attachSetter((prev) => [...prev, ...urls].slice(0, 3));
        } catch (e: any) {
            setUploadError(e?.message || "Upload failed");
        } finally {
            setter(false);
        }
    }

    async function handleUrlUpload(url: string, isReply = false) {
        if (!url.trim()) return;
        const setter = isReply ? setReplyUploading : setUploading;
        const attachSetter = isReply ? setReplyAttachments : setAttachments;
        const current = isReply ? replyAttachments : attachments;

        if (current.length >= 3) return;

        setter(true);
        setUploadError("");
        try {
            const fd = new FormData();
            fd.append("target", "support");
            fd.append("url", url);
            const res = await fetch("/api/public/images", { method: "POST", body: fd });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || "Upload failed");
            const urls = (data.images || []).map((img: any) => img.url).filter(Boolean);
            attachSetter((prev) => [...prev, ...urls].slice(0, 3));
            setImageUrl("");
        } catch (e: any) {
            setUploadError(e?.message || "Upload failed");
        } finally {
            setter(false);
        }
    }

    function handleDragOver(e: React.DragEvent) {
        e.preventDefault();
        setIsDragging(true);
    }

    function handleDragLeave(e: React.DragEvent) {
        e.preventDefault();
        setIsDragging(false);
    }

    async function handleDrop(e: React.DragEvent, isReply = false) {
        e.preventDefault();
        setIsDragging(false);
        const files = e.dataTransfer.files;
        if (files.length) {
            await handleFileUpload(files, isReply);
        } else {
            const url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
            if (url) await handleUrlUpload(url, isReply);
        }
    }

    function removeAttachment(index: number, isReply = false) {
        const setter = isReply ? setReplyAttachments : setAttachments;
        setter((prev) => prev.filter((_, i) => i !== index));
    }

    function openMarkup(url: string, index: number, isReply = false) {
        setMarkupImage(url);
        setMarkupIndex(isReply ? index + 1000 : index); // Use 1000+ for reply attachments
    }

    function handleMarkupSave(newUrl: string) {
        if (markupIndex >= 1000) {
            // Reply attachment
            const idx = markupIndex - 1000;
            setReplyAttachments((prev) => prev.map((u, i) => i === idx ? newUrl : u));
        } else {
            setAttachments((prev) => prev.map((u, i) => i === markupIndex ? newUrl : u));
        }
        setMarkupImage(null);
        setMarkupIndex(-1);
    }

    async function sendReply() {
        if (!reply && replyAttachments.length === 0) return;
        if (!selectedTicket) return;
        setSending(true);
        try {
            const res = await fetch(`/api/support/tickets/${selectedTicket.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    response: reply,
                    attachments: replyAttachments,
                    user: account?.address || "anonymous"
                })
            });
            const data = await res.json();
            if (data.ok) {
                setReply("");
                setReplyAttachments([]);
                const updated = data.ticket;
                setTickets(prev => prev.map(t => t.id === updated.id ? updated : t));
                setSelectedTicket(updated);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setSending(false);
        }
    }

    const statusColor = (s: string) => {
        switch (s) {
            case 'open': return 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800';
            case 'in_progress': return 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800';
            case 'resolved': return 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800';
            case 'closed': return 'text-slate-600 bg-slate-50 dark:bg-slate-900/20 border-slate-200 dark:border-slate-800';
            default: return 'text-slate-600 border-slate-200';
        }
    };

    const statusIcon = (s: string) => {
        switch (s) {
            case 'open': return <AlertCircle className="w-3 h-3" />;
            case 'in_progress': return <Clock className="w-3 h-3" />;
            case 'resolved': return <CheckCircle2 className="w-3 h-3" />;
            default: return <HelpCircle className="w-3 h-3" />;
        }
    };

    // Attachment thumbnails component
    const AttachmentGrid = ({ images, onRemove, onMarkup, isReply = false }: {
        images: string[];
        onRemove: (i: number) => void;
        onMarkup: (url: string, i: number) => void;
        isReply?: boolean;
    }) => (
        <div className="flex gap-2 flex-wrap">
            {images.map((url, i) => (
                <div key={i} className="relative w-20 h-20 rounded-lg border overflow-hidden group">
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    <button
                        onClick={() => onRemove(i)}
                        className="absolute top-1 left-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                        <X className="w-3 h-3" />
                    </button>
                    <MarkupButton onClick={() => onMarkup(url, i)} />
                </div>
            ))}
        </div>
    );

    // CREATE VIEW
    if (view === 'create') {
        return (
            <div className="h-full flex flex-col overflow-hidden">
                <div className="flex items-center gap-2 mb-4 shrink-0">
                    <button onClick={() => setView('list')} className="p-2 hover:bg-foreground/5 rounded-full transition-colors">
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                    <h2 className="text-xl font-semibold">New Support Request</h2>
                </div>

                <div className="flex-1 overflow-y-auto pr-2">
                    <div className="max-w-2xl mx-auto glass-pane border rounded-xl p-6 space-y-6">
                        {/* Request Type Selection */}
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">What can we help with?</label>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                {REQUEST_TYPES.map((type) => {
                                    const Icon = type.icon;
                                    const isSelected = requestType === type.key;
                                    return (
                                        <button
                                            key={type.key}
                                            onClick={() => setRequestType(type.key)}
                                            className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all text-center ${isSelected
                                                ? 'bg-primary/5 border-primary ring-1 ring-primary/20 shadow-md'
                                                : 'glass-pane border-foreground/10 hover:bg-foreground/5'
                                                }`}
                                        >
                                            <Icon className={`w-6 h-6 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                                            <span className={`text-[10px] uppercase font-bold tracking-wider ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}>{type.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Role Selection */}
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">I am a...</label>
                            <div className="grid grid-cols-3 gap-3">
                                {brandKey ? (
                                    <button
                                        onClick={() => setRole('partner')}
                                        className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${role === 'partner' ? 'bg-primary/5 border-primary ring-1 ring-primary/20 shadow-md' : 'glass-pane border-foreground/10 hover:bg-foreground/5'}`}
                                    >
                                        <Briefcase className={`w-5 h-5 ${role === 'partner' ? 'text-primary' : 'text-muted-foreground'}`} />
                                        <span className={`text-[10px] uppercase font-bold tracking-wider ${role === 'partner' ? 'text-primary' : 'text-muted-foreground'}`}>Partner</span>
                                    </button>
                                ) : (
                                    <>
                                        <button
                                            onClick={() => setRole('merchant')}
                                            className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${role === 'merchant' ? 'bg-primary/5 border-primary ring-1 ring-primary/20 shadow-md' : 'glass-pane border-foreground/10 hover:bg-foreground/5'}`}
                                        >
                                            <Store className={`w-5 h-5 ${role === 'merchant' ? 'text-primary' : 'text-muted-foreground'}`} />
                                            <span className={`text-[10px] uppercase font-bold tracking-wider ${role === 'merchant' ? 'text-primary' : 'text-muted-foreground'}`}>Merchant</span>
                                        </button>
                                        <button
                                            onClick={() => setRole('buyer')}
                                            className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${role === 'buyer' ? 'bg-primary/5 border-primary ring-1 ring-primary/20 shadow-md' : 'glass-pane border-foreground/10 hover:bg-foreground/5'}`}
                                        >
                                            <User className={`w-5 h-5 ${role === 'buyer' ? 'text-primary' : 'text-muted-foreground'}`} />
                                            <span className={`text-[10px] uppercase font-bold tracking-wider ${role === 'buyer' ? 'text-primary' : 'text-muted-foreground'}`}>Buyer</span>
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Subject</label>
                            <input
                                className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] focus:bg-foreground/[0.05] transition-all outline-none focus:ring-1 focus:ring-foreground/20 text-sm font-medium"
                                value={subject}
                                onChange={e => setSubject(e.target.value)}
                                placeholder="Brief summary of the issue"
                                autoFocus
                            />
                        </div>

                        {/* Contact Email */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-1.5">
                                    <span>Contact Email for Updates & Replies</span>
                                    {!hasDiscoveredEmail && !contactEmail && (
                                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-500 border border-amber-500/20">
                                            Required
                                        </span>
                                    )}
                                </label>
                                {hasDiscoveredEmail && (
                                    <span className="text-[10px] text-emerald-500 font-semibold flex items-center gap-1">
                                        <CheckCircle2 className="w-3 h-3" /> Linked to Wallet
                                    </span>
                                )}
                            </div>
                            <input
                                type="email"
                                className={`w-full h-10 px-3 rounded-lg border bg-foreground/[0.03] focus:bg-foreground/[0.05] transition-all outline-none focus:ring-1 text-sm font-medium ${
                                    emailError
                                        ? "border-red-500/50 focus:ring-red-500/30"
                                        : "border-foreground/10 focus:ring-foreground/20"
                                }`}
                                value={contactEmail}
                                onChange={(e) => {
                                    setContactEmail(e.target.value);
                                    if (emailError) setEmailError("");
                                }}
                                placeholder="name@company.com"
                            />
                            {emailError ? (
                                <p className="text-xs text-red-500 flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3 shrink-0" /> {emailError}
                                </p>
                            ) : (
                                <p className="text-[11px] text-muted-foreground">
                                    {hasDiscoveredEmail
                                        ? "Our support responses and updates will be delivered to this email address."
                                        : "Please enter your email so our team can send you updates and reply directly."}
                                </p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Priority</label>
                            <div className="flex gap-2">
                                {['low', 'medium', 'high'].map(p => (
                                    <button
                                        key={p}
                                        onClick={() => setPriority(p)}
                                        className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border transition-all ${priority === p ? 'bg-primary text-primary-foreground border-primary shadow-md' : 'glass-pane border-foreground/10 hover:bg-foreground/5'}`}
                                    >
                                        {p}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Message</label>
                            <textarea
                                className="w-full h-32 px-3 py-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] focus:bg-foreground/[0.05] transition-all outline-none focus:ring-1 focus:ring-foreground/20 resize-none text-sm leading-relaxed"
                                value={message}
                                onChange={e => setMessage(e.target.value)}
                                placeholder="Describe your issue in detail..."
                            />
                        </div>

                        {/* Image Upload */}
                        <div className="space-y-3">
                            <label className="text-sm font-medium">Attachments (optional)</label>

                            {/* Existing attachments */}
                            {attachments.length > 0 && (
                                <AttachmentGrid
                                    images={attachments}
                                    onRemove={(i) => removeAttachment(i)}
                                    onMarkup={(url, i) => openMarkup(url, i)}
                                />
                            )}

                            {attachments.length < 3 && (
                                <>
                                    {/* Drag-drop zone */}
                                    <div
                                        onDragOver={handleDragOver}
                                        onDragLeave={handleDragLeave}
                                        onDrop={(e) => handleDrop(e)}
                                        className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${isDragging
                                            ? 'border-primary bg-primary/5'
                                            : 'border-border hover:border-primary/50'
                                            }`}
                                    >
                                        <ImagePlus className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                                        <p className="text-sm text-muted-foreground mb-2">
                                            Drag & drop images here, or
                                        </p>
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/*"
                                            multiple
                                            className="hidden"
                                            onChange={(e) => handleFileUpload(e.target.files)}
                                        />
                                        <button
                                            onClick={() => fileInputRef.current?.click()}
                                            className="px-4 py-2 bg-primary/10 text-primary border border-primary/20 rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-primary/20 transition-colors"
                                            disabled={uploading}
                                        >
                                            {uploading ? "Uploading..." : "Choose Files"}
                                        </button>
                                    </div>

                                    {/* URL input */}
                                    <div className="flex gap-2">
                                        <div className="relative flex-1">
                                            <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                            <input
                                                className="w-full h-10 pl-9 pr-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] focus:bg-foreground/[0.05] transition-all outline-none focus:ring-1 focus:ring-foreground/20 text-sm"
                                                placeholder="Or paste image URL..."
                                                value={imageUrl}
                                                onChange={(e) => setImageUrl(e.target.value)}
                                            />
                                        </div>
                                        <button
                                            onClick={() => handleUrlUpload(imageUrl)}
                                            disabled={!imageUrl.trim() || uploading}
                                            className="px-4 py-2 border border-foreground/10 glass-pane rounded-lg hover:bg-foreground/5 disabled:opacity-50 transition-colors text-[10px] font-bold uppercase tracking-wider"
                                        >
                                            Add
                                        </button>
                                    </div>
                                </>
                            )}

                            {uploadError && (
                                <p className="text-sm text-red-500">{uploadError}</p>
                            )}
                            <p className="text-xs text-muted-foreground">
                                Max 3 images. Click the pen icon to annotate.
                            </p>
                        </div>

                        <div className="pt-4 flex justify-end">
                            <button
                                className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all shadow-lg shadow-primary/20"
                                onClick={createTicket}
                                disabled={creating || !subject || !message}
                            >
                                {creating ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                        Submitting...
                                    </>
                                ) : (
                                    <>
                                        Submit Request
                                        <Send className="w-4 h-4" />
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Markup Modal */}
                    {markupImage && (
                        <ImageMarkupModal
                            imageUrl={markupImage}
                            onSave={handleMarkupSave}
                            onClose={() => { setMarkupImage(null); setMarkupIndex(-1); }}
                        />
                    )}
                </div>
            </div>
        );
    }

    // DETAIL VIEW
    if (view === 'detail' && selectedTicket) {
        return (
            <div className="flex flex-col h-full min-h-[600px] glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] p-6">
                <div className="flex items-center justify-between mb-4 pb-4 border-b border-foreground/5 shrink-0">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setView('list')} className="p-2 hover:bg-foreground/5 border border-transparent hover:border-foreground/10 rounded-lg transition-colors">
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                        <div>
                            <h2 className="font-bold tracking-tight text-xl">{selectedTicket.subject}</h2>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <span className={`px-2.5 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider border flex items-center gap-1 ${statusColor(selectedTicket.status)}`}>
                                    {statusIcon(selectedTicket.status)}
                                    {selectedTicket.status.replace('_', ' ')}
                                </span>
                                <span className="text-[10px] font-mono text-muted-foreground">#{selectedTicket.id.slice(0, 8)}</span>
                                <span className="px-2 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider border border-foreground/10 bg-foreground/5 text-muted-foreground">
                                    {selectedTicket.source || 'MERCHANT'}
                                </span>
                                {selectedTicket.requestType && (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider border border-primary/20 bg-primary/10 text-primary">
                                        {selectedTicket.requestType}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto space-y-6 pr-2 mb-4">
                    {/* Original Message */}
                    <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
                            <span className="text-[10px] font-bold text-primary uppercase">ME</span>
                        </div>
                        <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">You</span>
                                <span className="text-[10px] font-mono text-muted-foreground/60">{new Date(selectedTicket.createdAt).toLocaleString()}</span>
                            </div>
                            <div className="p-4 rounded-2xl rounded-tl-none glass-pane border border-foreground/10 text-sm whitespace-pre-wrap leading-relaxed shadow-sm">
                                {selectedTicket.message}
                            </div>
                            {/* Original attachments */}
                            {selectedTicket.attachments?.length > 0 && (
                                <div className="flex gap-2 mt-2 flex-wrap">
                                    {selectedTicket.attachments.map((url: string, i: number) => (
                                        <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block w-20 h-20 rounded-xl border border-foreground/10 overflow-hidden hover:ring-1 hover:ring-primary transition-all shadow-sm">
                                            <img src={url} alt="" className="w-full h-full object-cover" />
                                        </a>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Responses */}
                    {selectedTicket.responses?.map((r: any, i: number) => (
                        <div key={i} className={`flex gap-3 ${r.isAdmin ? 'flex-row-reverse' : ''}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${r.isAdmin ? 'bg-primary text-primary-foreground border-primary' : 'bg-primary/10 text-primary border-primary/20'}`}>
                                <span className="text-[10px] font-bold uppercase tracking-wider">{r.isAdmin ? 'SP' : 'ME'}</span>
                            </div>
                            <div className={`flex-1 space-y-1 flex flex-col ${r.isAdmin ? 'items-end' : 'items-start'}`}>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">{r.isAdmin ? 'Support Agent' : 'You'}</span>
                                    <span className="text-[10px] font-mono text-muted-foreground/60">{new Date(r.createdAt).toLocaleString()}</span>
                                </div>
                                {/* Only show message bubble if there's text */}
                                {r.message && r.message.trim() && (
                                    <div className={`p-4 rounded-2xl text-sm whitespace-pre-wrap max-w-[85%] leading-relaxed shadow-sm border ${r.isAdmin
                                        ? 'bg-primary text-primary-foreground rounded-tr-none border-primary'
                                        : 'glass-pane border-foreground/10 rounded-tl-none'
                                        }`}>
                                        {r.message}
                                    </div>
                                )}
                                {/* Response attachments */}
                                {r.attachments?.length > 0 && (
                                    <div className={`flex gap-2 ${r.message?.trim() ? 'mt-2' : ''} flex-wrap ${r.isAdmin ? 'justify-end' : ''}`}>
                                        {r.attachments.map((url: string, j: number) => (
                                            <a key={j} href={url} target="_blank" rel="noopener noreferrer" className="block w-20 h-20 rounded-xl border border-foreground/10 overflow-hidden hover:ring-1 hover:ring-primary transition-all shadow-sm">
                                                <img src={url} alt="" className="w-full h-full object-cover" />
                                            </a>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </div>

                {/* Reply Area */}
                <div className="pt-4 border-t border-foreground/5 bg-foreground/[0.01] shrink-0 space-y-3">
                    {/* Reply attachments preview */}
                    {replyAttachments.length > 0 && (
                        <AttachmentGrid
                            images={replyAttachments}
                            onRemove={(i) => removeAttachment(i, true)}
                            onMarkup={(url, i) => openMarkup(url, i, true)}
                            isReply
                        />
                    )}

                    <div className="relative">
                        <textarea
                            className="w-full h-24 pl-4 pr-24 py-3 rounded-xl border border-foreground/10 bg-foreground/[0.02] focus:bg-foreground/[0.04] transition-all focus:outline-none focus:ring-1 focus:ring-foreground/20 resize-none text-sm leading-relaxed"
                            placeholder="Type your reply..."
                            value={reply}
                            onChange={e => setReply(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    sendReply();
                                }
                            }}
                        />
                        <div className="absolute right-3 bottom-3 flex items-center gap-2">
                            <input
                                ref={replyFileInputRef}
                                type="file"
                                accept="image/*"
                                multiple
                                className="hidden"
                                onChange={(e) => handleFileUpload(e.target.files, true)}
                            />
                            <button
                                onClick={() => replyFileInputRef.current?.click()}
                                disabled={replyAttachments.length >= 3 || replyUploading}
                                className="p-2 text-muted-foreground hover:bg-foreground/5 border border-transparent hover:border-foreground/10 rounded-lg transition-colors disabled:opacity-50"
                                title="Attach image"
                            >
                                <ImagePlus className="w-5 h-5" />
                            </button>
                            <button
                                className="p-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                                onClick={sendReply}
                                disabled={sending || (!reply && replyAttachments.length === 0)}
                            >
                                {sending ? (
                                    <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                ) : (
                                    <Send className="w-5 h-5" />
                                )}
                            </button>
                        </div>
                    </div>
                    <div className="flex justify-between items-center px-2 pb-2">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Press Enter to send, Shift+Enter for new line</span>
                    </div>
                </div>

                {/* Markup Modal */}
                {markupImage && (
                    <ImageMarkupModal
                        imageUrl={markupImage}
                        onSave={handleMarkupSave}
                        onClose={() => { setMarkupImage(null); setMarkupIndex(-1); }}
                    />
                )}
            </div>
        );
    }

    // LIST VIEW
    return (
        <div className="space-y-6 h-full glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold tracking-tight">Support Center</h2>
                    <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mt-1">Track your requests and get help from our team.</div>
                </div>
                <button
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-primary/90 transition-colors flex items-center gap-2"
                    onClick={() => setView('create')}
                >
                    <Plus className="w-4 h-4" />
                    New Request
                </button>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
                    <p className="text-[10px] uppercase font-bold tracking-wider">Loading your tickets...</p>
                </div>
            ) : tickets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-foreground/10 rounded-xl bg-foreground/[0.02]">
                    <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4 text-primary">
                        <MessageSquare className="w-8 h-8" />
                    </div>
                    <h3 className="text-lg font-bold tracking-tight mb-1">No tickets yet</h3>
                    <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-6 text-center max-w-sm leading-relaxed">
                        Have a question or run into an issue? Create a support ticket and we'll get back to you shortly.
                    </p>
                    <button
                        className="px-4 py-2 border border-foreground/10 glass-pane rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-foreground/5 transition-colors"
                        onClick={() => setView('create')}
                    >
                        Create your first ticket
                    </button>
                </div>
            ) : (
                <div className="grid gap-4">
                    {tickets.map(ticket => (
                        <button
                            key={ticket.id}
                            className="w-full text-left p-4 glass-pane rounded-xl border border-foreground/10 hover:bg-foreground/5 hover:border-foreground/20 transition-all group shadow-sm"
                            onClick={() => { setSelectedTicket(ticket); setView('detail'); }}
                        >
                            <div className="flex items-start justify-between mb-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <div className="font-bold tracking-tight text-foreground group-hover:text-primary transition-colors">{ticket.subject}</div>
                                    <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider border border-foreground/10 bg-foreground/5 text-muted-foreground">
                                        {ticket.source || 'MERCHANT'}
                                    </span>
                                    {ticket.requestType && (
                                        <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider border border-primary/20 bg-primary/10 text-primary">
                                            {ticket.requestType}
                                        </span>
                                    )}
                                </div>
                                <span className={`px-2.5 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider border flex items-center gap-1.5 ${statusColor(ticket.status)}`}>
                                    {statusIcon(ticket.status)}
                                    {ticket.status.replace('_', ' ')}
                                </span>
                            </div>
                            <p className="text-sm text-muted-foreground line-clamp-2 mb-4 leading-relaxed pr-10">
                                {ticket.message}
                            </p>
                            <div className="flex items-center gap-4 text-[10px] uppercase font-bold tracking-wider text-muted-foreground/80">
                                <span className="flex items-center gap-1.5">
                                    <Clock className="w-3.5 h-3.5" />
                                    {new Date(ticket.createdAt).toLocaleDateString()}
                                </span>
                                <span>#{ticket.id.slice(0, 8)}</span>
                                {ticket.attachments?.length > 0 && (
                                    <span className="flex items-center gap-1.5">
                                        <ImagePlus className="w-3.5 h-3.5" />
                                        {ticket.attachments.length} images
                                    </span>
                                )}
                                {ticket.responses?.length > 0 && (
                                    <span className="flex items-center gap-1.5 text-primary">
                                        <MessageSquare className="w-3.5 h-3.5" />
                                        {ticket.responses.length} responses
                                    </span>
                                )}
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {/* Markup Modal (for list view, shouldn't be needed but included for safety) */}
            {markupImage && (
                <ImageMarkupModal
                    imageUrl={markupImage}
                    onSave={handleMarkupSave}
                    onClose={() => { setMarkupImage(null); setMarkupIndex(-1); }}
                />
            )}
        </div>
    );
}
