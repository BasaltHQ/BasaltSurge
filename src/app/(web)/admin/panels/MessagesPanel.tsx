"use client";

import React from "react";
import { useActiveAccount } from "thirdweb/react";
import { DefaultAvatar } from "@/components/default-avatar";
import {
  ImagePlus, X, Link as LinkIcon, MoreHorizontal, ExternalLink, Store, Image as ImageIcon,
  Search, Filter, MessageSquare, CheckCircle2, Clock, AlertCircle, Send, User, ChevronLeft,
  Receipt, CreditCard, Hash, Mail, Copy, Check, DollarSign, FileText, ShieldCheck
} from "lucide-react";
import { GalleryModal } from "@/components/support/GalleryModal";
import { ImageMarkupModal, MarkupButton } from "@/components/support/ImageMarkupModal";

/**
 * Messages Panel (Enhanced UI/UX)
 * Layout:
 *   - Left column: Conversation list with search/filter, unread badges, last activity
 *   - Right column: Conversation header, threaded bubbles w/ avatars & timestamps, composer
 * API:
 *   - GET /api/messages/conversations
 *   - GET /api/messages/conversations/:id/messages
 *   - POST /api/messages/conversations/:id/messages
 *
 * Notes:
 *   - Polling updates list and active thread
 *   - Unread badge computed from latest message readBy
 *   - Composer supports Ctrl/Cmd+Enter to send, emoji insert, basic attachment stub
 *   - Auto-scrolls to latest message on updates
 *   - Accessible roles & labels
 */

type Conversation = {
  id: string;
  participants: string[];
  subject?: { type?: string; id?: string };
  lastMessageAt?: number;
  createdAt?: number;
};

type Message = {
  id: string;
  conversationId: string;
  senderWallet: string;
  body: string;
  attachments?: string[];
  createdAt: number;
  readBy?: string[];
};

function truncateWallet(w: string) {
  const x = String(w || "");
  return /^0x[a-f0-9]{40}$/i.test(x) ? `${x.slice(0, 6)}…${x.slice(-4)}` : x;
}

function formatRelativeTime(ts?: number) {
  const t = Number(ts || 0);
  if (!t) return "";
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(t).toLocaleDateString();
}

function subjectLabelFrom(c: Conversation) {
  const s = c.subject;
  if (s?.type === "shop") return `Shop • ${s.id || ""}`;
  if (s?.type === "merchant") return `Merchant • ${truncateWallet(s.id || "")}`;
  if (s?.type === "order") return `Order • ${s.id || ""}`;
  if (s?.type === "checkout") return `Checkout • ${s.id || ""}`;
  return "General";
}

function cx(...args: Array<string | false | null | undefined>) {
  return args.filter(Boolean).join(" ");
}

