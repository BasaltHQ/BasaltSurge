"use client";

import React, { useRef, useEffect, useState } from "react";
import { Search, Filter, MessageSquare, CheckCircle2, Clock, AlertCircle, Send, User, MoreHorizontal, ChevronLeft, ExternalLink, Store, Image as ImageIcon, ImagePlus, Pencil, X } from "lucide-react";
import { GalleryModal } from "@/components/support/GalleryModal";
import { ImageMarkupModal, MarkupButton } from "@/components/support/ImageMarkupModal";

export default function SupportAdminPanel() {
    const [tickets, setTickets] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedTicket, setSelectedTicket] = useState<any>(null);
    const [reply, setReply] = useState("");
    const [sending, setSending] = useState(false);
    const [filter, setFilter] = useState('all');
    const [showMenu, setShowMenu] = useState(false);
    const [showGallery, setShowGallery] = useState(false);
    const [replyAttachments, setReplyAttachments] = useState<string[]>([]);
    const [replyUploading, setReplyUploading] = useState(false);
    const [markupImage, setMarkupImage] = useState<string | null>(null);
    const [markupIndex, setMarkupIndex] = useState(-1);
    const [merchantShopSlug, setMerchantShopSlug] = useState<string | null>(null);
    const [shopSlugLoading, setShopSlugLoading] = useState(false);
    const [showFullSubject, setShowFullSubject] = useState(false);
    const replyFileInputRef = useRef<HTMLInputElement>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close menu when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setShowMenu(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    React.useEffect(() => {
        fetchTickets();
    }, []);

    React.useEffect(() => {
        if (selectedTicket) {
            scrollToBottom();
            // Fetch merchant's shop slug
            fetchMerchantShopSlug(selectedTicket.user);
        } else {
            setMerchantShopSlug(null);
        }
    }, [selectedTicket?.id]);

    async function fetchMerchantShopSlug(wallet: string) {
        if (!wallet) return;
        setShopSlugLoading(true);
        try {
            console.log("Fetching shop slug for wallet:", wallet);
            // Query the shop config by wallet to get the slug
            const res = await fetch(`/api/shop/lookup?wallet=${encodeURIComponent(wallet)}`);
            const data = await res.json();
            console.log("Shop lookup result:", data);
            if (data.ok && data.slug) {
                setMerchantShopSlug(data.slug);
            } else {
                setMerchantShopSlug(null);
            }
        } catch (e) {
            console.error("Shop lookup failed:", e);
            setMerchantShopSlug(null);
        } finally {
            setShopSlugLoading(false);
        }
    }

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    async function fetchTickets() {
        setLoading(true);
        try {
            const res = await fetch("/api/admin/support/tickets");
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

    async function sendReply() {
        if ((!reply && replyAttachments.length === 0) || !selectedTicket) return;
        setSending(true);
        try {
            const res = await fetch(`/api/admin/support/tickets/${selectedTicket.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    response: reply,
                    attachments: replyAttachments,
                    status: 'in_progress'
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

    async function handleReplyFileUpload(files: FileList | null) {
        if (!files || files.length === 0 || replyAttachments.length >= 3) return;
        setReplyUploading(true);
        try {
            const fd = new FormData();
            fd.append("target", "support");
            for (const f of Array.from(files).slice(0, 3 - replyAttachments.length)) {
                fd.append("file", f);
            }
            const res = await fetch("/api/public/images", { method: "POST", body: fd });
            const data = await res.json();
            if (res.ok && data.ok) {
                const urls = (data.images || []).map((img: any) => img.url).filter(Boolean);
                setReplyAttachments(prev => [...prev, ...urls].slice(0, 3));
            }
        } catch (e) {
            console.error(e);
        } finally {
            setReplyUploading(false);
        }
    }

    function getMerchantUrl(type: 'profile' | 'shop') {
        if (!selectedTicket) return '#';
        const wallet = selectedTicket.user;
        switch (type) {
            // Public profile at /u/{wallet}
            case 'profile': return `/u/${wallet}`;
            // Shop URL - use fetched merchantShopSlug, fallback to wallet
            case 'shop': return merchantShopSlug ? `/shop/${merchantShopSlug}` : '#';
            default: return '#';
        }
    }

    async function updateStatus(status: string) {
        if (!selectedTicket) return;
        try {
            const res = await fetch(`/api/admin/support/tickets/${selectedTicket.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status })
            });
            const data = await res.json();
            if (data.ok) {
                const updated = data.ticket;
                setTickets(prev => prev.map(t => t.id === updated.id ? updated : t));
                setSelectedTicket(updated);
            }
        } catch (e) {
            console.error(e);
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

    const filteredTickets = tickets.filter(t => {
        if (filter === 'all') return true;
        return t.status === filter;
    });

    return (
        <div className="flex flex-col md:flex-row h-full gap-6">
            {/* Sidebar List */}
            <div className={`flex flex-col glass-pane rounded-xl border overflow-hidden shrink-0 ${selectedTicket ? 'hidden md:flex w-full md:w-80' : 'w-full md:w-80'}`}>
                {/* Sidebar Header & Filters */}
                <div className="p-4 border-b border-foreground/5 bg-foreground/[0.02] space-y-4">
                    <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <input data-tour="supportAdmin.support-inbox-search"
                                className="w-full h-10 pl-9 pr-3 rounded-lg border border-foreground/10 bg-background text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                                placeholder="Search tickets..."
                            />
                        </div>
                        <button
                            onClick={fetchTickets}
                            className="p-2.5 hover:bg-foreground/5 border border-foreground/10 bg-background rounded-lg transition-colors"
                            title="Refresh"
                        >
                            <Clock className="w-4 h-4 text-muted-foreground" />
                        </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                        {['all', 'open', 'in_progress', 'resolved'].map(f => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                className={`px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider font-bold whitespace-nowrap transition-colors ${filter === f
                                    ? 'bg-primary text-primary-foreground shadow-sm'
                                    : 'bg-background border border-foreground/10 text-muted-foreground hover:bg-foreground/5'
                                    }`}
                            >
                                {f.replace('_', ' ').toUpperCase()}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Ticket List */}
                <div className="flex-1 overflow-y-auto divide-y divide-foreground/5 bg-background/50">
                    {filteredTickets.map(ticket => (
                        <button
                            key={ticket.id}
                            className={`w-full text-left p-4 transition-all relative ${selectedTicket?.id === ticket.id
                                ? 'bg-primary/5'
                                : 'hover:bg-foreground/[0.02]'
                                }`}
                            onClick={() => setSelectedTicket(ticket)}
                        >
                            {selectedTicket?.id === ticket.id && (
                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-full" />
                            )}
                            <div className="flex items-center justify-between mb-1.5 pl-2">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusColor(ticket.status)}`}>
                                    {ticket.status.toUpperCase()}
                                </span>
                                <span className="text-[10px] text-muted-foreground">{new Date(ticket.createdAt).toLocaleDateString()}</span>
                            </div>
                            <div className="font-semibold text-sm truncate mb-0.5 pl-2">{ticket.subject}</div>
                            <div className="text-xs text-muted-foreground truncate flex items-center gap-1 pl-2">
                                <User className="w-3 h-3" />
                                {ticket.user.slice(0, 6)}...{ticket.user.slice(-4)}
                            </div>
                        </button>
                    ))}
                    {filteredTickets.length === 0 && (
                        <div className="text-center py-10 text-muted-foreground text-sm">
                            No tickets found
                        </div>
                    )}
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col glass-pane rounded-xl border overflow-hidden bg-foreground/[0.01]">
                {selectedTicket ? (
                    <>
                        {/* Header */}
                        <div className="px-5 py-4 border-b border-foreground/5 bg-foreground/[0.02] flex flex-row items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    <button
                                        className="md:hidden p-1 -ml-2 hover:bg-foreground/5 rounded-full shrink-0"
                                        onClick={() => setSelectedTicket(null)}
                                    >
                                        <ChevronLeft className="w-5 h-5" />
                                    </button>
                                    <button
                                        onClick={() => setShowFullSubject(!showFullSubject)}
                                        className="text-left min-w-0"
                                    >
                                        <h2 className={`text-lg md:text-xl font-bold ${showFullSubject ? 'whitespace-normal break-words' : 'truncate'}`}>
                                            {selectedTicket.subject}
                                        </h2>
                                    </button>
                                </div>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-2 text-sm text-muted-foreground">
                                    <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-background border max-w-full">
                                        <User className="w-3 h-3 shrink-0" />
                                        <span className="font-mono truncate">
                                            {/* Show full wallet on desktop, truncated on mobile */}
                                            <span className="hidden md:inline">{selectedTicket.user}</span>
                                            <span className="md:hidden">
                                                {selectedTicket.user.slice(0, 6)}...{selectedTicket.user.slice(-4)}
                                            </span>
                                        </span>
                                    </span>
                                    <span className="hidden sm:inline">•</span>
                                    <span>{selectedTicket.brandKey}</span>
                                    <span className="hidden sm:inline">•</span>
                                    <span>{new Date(selectedTicket.createdAt).toLocaleString()}</span>
                                    {selectedTicket.jiraIssueKey && (
                                        <a
                                            href={selectedTicket.jiraIssueUrl || `https://ledger1ai.atlassian.net/browse/${selectedTicket.jiraIssueKey}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 text-xs font-medium hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                                            title="Open in Jira"
                                        >
                                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.94 4.34 4.34 4.35V2.84a.84.84 0 0 0-.84-.84H11.53zM6.77 6.8a4.36 4.36 0 0 0 4.34 4.34h1.8v1.72a4.36 4.36 0 0 0 4.34 4.34V7.63a.84.84 0 0 0-.83-.83H6.77zM2 11.6a4.35 4.35 0 0 0 4.34 4.34h1.8v1.72A4.35 4.35 0 0 0 12.48 22v-9.57a.84.84 0 0 0-.84-.84H2z" /></svg>
                                            {selectedTicket.jiraIssueKey}
                                            <ExternalLink className="w-2.5 h-2.5" />
                                        </a>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <select
                                    className="h-9 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm font-medium focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                                    value={selectedTicket.status}
                                    onChange={(e) => updateStatus(e.target.value)}
                                >
                                    <option className="bg-background text-foreground" value="open">Open</option>
                                    <option className="bg-background text-foreground" value="in_progress">In Progress</option>
                                    <option className="bg-background text-foreground" value="resolved">Resolved</option>
                                    <option className="bg-background text-foreground" value="closed">Closed</option>
                                </select>
                                <div className="relative" ref={menuRef}>
                                    <button
                                        className="p-2 hover:bg-foreground/5 border border-transparent hover:border-foreground/10 rounded-lg transition-colors"
                                        onClick={() => setShowMenu(!showMenu)}
                                    >
                                        <MoreHorizontal className="w-5 h-5 text-muted-foreground" />
                                    </button>
                                    {showMenu && (
                                        <div className="absolute right-0 top-full mt-1 w-56 glass-pane border rounded-xl shadow-2xl z-50 py-2 animate-in fade-in slide-in-from-top-2">
                                            <a
                                                href={getMerchantUrl('profile')}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-sm"
                                                onClick={() => setShowMenu(false)}
                                            >
                                                <User className="w-4 h-4 text-muted-foreground" />
                                                View Merchant Profile
                                                <ExternalLink className="w-3 h-3 ml-auto text-muted-foreground" />
                                            </a>
                                            <a
                                                href={merchantShopSlug ? `/shop/${merchantShopSlug}` : '#'}
                                                target={merchantShopSlug ? "_blank" : undefined}
                                                rel="noopener noreferrer"
                                                className={`flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-sm ${(!merchantShopSlug && !shopSlugLoading) ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                onClick={(e) => {
                                                    if (!merchantShopSlug) e.preventDefault();
                                                    setShowMenu(false);
                                                }}
                                            >
                                                <Store className="w-4 h-4 text-muted-foreground" />
                                                {shopSlugLoading ? 'Loading Shop...' : 'View Shop'}
                                                {merchantShopSlug && <ExternalLink className="w-3 h-3 ml-auto text-muted-foreground" />}
                                            </a>
                                            <button
                                                onClick={() => { setShowGallery(true); setShowMenu(false); }}
                                                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-sm text-left"
                                            >
                                                <ImageIcon className="w-4 h-4 text-muted-foreground" />
                                                View Gallery
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Chat Area */}
                        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-background/50 relative">
                            {/* Original Request */}
                            <div className="flex gap-4">
                                <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center shrink-0">
                                    <User className="w-5 h-5 text-muted-foreground" />
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-semibold text-sm">User</span>
                                        <span className="text-xs text-muted-foreground">{new Date(selectedTicket.createdAt).toLocaleString()}</span>
                                    </div>
                                    <div className="p-4 rounded-2xl rounded-tl-none glass-pane border border-foreground/10 shadow-sm text-sm whitespace-pre-wrap leading-relaxed">
                                        {selectedTicket.message}
                                    </div>
                                    {/* Original attachments */}
                                    {selectedTicket.attachments?.length > 0 && (
                                        <div className="flex gap-2 mt-2 flex-wrap">
                                            {selectedTicket.attachments.map((url: string, j: number) => (
                                                <a key={j} href={url} target="_blank" rel="noopener noreferrer" className="block w-20 h-20 rounded-lg border overflow-hidden hover:ring-2 ring-primary transition-all">
                                                    <img src={url} alt="" className="w-full h-full object-cover" />
                                                </a>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Responses */}
                            {selectedTicket.responses?.map((r: any, i: number) => (
                                <div key={i} className={`flex gap-4 ${r.isAdmin ? 'flex-row-reverse' : ''}`}>
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${r.isAdmin ? 'bg-primary text-primary-foreground' : 'bg-slate-200 dark:bg-slate-800'}`}>
                                        <span className="font-bold text-xs">{r.isAdmin ? 'SP' : 'US'}</span>
                                    </div>
                                    <div className={`flex-1 flex flex-col ${r.isAdmin ? 'items-end' : 'items-start'}`}>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="font-semibold text-sm">{r.isAdmin ? 'Support Agent' : 'User'}</span>
                                            <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span>
                                        </div>
                                        {/* Only show message bubble if there's text */}
                                        {r.message && r.message.trim() && (
                                            <div className={`p-4 rounded-2xl text-sm whitespace-pre-wrap shadow-sm max-w-[85%] ${r.isAdmin
                                                ? 'bg-primary text-primary-foreground rounded-tr-none'
                                                : 'bg-background border rounded-tl-none'
                                                }`}>
                                                {r.message}
                                            </div>
                                        )}
                                        {/* Response attachments */}
                                        {r.attachments?.length > 0 && (
                                            <div className={`flex gap-2 ${r.message?.trim() ? 'mt-2' : ''} flex-wrap ${r.isAdmin ? 'justify-end' : ''}`}>
                                                {r.attachments.map((url: string, j: number) => (
                                                    <a key={j} href={url} target="_blank" rel="noopener noreferrer" className="block w-20 h-20 rounded-xl border-2 border-white/20 overflow-hidden hover:ring-2 ring-primary transition-all shadow-lg">
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
                        <div className="px-5 py-4 border-t border-foreground/5 bg-foreground/[0.01] space-y-3">
                            {/* Reply attachments preview */}
                            {replyAttachments.length > 0 && (
                                <div className="flex gap-2 flex-wrap">
                                    {replyAttachments.map((url, i) => (
                                        <div key={i} className="relative w-16 h-16 rounded-lg border overflow-hidden group">
                                            <img src={url} alt="" className="w-full h-full object-cover" />
                                            <button
                                                onClick={() => setReplyAttachments(prev => prev.filter((_, j) => j !== i))}
                                                className="absolute top-0.5 left-0.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                                            >
                                                ×
                                            </button>
                                            <MarkupButton onClick={() => { setMarkupImage(url); setMarkupIndex(i); }} />
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="relative">
                                <textarea
                                    className="w-full h-24 pl-4 pr-24 py-3 rounded-xl border border-foreground/10 bg-foreground/[0.02] focus:bg-foreground/[0.04] transition-all focus:outline-none focus:ring-1 focus:ring-foreground/20 resize-none text-sm"
                                    placeholder="Type your response..."
                                    value={reply}
                                    onChange={e => setReply(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            sendReply();
                                        }
                                    }}
                                />
                                <div className="absolute right-3 bottom-3 flex items-center gap-1">
                                    <input
                                        ref={replyFileInputRef}
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        className="hidden"
                                        onChange={(e) => handleReplyFileUpload(e.target.files)}
                                    />
                                    <button
                                        onClick={() => replyFileInputRef.current?.click()}
                                        disabled={replyAttachments.length >= 3 || replyUploading}
                                        className="p-2 hover:bg-muted rounded-lg transition-colors disabled:opacity-50"
                                        title="Attach image"
                                    >
                                        <ImagePlus className="w-4 h-4" />
                                    </button>
                                    <button
                                        className="p-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-all shadow-lg shadow-primary/20"
                                        onClick={sendReply}
                                        disabled={sending || (!reply && replyAttachments.length === 0)}
                                    >
                                        {sending ? (
                                            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                        ) : (
                                            <Send className="w-4 h-4" />
                                        )}
                                    </button>
                                </div>
                            </div>
                            <div className="flex justify-between items-center px-1">
                                <span className="text-xs text-muted-foreground">Press Enter to send, Shift+Enter for new line</span>
                            </div>
                        </div>
                    </>
                ) : (
                    <div data-tour="supportAdmin.support-conversation" className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-foreground/[0.01]">
                        <div className="w-20 h-20 rounded-2xl glass-pane border border-foreground/10 flex items-center justify-center mb-6 shadow-xl relative overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-50" />
                            <MessageSquare className="w-8 h-8 text-muted-foreground relative z-10" />
                        </div>
                        <h3 className="text-xl font-bold tracking-tight mb-2">Support Inbox</h3>
                        <p className="text-sm text-muted-foreground/80 max-w-sm">
                            Select a ticket from the sidebar to view details, add internal notes, and communicate directly with the merchant.
                        </p>
                    </div>
                )}
            </div>

            {/* Gallery Modal */}
            {showGallery && selectedTicket && (
                <GalleryModal
                    wallet={selectedTicket.user}
                    onClose={() => setShowGallery(false)}
                />
            )}

            {/* Markup Modal */}
            {markupImage && (
                <ImageMarkupModal
                    imageUrl={markupImage}
                    onSave={(newUrl) => {
                        if (markupIndex >= 0) {
                            setReplyAttachments(prev => prev.map((url, i) => i === markupIndex ? newUrl : url));
                        }
                        setMarkupImage(null);
                        setMarkupIndex(-1);
                    }}
                    onClose={() => { setMarkupImage(null); setMarkupIndex(-1); }}
                />
            )}
        </div>
    );
}
