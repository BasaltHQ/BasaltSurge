"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useActiveAccount } from "thirdweb/react";
import {
  MessageSquare,
  X,
  Send,
  HelpCircle,
  AlertTriangle,
  Image as ImageIcon,
  Minimize2,
  ChevronUp,
  Clock,
  CheckCircle2,
  Paperclip
} from "lucide-react";

interface CheckoutChatWidgetProps {
  merchantWallet?: string;
  receiptId?: string;
  amountUsd?: number;
  activeStep?: number;
  activeError?: string | null;
  isLightText?: boolean;
  primaryColor?: string;
  brandName?: string;
  logoUrl?: string;
  buyerWallet?: string;
}

interface ChatMessage {
  id: string;
  conversationId: string;
  senderWallet: string;
  body: string;
  attachments?: string[];
  createdAt: number;
  readBy?: string[];
}

function truncateWallet(w: string) {
  const x = String(w || "");
  return /^0x[a-f0-9]{40}$/i.test(x) ? `${x.slice(0, 6)}…${x.slice(-4)}` : x;
}

function formatTime(ts?: number) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function CheckoutChatWidget({
  merchantWallet: propMerchantWallet,
  receiptId = "REC-CHECKOUT",
  amountUsd,
  activeStep = 1,
  activeError,
  isLightText = true,
  primaryColor: propPrimaryColor = "#635BFF",
  brandName: propBrandName = "Merchant Support",
  logoUrl: propLogoUrl,
  buyerWallet: propBuyerWallet
}: CheckoutChatWidgetProps) {
  const account = useActiveAccount();
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showProactiveBanner, setShowProactiveBanner] = useState(false);
  const [proactiveDismissed, setProactiveDismissed] = useState(false);

  // Safe brand context fallback
  const brandName = propBrandName || "Merchant Support";
  const primaryColor = propPrimaryColor || "#635BFF";
  const logoUrl = propLogoUrl || "";

  // Derive active client wallet (Thirdweb account or persistent guest wallet)
  const [clientWallet, setClientWallet] = useState<string>("");

  useEffect(() => {
    if (account?.address) {
      setClientWallet(account.address.toLowerCase());
    } else if (propBuyerWallet && /^0x[a-f0-9]{40}$/i.test(propBuyerWallet)) {
      setClientWallet(propBuyerWallet.toLowerCase());
    } else {
      // Ephemeral or stored guest wallet for checkout chat
      try {
        let stored = localStorage.getItem("pp_checkout_chat_wallet");
        if (!stored || !/^0x[a-f0-9]{40}$/i.test(stored)) {
          // Generate deterministic pseudo-wallet address for guest session
          const randomHex = Array.from({ length: 40 }, () =>
            Math.floor(Math.random() * 16).toString(16)
          ).join("");
          stored = `0x${randomHex}`;
          localStorage.setItem("pp_checkout_chat_wallet", stored);
        }
        setClientWallet(stored.toLowerCase());
      } catch {
        setClientWallet("0x0000000000000000000000000000000000000001");
      }
    }
  }, [account?.address, propBuyerWallet]);

  // Fallback target merchant wallet if not provided
  const targetMerchantWallet = (
    propMerchantWallet ||
    process.env.NEXT_PUBLIC_OWNER_WALLET ||
    "0x0000000000000000000000000000000000000000"
  ).toLowerCase();

  // Chat conversation & messages state
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [composerText, setComposerText] = useState("");
  const [errorText, setErrorText] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Proactive alert trigger: active error OR hesitation timer on Step 2 (Identity / SSN)
  useEffect(() => {
    if (activeError && !proactiveDismissed) {
      setShowProactiveBanner(true);
      return;
    }

    if (activeStep === 2 && !proactiveDismissed) {
      // Step 2 hesitation timer (12 seconds on identity verification step)
      const timer = setTimeout(() => {
        if (!isOpen && !proactiveDismissed) {
          setShowProactiveBanner(true);
        }
      }, 12000);
      return () => clearTimeout(timer);
    }
  }, [activeError, activeStep, isOpen, proactiveDismissed]);

  // Scroll to bottom of chat
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
      setUnreadCount(0);
    }
  }, [isOpen, messages.length]);

  // Dynamic proactive banner text based on step & error
  const proactiveBannerText = React.useMemo(() => {
    if (activeError) {
      return {
        title: "Need help resolving error?",
        message: activeError
      };
    }
    if (activeStep === 2) {
      return {
        title: "Questions about Identity & SSN?",
        message: "Your SSN & DOB data is encrypted for regulatory compliance. Chat live with us if you have privacy questions!"
      };
    }
    return {
      title: "Need help with checkout?",
      message: "Our team is live and ready to assist with your order."
    };
  }, [activeError, activeStep]);

  // Dynamic step-aware quick helper chips
  const quickChips = React.useMemo(() => {
    if (activeStep === 2) {
      return [
        {
          label: "Why is SSN required?",
          text: `Hi! I'm on Step 2 (Identity Verification). Why is SSN / identity verification required for order ${receiptId}, and how is it used?`
        },
        {
          label: "Is my SSN data secure?",
          text: "Hi! Can you clarify how my Social Security Number and personal details are encrypted and stored?"
        },
        {
          label: "Alternative verification?",
          text: "Hi! Are there alternative payment or verification options available that don't require entering my SSN?"
        }
      ];
    } else if (activeStep === 3) {
      return [
        {
          label: "Payment error help",
          text: `Hi! I'm experiencing an issue during payment for receipt ${receiptId}. ${activeError ? `Error: ${activeError}` : ""}`
        },
        {
          label: "Alternative payment",
          text: "Do you accept other payment methods (Apple Pay, Bank, Crypto) for this order?"
        },
        {
          label: "Fee & total question",
          text: `I have a question regarding order ${receiptId} for $${amountUsd ? amountUsd.toFixed(2) : "0.00"}.`
        }
      ];
    } else if (activeStep === 4) {
      return [
        {
          label: "Shipping & tracking",
          text: `Hi! How can I track delivery for my order ${receiptId}?`
        },
        {
          label: "Resend email receipt",
          text: `Hi! Can you resend the transaction receipt for order ${receiptId}?`
        }
      ];
    }
    // Default / Step 1
    return [
      {
        label: "Contact & OTP help",
        text: "Hi! I need help verifying my contact information for checkout."
      },
      {
        label: "Order inquiry",
        text: `Hi! I have a question regarding order ${receiptId}.`
      },
      {
        label: "General support",
        text: "Hi! I need assistance completing my purchase."
      }
    ];
  }, [activeStep, activeError, receiptId, amountUsd]);

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
      setUnreadCount(0);
    }
  }, [isOpen, messages.length]);

  // Initialize or fetch conversation
  const initConversation = useCallback(async () => {
    if (!clientWallet || !targetMerchantWallet) return;
    try {
      setLoading(true);
      setErrorText("");

      const res = await fetch("/api/messages/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-client-wallet": clientWallet
        },
        body: JSON.stringify({
          participants: [clientWallet, targetMerchantWallet],
          subject: {
            type: "checkout",
            id: receiptId
          }
        })
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && data.conversation?.id) {
        setConversationId(data.conversation.id);
        fetchMessages(data.conversation.id);
      }
    } catch (err: any) {
      console.error("[CheckoutChatWidget] Failed to init conversation:", err);
    } finally {
      setLoading(false);
    }
  }, [clientWallet, targetMerchantWallet, receiptId]);

  // Fetch messages for active conversation
  const fetchMessages = useCallback(
    async (cid: string) => {
      if (!cid || !clientWallet) return;
      try {
        const res = await fetch(
          `/api/messages/conversations/${encodeURIComponent(cid)}/messages?page=0&limit=50`,
          {
            headers: {
              "x-client-wallet": clientWallet
            },
            cache: "no-store"
          }
        );
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok && Array.isArray(data.items)) {
          setMessages(data.items);

          // Update unread count if widget is closed and new merchant message received
          if (!isOpen && data.items.length > 0) {
            const lastMsg = data.items[data.items.length - 1];
            if (
              lastMsg.senderWallet.toLowerCase() !== clientWallet.toLowerCase() &&
              (!lastMsg.readBy || !lastMsg.readBy.includes(clientWallet.toLowerCase()))
            ) {
              setUnreadCount((prev) => Math.max(1, prev));
            }
          }
        }
      } catch (err) {
        console.error("[CheckoutChatWidget] Failed to load messages:", err);
      }
    },
    [clientWallet, isOpen]
  );

  // Initialize conversation once client wallet is ready
  useEffect(() => {
    if (clientWallet && targetMerchantWallet) {
      initConversation();
    }
  }, [clientWallet, targetMerchantWallet, initConversation]);

  // Polling for live replies when open or conversation is active
  useEffect(() => {
    if (!conversationId) return;
    const interval = setInterval(() => {
      fetchMessages(conversationId);
    }, 5000);
    return () => clearInterval(interval);
  }, [conversationId, fetchMessages]);

  // Send message handler
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend !== undefined ? textToSend : composerText).trim();
    if (!text || !conversationId || !clientWallet) return;

    try {
      setSending(true);
      setErrorText("");

      // Optimistic message UI append
      const tempMsg: ChatMessage = {
        id: `temp-${Date.now()}`,
        conversationId,
        senderWallet: clientWallet,
        body: text,
        createdAt: Date.now(),
        readBy: [clientWallet]
      };
      setMessages((prev) => [...prev, tempMsg]);
      setComposerText("");

      const res = await fetch(
        `/api/messages/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-client-wallet": clientWallet
          },
          body: JSON.stringify({
            body: text
          })
        }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        // Revert optimistic msg
        setMessages((prev) => prev.filter((m) => m.id !== tempMsg.id));
        setErrorText(data.error || "Failed to send message.");
      } else {
        // Re-fetch to get verified doc
        fetchMessages(conversationId);
      }
    } catch (err: any) {
      setErrorText(err.message || "Network error sending message.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* Mobile Drawer Overlay Backdrop */}
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className="sm:hidden fixed inset-0 bg-black/50 backdrop-blur-xs z-40 animate-in fade-in duration-200"
        />
      )}

      <div className="fixed bottom-3 right-3 sm:bottom-5 sm:right-5 z-50 flex flex-col items-end font-sans antialiased max-w-full">
        {/* Proactive Help Alert Box */}
        {showProactiveBanner && !isOpen && (
          <div className="mb-3 w-[calc(100vw-24px)] max-w-[380px] p-3.5 rounded-2xl border bg-black/95 text-white shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom-3 duration-300 border-amber-500/40 relative">
            <button
              onClick={() => {
                setShowProactiveBanner(false);
                setProactiveDismissed(true);
              }}
              className="absolute top-2.5 right-2.5 p-1 text-neutral-400 hover:text-white"
              title="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-start gap-2.5 pr-5">
              <div className="p-1.5 bg-amber-500/20 rounded-xl text-amber-400 shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-bold text-amber-300">{proactiveBannerText.title}</p>
                <p className="text-[11px] text-neutral-300 leading-snug line-clamp-2">
                  {proactiveBannerText.message}
                </p>
                <button
                  onClick={() => {
                    setIsOpen(true);
                    setShowProactiveBanner(false);
                    if (activeError) {
                      handleSendMessage(`I need assistance with checkout error: ${activeError}`);
                    } else if (activeStep === 2) {
                      handleSendMessage(`Hi! I'm on Step 2 (Identity Verification) and have a question regarding SSN / identity requirements.`);
                    }
                  }}
                  className="mt-1 text-[11px] font-bold text-amber-400 hover:underline flex items-center gap-1"
                >
                  Chat with merchant <ChevronUp className="w-3 h-3 rotate-90" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Expanded Chat Drawer / Mobile Bottom Sheet */}
        {isOpen ? (
          <div className="fixed inset-x-0 bottom-0 sm:bottom-5 sm:right-5 sm:left-auto w-full sm:w-96 h-[85vh] sm:h-[460px] max-h-[100dvh] rounded-t-3xl sm:rounded-2xl border-t sm:border border-foreground/15 bg-background shadow-2xl flex flex-col overflow-hidden z-50 animate-in slide-in-from-bottom-5 sm:zoom-in-95 duration-250 backdrop-blur-xl">
            {/* Mobile Top Drag Indicator */}
            <div className="sm:hidden w-12 h-1 rounded-full bg-foreground/20 mx-auto my-2 shrink-0" />

            {/* Header */}
            <div
              className="p-3.5 border-b border-foreground/10 flex items-center justify-between text-white shrink-0"
              style={{ backgroundColor: primaryColor }}
            >
              <div className="flex items-center gap-2.5">
                {logoUrl ? (
                  <div className="w-8 h-8 rounded-full bg-white/20 p-0.5 overflow-hidden shrink-0 border border-white/20">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logoUrl} alt={brandName} className="w-full h-full object-contain rounded-full bg-white" />
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center font-bold text-sm shrink-0">
                    💬
                  </div>
                )}
                <div className="space-y-0.5 overflow-hidden">
                  <h4 className="text-xs font-bold truncate tracking-wide leading-tight">{brandName}</h4>
                  <div className="flex items-center gap-1 text-[10px] text-white/80">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Live Merchant Support</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg hover:bg-white/20 transition-colors text-white/90"
                title="Close Chat"
              >
                <X className="w-5 h-5 sm:hidden" />
                <Minimize2 className="w-4 h-4 hidden sm:block" />
              </button>
            </div>

          {/* Messages Thread Container */}
          <div className="flex-1 p-3 overflow-y-auto space-y-3 bg-foreground/[0.02] text-xs">
            {/* Introductory Support Banner */}
            <div className="p-3 rounded-xl border border-foreground/10 bg-foreground/[0.03] text-[11px] text-muted-foreground text-center space-y-1">
              <p className="font-semibold text-foreground">Have questions about your checkout?</p>
              <p>Send a message directly to the merchant. Messages wire live to their Admin panel.</p>
            </div>

            {loading && messages.length === 0 && (
              <div className="flex items-center justify-center h-32 text-muted-foreground">
                <span className="animate-spin mr-2">⏳</span> Loading conversation...
              </div>
            )}

            {/* Quick Action Helper Chips */}
            {messages.length < 2 && (
              <div className="space-y-1.5 pt-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Quick Options</p>
                <div className="flex flex-col gap-1.5">
                  {quickChips.map((chip, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSendMessage(chip.text)}
                      className="text-left px-2.5 py-1.5 rounded-lg border border-foreground/10 bg-background hover:bg-foreground/5 text-[11px] font-medium transition-all duration-150 flex items-center justify-between"
                    >
                      <span className="truncate">{chip.label}</span>
                      <Send className="w-3 h-3 text-muted-foreground shrink-0 ml-1" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Message Bubble Feed */}
            {messages.map((msg) => {
              const isMe = msg.senderWallet.toLowerCase() === clientWallet.toLowerCase();
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isMe ? "items-end" : "items-start"} space-y-1`}
                >
                  <div
                    className={`max-w-[85%] px-3 py-2 rounded-2xl font-normal leading-relaxed break-words shadow-sm ${
                      isMe
                        ? "bg-foreground text-background rounded-tr-none"
                        : "bg-foreground/10 text-foreground border border-foreground/10 rounded-tl-none"
                    }`}
                  >
                    {msg.body}
                  </div>
                  <span className="text-[9px] text-muted-foreground px-1">
                    {formatTime(msg.createdAt)}
                  </span>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Composer Input Area */}
          <div className="p-2.5 border-t border-foreground/10 bg-background shrink-0 space-y-1.5">
            {errorText && (
              <div className="text-[10px] text-red-500 px-1 font-semibold truncate">{errorText}</div>
            )}
            <div className="flex items-end gap-1.5 relative">
              <textarea
                ref={inputRef}
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="Type a message to merchant..."
                rows={1}
                className="flex-1 min-h-[38px] max-h-24 p-2 text-xs bg-foreground/[0.04] border border-foreground/15 rounded-xl focus:outline-none focus:ring-1 focus:ring-foreground/30 resize-none font-medium"
              />
              <button
                onClick={() => handleSendMessage()}
                disabled={sending || !composerText.trim()}
                className="w-9 h-9 rounded-xl bg-foreground text-background font-bold flex items-center justify-center hover:opacity-90 active:scale-95 transition-all disabled:opacity-30 shrink-0"
                title="Send Message"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Collapsed Floating Trigger Button */
        <button
          onClick={() => setIsOpen(true)}
          className="relative group h-12 px-4 rounded-full text-white font-bold text-xs shadow-2xl flex items-center gap-2.5 hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer border border-white/20"
          style={{ backgroundColor: primaryColor }}
        >
          <div className="relative flex items-center shrink-0">
            {logoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={logoUrl} alt={brandName} className="w-5 h-5 object-contain rounded-full bg-white p-0.5" />
            ) : (
              <MessageSquare className="w-5 h-5" />
            )}
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-amber-400 text-black text-[9px] font-extrabold flex items-center justify-center animate-bounce">
                {unreadCount}
              </span>
            )}
          </div>
          <span className="font-semibold tracking-wide truncate max-w-[140px]">
            {brandName && brandName !== "Merchant Support" ? `${brandName} Help` : "Live Help"}
          </span>
        </button>
      )}
    </div>
  </>
  );
}