export default function MessagesPanel({ role, overrideWallet }: { role?: 'buyer' | 'merchant'; overrideWallet?: string }) {
  const account = useActiveAccount();
  const me = (overrideWallet || String((account as any)?.address || "")).toLowerCase();
  
  // Conversations state... (preserving structure)


  // Conversations state
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [loadingConvos, setLoadingConvos] = React.useState(false);
  const [convoError, setConvoError] = React.useState("");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [filterMode, setFilterMode] = React.useState<"all" | "unread">("all");
  const [unread, setUnread] = React.useState<Record<string, boolean>>({});

  // Active conversation/thread state
  const [activeConvoId, setActiveConvoId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [loadingMsgs, setLoadingMsgs] = React.useState(false);
  const [msgError, setMsgError] = React.useState("");
  const [composerBody, setComposerBody] = React.useState<string>("");
  const [showEmoji, setShowEmoji] = React.useState(false);

  const threadScrollRef = React.useRef<HTMLDivElement | null>(null);
  const composerRef = React.useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Attachment state
  const [attachments, setAttachments] = React.useState<string[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState("");
  const [imageUrl, setImageUrl] = React.useState("");
  const [isDragging, setIsDragging] = React.useState(false);
  // Markup/Gallery state
  const [markupImage, setMarkupImage] = React.useState<string | null>(null);
  const [markupIndex, setMarkupIndex] = React.useState<number>(-1);
  const [showGallery, setShowGallery] = React.useState(false);
  const [showMenu, setShowMenu] = React.useState(false);
  const [merchantShopSlug, setMerchantShopSlug] = React.useState<string | null>(null);
  const [shopSlugLoading, setShopSlugLoading] = React.useState(false);
  const [orderTxHash, setOrderTxHash] = React.useState<string | null>(null);

  // Receipt & Transaction Details state
  const [receiptDetails, setReceiptDetails] = React.useState<any>(null);
  const [receiptLoading, setReceiptLoading] = React.useState(false);
  const [showReceiptModal, setShowReceiptModal] = React.useState(false);
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  const copyToClipboard = React.useCallback((text: string, key: string) => {
    try {
      navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {}
  }, []);

  // User PFP cache and helpers (fetches profile by wallet and caches pfpUrl/displayName)
  const [pfp, setPfp] = React.useState<Record<string, { pfpUrl?: string; displayName?: string }>>({});
  const pendingPfp = React.useRef<Set<string>>(new Set());

  const ensurePfp = React.useCallback(
    async (wallet: string) => {
      const w = String(wallet || "").toLowerCase();
      if (!/^0x[a-f0-9]{40}$/i.test(w)) return;
      if (pfp[w]) return;
      if (pendingPfp.current.has(w)) return;
      pendingPfp.current.add(w);
      try {
        const r = await fetch(`/api/users/profile?wallet=${encodeURIComponent(w)}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        const prof = j?.profile || {};
        setPfp((prev) => {
          if (prev[w]) return prev;
          return {
            ...prev,
            [w]: {
              pfpUrl: typeof prof.pfpUrl === "string" ? prof.pfpUrl : "",
              displayName: typeof prof.displayName === "string" ? prof.displayName : "",
            },
          };
        });
      } catch {
        // ignore
      } finally {
        pendingPfp.current.delete(w);
      }
    },
    [pfp]
  );

  function PfpCircle({
    wallet,
    size = 24,
    className = "",
  }: {
    wallet: string;
    size?: number;
    className?: string;
  }) {
    const w = String(wallet || "").toLowerCase();
    const info = pfp[w];
    const name = info?.displayName || truncateWallet(wallet);
    const img = info?.pfpUrl;
    return (
      <span
        className={`rounded-full overflow-hidden bg-foreground/10 flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
        aria-label={`Profile picture of ${name}`}
        title={name}
      >
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt={name} className="w-full h-full object-cover" />
        ) : (
          <DefaultAvatar seed={w} size={size} className="w-full h-full rounded-full" />
        )}
      </span>
    );
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

  async function handleFileUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (attachments.length >= 3) return;

    setUploading(true);
    setUploadError("");
    try {
      const capacity = 3 - attachments.length;
      const toUpload = Array.from(files).slice(0, capacity);
      const urls = await uploadImages(toUpload);
      setAttachments((prev) => [...prev, ...urls].slice(0, 3));
    } catch (e: any) {
      setUploadError(e?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleUrlUpload(url: string) {
    if (!url.trim()) return;
    if (attachments.length >= 3) return;

    setUploading(true);
    setUploadError("");
    try {
      const fd = new FormData();
      fd.append("target", "support");
      fd.append("url", url);
      const res = await fetch("/api/public/images", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Upload failed");
      const urls = (data.images || []).map((img: any) => img.url).filter(Boolean);
      setAttachments((prev) => [...prev, ...urls].slice(0, 3));
      setImageUrl("");
    } catch (e: any) {
      setUploadError(e?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  function openMarkup(url: string, index: number) {
    setMarkupImage(url);
    setMarkupIndex(index);
  }

  function handleMarkupSave(newUrl: string) {
    setAttachments((prev) => prev.map((u, i) => i === markupIndex ? newUrl : u));
    setMarkupImage(null);
    setMarkupIndex(-1);
  }

  async function fetchMerchantShopSlug(wallet: string) {
    if (!wallet) return;
    setShopSlugLoading(true);
    try {
      const res = await fetch(`/api/shop/lookup?wallet=${encodeURIComponent(wallet)}`);
      const data = await res.json();
      if (data.ok && data.slug) {
        setMerchantShopSlug(data.slug);
      } else {
        setMerchantShopSlug(null);
      }
    } catch (e) {
      setMerchantShopSlug(null);
    } finally {
      setShopSlugLoading(false);
    }
  }

  function getMerchantUrl(type: 'profile' | 'shop', wallet: string) {
    switch (type) {
      case 'profile': return `/u/${wallet}`;
      case 'shop': return merchantShopSlug ? `/shop/${merchantShopSlug}` : '#';
      default: return '#';
    }
  }

  // Attachment thumbnails component
  const AttachmentGrid = ({ images, onRemove, onMarkup }: {
    images: string[];
    onRemove: (i: number) => void;
    onMarkup: (url: string, i: number) => void;
  }) => (
    <div className="flex gap-2 flex-wrap">
      {images.map((url, i) => (
        <div key={i} className="relative w-16 h-16 rounded-lg border overflow-hidden group">
          <img src={url} alt="" className="w-full h-full object-cover" />
          <button
            onClick={() => onRemove(i)}
            className="absolute top-0.5 left-0.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs"
          >
            <X className="w-3 h-3" />
          </button>
          <MarkupButton onClick={() => onMarkup(url, i)} />
        </div>
      ))}
    </div>
  );

  // Compute unread indicators by checking the latest message for each conversation
  async function computeUnread(items: Conversation[]) {
    try {
      if (!Array.isArray(items) || items.length === 0) {
        setUnread({});
        return;
      }
      const entries = await Promise.all(
        items.map(async (c) => {
          try {
            const r = await fetch(
              `/api/messages/conversations/${encodeURIComponent(c.id)}/messages?page=0&limit=1`,
              { cache: "no-store" }
            );
            const j = await r.json().catch(() => ({}));
            if (!r.ok || j?.ok !== true) {
              return [c.id, false] as const;
            }
            const latest = (Array.isArray(j?.items) ? j.items[j.items.length - 1] : null) as any;
            const isUnread =
              !!latest &&
              String(latest.senderWallet || "").toLowerCase() !== me &&
              !(
                Array.isArray(latest.readBy) &&
                latest.readBy
                  .map((x: string) => String(x || "").toLowerCase())
                  .includes(me)
              );
            return [c.id, !!isUnread] as const;
          } catch {
            return [c.id, false] as const;
          }
        })
      );
      const map = Object.fromEntries(entries as any);
      setUnread((prev) => ({ ...prev, ...map }));
    } catch {
      // noop
    }
  }

  async function loadConversations() {
    try {
      setLoadingConvos(true);
      setConvoError("");
      const r = await fetch("/api/messages/conversations", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok !== true) {
        setConvoError(j?.error || "Failed to load conversations");
        setConversations([]);
        return;
      }
      let items: Conversation[] = Array.isArray(j?.items) ? j.items : [];
      // Sort by lastMessageAt desc then createdAt desc
      items = items
        .slice()
        .sort(
          (a, b) =>
            Number(b.lastMessageAt || 0) - Number(a.lastMessageAt || 0) ||
            Number(b.createdAt || 0) - Number(a.createdAt || 0)
        );
      setConversations(items);
      if (items.length && !activeConvoId) {
        setActiveConvoId(items[0].id);
      }
      await computeUnread(items);
    } catch (e: any) {
      setConvoError(e?.message || "Failed to load conversations");
      setConversations([]);
    } finally {
      setLoadingConvos(false);
    }
  }

  async function loadMessages(convoId: string) {
    try {
      setLoadingMsgs(true);
      setMsgError("");
      const r = await fetch(
        `/api/messages/conversations/${encodeURIComponent(convoId)}/messages?page=0&limit=100`,
        { cache: "no-store" }
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok !== true) {
        setMsgError(j?.error || "Failed to load messages");
        setMessages([]);
        return;
      }
      const items: Message[] = Array.isArray(j?.items) ? j.items : [];
      setMessages(items);
      // Update unread indicator for this conversation based on the latest message
      try {
        const latest = (Array.isArray(j?.items) ? j.items[j.items.length - 1] : null) as any;
        const isUnread =
          !!latest &&
          String(latest.senderWallet || "").toLowerCase() !== me &&
          !(
            Array.isArray(latest.readBy) &&
            latest.readBy.map((x: string) => String(x || "").toLowerCase()).includes(me)
          );
        setUnread((prev) => ({ ...prev, [convoId]: isUnread ? true : false }));
      } catch { }
    } catch (e: any) {
      setMsgError(e?.message || "Failed to load messages");
      setMessages([]);
    } finally {
      setLoadingMsgs(false);
    }
  }

  const activeConvo = React.useMemo(
    () => conversations.find((c) => c.id === activeConvoId),
    [conversations, activeConvoId]
  );

  // Fetch merchant shop slug, order details, or receipt details based on subject
  React.useEffect(() => {
    setMerchantShopSlug(null);
    setOrderTxHash(null);
    setReceiptDetails(null);
    if (!activeConvo) return;

    // 1. If subject is shop, or we need shop slug for merchant
    const other = activeConvo.participants.find(p => p.toLowerCase() !== me) || activeConvo.participants[0];
    if (other) fetchMerchantShopSlug(other);

    // 2. If subject is order or checkout, fetch full receipt details
    const subjectType = activeConvo.subject?.type;
    const subjectId = activeConvo.subject?.id;

    if ((subjectType === 'order' || subjectType === 'checkout') && subjectId) {
      setReceiptLoading(true);
      fetch(`/api/receipts/${encodeURIComponent(subjectId)}`, { cache: "no-store" })
        .then(r => r.json())
        .then(data => {
          const item = data?.item || data?.receipt;
          if (item) {
            setReceiptDetails(item);
            const tx = item.transactionHash || item.txHash;
            if (tx) {
              setOrderTxHash(tx);
            }
          }
        })
        .catch(() => { })
        .finally(() => setReceiptLoading(false));
    }
  }, [activeConvo, me]);

  async function sendMessage() {
    try {
      const cid = String(activeConvoId || "");
      if (!cid || (!composerBody.trim() && attachments.length === 0)) return;
      setMsgError("");
      setShowEmoji(false);

      // Optimistic append
      const tempId = `message:local:${typeof crypto !== "undefined" && (crypto as any).randomUUID
        ? (crypto as any).randomUUID()
        : Math.random().toString(36).slice(2)
        }`;
      const tempMsg: Message = {
        id: tempId,
        conversationId: cid,
        senderWallet: me,
        body: composerBody,
        attachments: [...attachments],
        createdAt: Date.now(),
        readBy: [me],
      };
      setMessages((prev) => [...prev, tempMsg]);

      const r = await fetch(`/api/messages/conversations/${encodeURIComponent(cid)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ body: composerBody, attachments }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok !== true) {
        // Remove optimistic message on failure
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setMsgError(j?.error || "Failed to send message");
        return;
      }
      // Clear composer and reconcile with server
      setComposerBody("");
      setAttachments([]);
      // Focus back to composer for quick follow-ups
      try {
        composerRef.current?.focus();
      } catch { }
      await loadMessages(cid);
      // Refresh conversations to update ordering and unread badges
      await loadConversations();
    } catch (e: any) {
      // Remove optimistic message on error
      try {
        const cid = String(activeConvoId || "");
        setMessages((prev) =>
          prev.filter(
            (m) => m.conversationId !== cid || !String(m.id).startsWith("message:local:")
          )
        );
      } catch { }
      setMsgError(e?.message || "Failed to send message");
    }
  }

  // Initial load
  React.useEffect(() => {
    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load messages when active convo changes
  React.useEffect(() => {
    if (activeConvoId) loadMessages(activeConvoId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvoId]);

  // Polling
  React.useEffect(() => {
    const POLL_MS = 10000; // 10s
    const h = setInterval(() => {
      loadConversations();
      if (activeConvoId) loadMessages(activeConvoId);
    }, POLL_MS);
    return () => clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvoId]);

  // Refresh on tab visible
  React.useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        loadConversations();
        if (activeConvoId) loadMessages(activeConvoId);
      }
    };
    try {
      document.addEventListener("visibilitychange", onVis);
    } catch { }
    return () => {
      try {
        document.removeEventListener("visibilitychange", onVis);
      } catch { }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvoId]);





  // Auto-scroll thread to bottom on messages change
  React.useEffect(() => {
    const el = threadScrollRef.current;
    if (!el) return;
    try {
      el.scrollTop = el.scrollHeight;
    } catch { }
  }, [messages.length, activeConvoId]); // Added activeConvoId to ensure scroll on switch

  // Derived filtered conversations
  const filteredConversations = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const items = conversations.filter((c) => {
      // Role-based filtering based on the subject (who the message is addressed to)
      // - subject.type='merchant' with subject.id=<wallet> means someone contacted that merchant
      // - subject.type='order' with subject.id=<receiptId> means the message is about an order
      const subjectType = c.subject?.type;
      const subjectId = String(c.subject?.id || '').toLowerCase();

      if (role === 'buyer') {
        // As a buyer/shopper, I see conversations where I reached out to a merchant
        // For 'merchant' type: subject.id should NOT be me (I'm contacting someone else)
        // For 'order' type: these are order inquiries I made to a merchant
        if (subjectType === 'merchant') {
          if (subjectId === me) return false; // This is addressed TO me, not FROM me
        } else if (subjectType === 'order') {
          // Order messages are always buyer-relevant (I placed the order)
          // For now, show order messages in buyer view
        } else {
          // For other types (shop, general, undefined), show in buyer view as fallback
          // These are likely legacy messages or general inquiries
          return true;
        }
      } else if (role === 'merchant') {
        // As a merchant, I see conversations where customers contacted ME directly or via checkout/order
        const parts = (Array.isArray(c.participants) ? c.participants : []).map((p) => String(p || "").toLowerCase());
        if (subjectType === 'merchant') {
          if (subjectId !== me && !parts.includes(me)) return false;
        } else if (subjectType === 'checkout' || subjectType === 'order') {
          if (!parts.includes(me) && subjectId !== me) return false;
        } else {
          if (!parts.includes(me)) return false;
        }
      }

      if (filterMode === "unread" && !unread[c.id]) return false;
      if (!q) return true;
      const s = subjectLabelFrom(c).toLowerCase();
      const parts = (Array.isArray(c.participants) ? c.participants : []).map((p) =>
        truncateWallet(p).toLowerCase()
      );
      return s.includes(q) || parts.some((p) => p.includes(q));
    });
    return items;
  }, [conversations, searchQuery, filterMode, unread, role]);

  // Ensure active conversation is valid for the current filter/role
  React.useEffect(() => {
    if (loadingConvos) return;

    // If we have an active ID but it's not in the filtered list
    const isActiveInFiltered = filteredConversations.some(c => c.id === activeConvoId);

    if (activeConvoId && !isActiveInFiltered) {
      // If we have filtered items, select the first one
      if (filteredConversations.length > 0) {
        setActiveConvoId(filteredConversations[0].id);
      } else {
        // Otherwise clear selection
        setActiveConvoId(null);
      }
    } else if (!activeConvoId && filteredConversations.length > 0) {
      // If nothing selected but we have items, select first
      setActiveConvoId(filteredConversations[0].id);
    }
  }, [activeConvoId, filteredConversations, loadingConvos]);



  // Participants normalized
  const participants: string[] = React.useMemo(() => {
    return Array.isArray(activeConvo?.participants) ? activeConvo!.participants : [];
  }, [activeConvo]);

  // Prefetch PFPs for participants and message senders and current user
  React.useEffect(() => {
    if (me) ensurePfp(me);
  }, [me, ensurePfp]);

  React.useEffect(() => {
    try {
      (participants || []).slice(0, 10).forEach((w) => ensurePfp(w));
    } catch { }
  }, [participants, ensurePfp]);

  React.useEffect(() => {
    try {
      const wallets = new Set<string>();
      (messages || []).forEach((m) => wallets.add(String(m.senderWallet || "").toLowerCase()));
      wallets.forEach((w) => ensurePfp(w));
    } catch { }
  }, [messages, ensurePfp]);

  // Simple read receipt: seen if any other participant has read
  function getReadReceiptLabel(m: Message) {
    const others = participants
      .map((x) => String(x || "").toLowerCase())
      .filter((x) => x && x !== me);
    const readSet = new Set((m.readBy || []).map((x) => String(x || "").toLowerCase()));
    const seenByOthers = others.some((o) => readSet.has(o));
    return seenByOthers ? "Seen" : "Sent";
  }

  // Emoji insert
  const commonEmoji = ["😊", "👍", "🎉", "💡", "✅", "🔥", "🙌", "✨", "💬", "🙂"];
  function appendEmoji(e: string) {
    setComposerBody((prev) => `${prev}${prev && !prev.endsWith(" ") ? " " : ""}${e}`);
  }

  // Keyboard shortcuts in composer
  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="w-full h-[calc(100vh-140px)] p-6 md:p-8 grid grid-cols-1 md:grid-cols-3 gap-6 pb-24">
      {/* Conversations list */}
      <div className="md:col-span-1 glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] p-6 flex flex-col h-full">
        <div className="flex items-center justify-between mb-3 shrink-0">
          <div className="text-sm font-semibold">
            {role === 'buyer' ? 'My Messages' : role === 'merchant' ? 'Customer Messages' : 'Messages'}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-2 py-1 rounded-md border text-xs"
              onClick={loadConversations}
              disabled={loadingConvos}
            >
              {loadingConvos ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Search + Filter */}
        <div className="space-y-2 mb-2 shrink-0">
          <input
            aria-label="Search conversations"
            className="w-full px-2 py-1 rounded-md border bg-background"
            placeholder="Search by subject or participant…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <div className="flex gap-1 flex-wrap" role="tablist" aria-label="Conversation filter">
            <button
              role="tab"
              aria-selected={filterMode === "all"}
              className={cx(
                "px-2 py-1 rounded-md border text-xs",
                filterMode === "all" && "bg-foreground/10"
              )}
              onClick={() => setFilterMode("all")}
            >
              All
            </button>
            <button
              role="tab"
              aria-selected={filterMode === "unread"}
              className={cx(
                "px-2 py-1 rounded-md border text-xs",
                filterMode === "unread" && "bg-foreground/10"
              )}
              onClick={() => setFilterMode("unread")}
            >
              Unread
            </button>
          </div>
        </div>

        {convoError && <div className="text-[10px] uppercase font-bold tracking-wider text-red-500 mb-2 shrink-0">{convoError}</div>}

        <div
          className="flex-1 overflow-y-auto space-y-2 min-h-0"
          role="list"
          aria-label="Conversations"
        >
          {loadingConvos && conversations.length === 0 && (
            <>
              {[...Array(6)].map((_, i) => (
                <div key={i} className="animate-pulse rounded-md border p-2">
                  <div className="h-3 w-1/2 bg-foreground/10 rounded mb-2" />
                  <div className="h-3 w-2/3 bg-foreground/10 rounded mb-1" />
                  <div className="h-3 w-1/3 bg-foreground/10 rounded" />
                </div>
              ))}
            </>
          )}

          {filteredConversations.map((c) => {
            const subjectLabel = subjectLabelFrom(c);
            const lastStr = formatRelativeTime(c.lastMessageAt || c.createdAt);
            const isActive = activeConvoId === c.id;
            const isUnread = !!unread[c.id];

            return (
              <button
                key={c.id}
                role="listitem"
                className={cx(
                  "w-full text-left rounded-md border p-2 transition-colors",
                  isActive ? "bg-foreground/10" : "hover:bg-foreground/5"
                )}
                onClick={() => setActiveConvoId(c.id)}
                title={subjectLabel}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold truncate">{subjectLabel}</div>
                  <div className="flex items-center gap-2">
                    {isUnread && (
                      <span
                        className="inline-block h-2 w-2 rounded-full bg-amber-500"
                        title="Unread message"
                        aria-label="Unread"
                      />
                    )}
                    {lastStr && (
                      <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">{lastStr}</span>
                    )}
                  </div>
                </div>
                <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider truncate">
                  {(c.participants || []).map(truncateWallet).join(", ")}
                </div>
              </button>
            );
          })}

          {filteredConversations.length === 0 && !loadingConvos && (
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">No conversations found.</div>
          )}
        </div>
      </div>

      {/* Thread + Composer */}
      <div className="md:col-span-2 glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] p-6 flex flex-col h-full">
        {activeConvoId ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between mb-3 shrink-0">
              <div className="flex items-center gap-3 overflow-hidden flex-wrap">
                <div className="text-sm font-semibold truncate">
                  {activeConvo ? subjectLabelFrom(activeConvo) : "Conversation"}
                </div>
                {/* Participants preview */}
                <div className="flex items-center gap-1">
                  {participants.slice(0, 3).map((p) => (
                    <PfpCircle key={p} wallet={p} size={24} className="h-6 w-6" />
                  ))}
                  {participants.length > 3 && (
                    <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                      +{participants.length - 3}
                    </span>
                  )}
                </div>

                {/* Receipt Details Button in Header */}
                {(receiptDetails || (activeConvo?.subject?.type === 'checkout' || activeConvo?.subject?.type === 'order')) && (
                  <button
                    onClick={() => setShowReceiptModal(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 text-xs font-medium transition-all shadow-sm shrink-0 cursor-pointer"
                    title="View Receipt & Transaction Details"
                  >
                    <Receipt className="w-3.5 h-3.5" />
                    <span>Receipt Info</span>
                    {receiptDetails?.totalUsd !== undefined && (
                      <span className="font-mono text-white text-[11px] font-bold bg-blue-500/20 px-1.5 py-0.5 rounded border border-blue-500/30">
                        ${Number(receiptDetails.totalUsd).toFixed(2)}
                      </span>
                    )}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="px-2 py-1 rounded-md border text-xs"
                  onClick={() => loadMessages(String(activeConvoId))}
                  disabled={loadingMsgs}
                  aria-label="Refresh messages"
                >
                  {loadingMsgs ? "Refreshing…" : "Refresh"}
                </button>

                {/* More Menu */}
                <div className="relative" ref={menuRef}>
                  <button
                    className="p-1 hover:bg-foreground/5 rounded-lg transition-colors"
                    onClick={() => setShowMenu(!showMenu)}
                  >
                    <MoreHorizontal className="w-5 h-5 text-muted-foreground" />
                  </button>
                  {showMenu && (
                    <div className="absolute right-0 top-full mt-1 w-64 bg-background border rounded-xl shadow-xl z-50 py-2 animate-in fade-in slide-in-from-top-2">
                      {(receiptDetails || (activeConvo?.subject?.type === 'checkout' || activeConvo?.subject?.type === 'order')) && (
                        <button
                          onClick={() => { setShowReceiptModal(true); setShowMenu(false); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-sm text-left text-blue-400 font-medium"
                        >
                          <Receipt className="w-4 h-4 text-blue-400" />
                          <span>View Receipt Details</span>
                        </button>
                      )}
                      {role === 'buyer' && (
                        <a
                          href={getMerchantUrl('shop', '')} // Wallet not needed for shop if slug is set
                          target="_blank"
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
                      )}
                      {role === 'merchant' && (
                        <a
                          href={`/u/${participants.find(p => p.toLowerCase() !== me) || ''}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-sm"
                          onClick={() => setShowMenu(false)}
                        >
                          <User className="w-4 h-4 text-muted-foreground" />
                          View Profile
                          <ExternalLink className="w-3 h-3 ml-auto text-muted-foreground" />
                        </a>
                      )}
                      {activeConvo?.subject?.type === 'order' && orderTxHash && (
                        <a
                          href={`https://basescan.org/tx/${orderTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-sm"
                          onClick={() => setShowMenu(false)}
                        >
                          <ExternalLink className="w-4 h-4 text-muted-foreground" />
                          View Transaction
                        </a>
                      )}
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

            {msgError && <div className="text-[10px] uppercase font-bold tracking-wider text-red-500 mb-2 shrink-0">{msgError}</div>}

            {/* Thread */}
            <div
              ref={threadScrollRef}
              className="flex-1 overflow-y-auto space-y-3 border rounded-md p-3 bg-background/50 min-h-0"
              role="list"
              aria-label="Messages"
            >
              {loadingMsgs && messages.length === 0 && (
                <>
                  {[...Array(8)].map((_, i) => (
                    <div key={i} className="flex gap-2">
                      <div className="h-6 w-6 rounded-full bg-foreground/10" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 w-24 bg-foreground/10 rounded" />
                        <div className="h-10 w-3/4 bg-foreground/10 rounded" />
                      </div>
                    </div>
                  ))}
                </>
              )}

              {(messages || []).map((m) => {
                const mine = String(m.senderWallet || "").toLowerCase() === me;
                return (
                  <div
                    key={m.id}
                    role="listitem"
                    className={cx(
                      "flex items-start gap-2",
                      mine ? "justify-end" : "justify-start"
                    )}
                  >
                    {!mine && (
                      <PfpCircle wallet={m.senderWallet} size={24} className="h-6 w-6 mt-1" />
                    )}
                    <div
                      className={cx(
                        "max-w-[80%] rounded-md border px-3 py-2",
                        mine ? "bg-foreground/10" : "bg-background"
                      )}
                    >
                      <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1 flex items-center gap-2">
                        {!mine && <span>{truncateWallet(m.senderWallet)}</span>}
                        <span>{new Date(Number(m.createdAt || 0)).toLocaleString()}</span>
                        {mine && (
                          <span className="inline-flex items-center gap-1" aria-label="Read receipt">
                            <span className="text-[10px] uppercase font-bold tracking-wider">{getReadReceiptLabel(m)}</span>
                          </span>
                        )}
                      </div>
                      <div className="text-sm whitespace-pre-wrap break-words">{m.body}</div>
                      {/* Attachments */}
                      {m.attachments && m.attachments.length > 0 && (
                        <div className="flex gap-2 mt-2 flex-wrap">
                          {m.attachments.map((url: string, j: number) => (
                            <a key={j} href={url} target="_blank" rel="noopener noreferrer" className="block w-20 h-20 rounded-lg border overflow-hidden hover:ring-2 ring-primary transition-all">
                              <img src={url} alt="" className="w-full h-full object-cover" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                    {mine && (
                      <PfpCircle wallet={m.senderWallet} size={24} className="h-6 w-6 mt-1" />
                    )}
                  </div>
                );
              })}

              {(messages || []).length === 0 && !loadingMsgs && (
                <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">No messages yet.</div>
              )}
            </div>

            {/* Composer */}
            <div className="mt-3 grid grid-cols-1 gap-2 shrink-0">
              {/* Attachment Preview */}
              {attachments.length > 0 && (
                <AttachmentGrid
                  images={attachments}
                  onRemove={removeAttachment}
                  onMarkup={openMarkup}
                />
              )}

              <div className="flex items-start gap-2">
                <div className="relative">
                  <button
                    type="button"
                    className="px-2 py-2 rounded-md border text-sm"
                    aria-haspopup="true"
                    aria-expanded={showEmoji}
                    aria-label="Insert emoji"
                    onClick={() => setShowEmoji((s) => !s)}
                  >
                    😊
                  </button>
                  {showEmoji && (
                    <div
                      role="menu"
                      aria-label="Emoji picker"
                      className="absolute z-10 bottom-full mb-2 w-44 rounded-md border glass-pane p-2 grid grid-cols-5 gap-1"
                    >
                      {commonEmoji.map((e) => (
                        <button
                          key={e}
                          role="menuitem"
                          className="text-lg rounded hover:bg-foreground/10"
                          onClick={() => appendEmoji(e)}
                          title={`Insert ${e}`}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="relative flex-1">
                  <textarea
                    ref={composerRef}
                    className="w-full min-h-[4rem] max-h-[12rem] px-3 py-2 border rounded-md bg-background"
                    value={composerBody}
                    onChange={(e) => setComposerBody(e.target.value)}
                    onKeyDown={onComposerKeyDown}
                    placeholder="Type a message…"
                    aria-label="Message composer"
                    onPaste={(e) => {
                      const items = e.clipboardData.items;
                      for (let i = 0; i < items.length; i++) {
                        if (items[i].type.indexOf("image") !== -1) {
                          e.preventDefault();
                          const file = items[i].getAsFile();
                          if (file) handleFileUpload([file] as any);
                        }
                      }
                    }}
                  />
                  {/* Drag overlay could go here */}
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    className="px-3 py-2 rounded-md border text-sm bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={sendMessage}
                    disabled={!composerBody.trim() && attachments.length === 0}
                    aria-label="Send message"
                    title="Send (Ctrl/Cmd+Enter)"
                  >
                    {uploading ? "..." : "Send"}
                  </button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => handleFileUpload(e.target.files)}
                  />
                  <button
                    className="px-3 py-2 rounded-md border text-xs hover:bg-foreground/5"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={attachments.length >= 3 || uploading}
                    title="Attach image"
                  >
                    <ImagePlus className="w-4 h-4 mx-auto" />
                  </button>
                </div>
              </div>
              <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider flex items-center justify-between">
                <span>Press Ctrl/Cmd+Enter to send</span>
                <span>{composerBody.trim().length} chars</span>
              </div>
            </div>
          </>
        ) : (
          <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider m-auto">
            Select a conversation to view messages.
          </div>
        )}
      </div>

      {/* Gallery Modal */}
      {
        showGallery && activeConvo && (
          <GalleryModal
            wallet={activeConvo.participants.find(p => p.toLowerCase() !== me) || activeConvo.participants[0]}
            onClose={() => setShowGallery(false)}
          />
        )
      }

      {/* Markup Modal */}
      {
        markupImage && (
          <ImageMarkupModal
            imageUrl={markupImage}
            onSave={handleMarkupSave}
            onClose={() => { setMarkupImage(null); setMarkupIndex(-1); }}
          />
        )
      }

      {/* Receipt Details Modal */}
      {
        showReceiptModal && (
          <ReceiptDetailsModal
            receipt={receiptDetails}
            loading={receiptLoading}
            onClose={() => setShowReceiptModal(false)}
            copiedKey={copiedKey}
            onCopy={copyToClipboard}
          />
        )
      }
    </div >
  );
}

function ReceiptDetailsModal({
  receipt,
  loading,
  onClose,
  copiedKey,
  onCopy
}: {
  receipt: any;
  loading: boolean;
  onClose: () => void;
  copiedKey: string | null;
  onCopy: (text: string, key: string) => void;
}) {
  const status = String(receipt?.status || "pending").toLowerCase();
  const isSettled = ["paid", "checkout_success", "confirmed", "tx_mined", "completed"].includes(status);
  const isAchPending = status.includes("ach");
  const isFailed = status.includes("fail") || status.includes("cancel");

  const statusBadge = isSettled ? (
    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
      <CheckCircle2 className="w-3.5 h-3.5" />
      <span>Paid / Settled</span>
    </span>
  ) : isAchPending ? (
    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center gap-1">
      <Clock className="w-3.5 h-3.5" />
      <span>ACH Pending</span>
    </span>
  ) : isFailed ? (
    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-1">
      <AlertCircle className="w-3.5 h-3.5" />
      <span>Failed</span>
    </span>
  ) : (
    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
      <Clock className="w-3.5 h-3.5" />
      <span>{status || "Pending"}</span>
    </span>
  );

  const email = receipt?.customerEmail || receipt?.stripeEmail || receipt?.email;
  const funding = receipt?.detectedCardFunding || (receipt?.isCreditCard ? "credit" : undefined);
  const fundingLabel = funding === "us_bank_account" || funding === "ach"
    ? "US Bank Account (ACH)"
    : funding === "debit"
      ? "Debit Card"
      : funding === "credit"
        ? "Credit Card"
        : funding
          ? String(funding).toUpperCase()
          : "Standard Card / Digital Payment";

  const txHash = receipt?.transactionHash || receipt?.txHash;
  const leg1TxHash = receipt?.leg1TxHash || receipt?.onrampTxHash;
  const leg2TxHash = receipt?.leg2TxHash;
  const stripeId = receipt?.stripeSessionId || receipt?.stripePaymentIntentId || receipt?.paymentIntentId;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 overflow-y-auto animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200 text-zinc-200">
        
        {/* Header */}
        <div className="p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-white">Receipt &amp; Order Details</h3>
                {statusBadge}
              </div>
              <p className="text-xs font-mono text-zinc-400 mt-0.5">
                ID: {receipt?.receiptId || receipt?.id || "Loading..."}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0 text-sm">
          {loading && !receipt ? (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
              <div className="w-8 h-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
              <span className="text-xs font-mono text-zinc-400">Fetching receipt details...</span>
            </div>
          ) : (
            <>
              {/* Financial & Time Summary Card */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800/80">
                  <span className="text-[10px] font-mono uppercase text-zinc-400 tracking-wider">Total Amount</span>
                  <div className="text-lg font-black text-white font-mono mt-0.5">
                    ${Number(receipt?.totalUsd || 0).toFixed(2)}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800/80">
                  <span className="text-[10px] font-mono uppercase text-zinc-400 tracking-wider">Payment Method</span>
                  <div className="text-xs font-semibold text-zinc-200 mt-1 truncate" title={fundingLabel}>
                    {fundingLabel}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800/80 col-span-2 sm:col-span-1">
                  <span className="text-[10px] font-mono uppercase text-zinc-400 tracking-wider">Date &amp; Time</span>
                  <div className="text-xs font-mono text-zinc-300 mt-1">
                    {receipt?.createdAt ? new Date(receipt.createdAt).toLocaleDateString() : "—"}
                  </div>
                </div>
              </div>

              {/* Customer Information */}
              <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-blue-400" />
                  <span>Customer Contact</span>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-400">Customer Email:</span>
                    {email ? (
                      <div className="flex items-center gap-2">
                        <a
                          href={`mailto:${email}`}
                          className="font-mono text-blue-400 hover:underline"
                        >
                          {email}
                        </a>
                        <button
                          onClick={() => onCopy(email, "email")}
                          className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                          title="Copy Email"
                        >
                          {copiedKey === "email" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ) : (
                      <span className="text-zinc-500 font-mono">Not provided</span>
                    )}
                  </div>

                  {receipt?.buyerWallet && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400">Buyer Wallet:</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-zinc-300 truncate max-w-[180px] sm:max-w-[240px]">
                          {receipt.buyerWallet}
                        </span>
                        <button
                          onClick={() => onCopy(receipt.buyerWallet, "buyerWallet")}
                          className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                          title="Copy Wallet"
                        >
                          {copiedKey === "buyerWallet" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        <a
                          href={`https://basescan.org/address/${receipt.buyerWallet}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 transition-colors"
                          title="View on BaseScan"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Processor & Stripe Reference */}
              <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5 text-purple-400" />
                  <span>Stripe &amp; Processor Reference</span>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-400">Stripe Session ID:</span>
                    {stripeId ? (
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-purple-300 truncate max-w-[180px] sm:max-w-[240px]">
                          {stripeId}
                        </span>
                        <button
                          onClick={() => onCopy(stripeId, "stripeId")}
                          className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                          title="Copy Stripe ID"
                        >
                          {copiedKey === "stripeId" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ) : (
                      <span className="text-zinc-500 font-mono">None (Direct Web3)</span>
                    )}
                  </div>

                  {receipt?.brandName && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400">Container / Brand:</span>
                      <span className="font-medium text-zinc-300">{receipt.brandName}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Blockchain Transaction Hashes */}
              <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-emerald-400" />
                  <span>On-Chain Transaction Hashes</span>
                </div>

                <div className="space-y-2">
                  {/* Settlement Hash */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-400">Settlement Hash:</span>
                    {txHash ? (
                      <div className="flex items-center gap-2">
                        <a
                          href={`https://basescan.org/tx/${txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-emerald-400 hover:underline truncate max-w-[180px] sm:max-w-[240px]"
                        >
                          {txHash}
                        </a>
                        <button
                          onClick={() => onCopy(txHash, "txHash")}
                          className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                          title="Copy Hash"
                        >
                          {copiedKey === "txHash" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        <a
                          href={`https://basescan.org/tx/${txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 transition-colors"
                          title="View on BaseScan"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    ) : (
                      <span className="text-zinc-500 font-mono">Pending on-chain</span>
                    )}
                  </div>

                  {/* Leg 1 / Onramp Hash */}
                  {leg1TxHash && leg1TxHash !== txHash && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400">Onramp Hash:</span>
                      <div className="flex items-center gap-2">
                        <a
                          href={`https://basescan.org/tx/${leg1TxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-zinc-300 hover:underline truncate max-w-[180px] sm:max-w-[240px]"
                        >
                          {leg1TxHash}
                        </a>
                        <button
                          onClick={() => onCopy(leg1TxHash, "leg1TxHash")}
                          className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                        >
                          {copiedKey === "leg1TxHash" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Leg 2 Hash */}
                  {leg2TxHash && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400">Delivery Hash:</span>
                      <div className="flex items-center gap-2">
                        <a
                          href={`https://basescan.org/tx/${leg2TxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-zinc-300 hover:underline truncate max-w-[180px] sm:max-w-[240px]"
                        >
                          {leg2TxHash}
                        </a>
                        <button
                          onClick={() => onCopy(leg2TxHash, "leg2TxHash")}
                          className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                        >
                          {copiedKey === "leg2TxHash" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Line Items if available */}
              {Array.isArray(receipt?.lineItems) && receipt.lineItems.length > 0 && (
                <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800 space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-amber-400" />
                    <span>Line Items ({receipt.lineItems.length})</span>
                  </div>
                  <div className="divide-y divide-zinc-800/60 max-h-40 overflow-y-auto">
                    {receipt.lineItems.map((item: any, idx: number) => (
                      <div key={idx} className="py-1.5 flex justify-between items-center text-xs">
                        <span className="text-zinc-300">{item.name || item.label || `Item #${idx + 1}`}</span>
                        <span className="font-mono text-zinc-400">${Number(item.priceUsd || item.price || 0).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/50 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
