"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useActiveAccount } from "thirdweb/react";
import {
  MessageSquare,
  X,
  Send,
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
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  // Target merchant wallet resolution (with receipt fallback)
  const [resolvedMerchantWallet, setResolvedMerchantWallet] = useState<string>(propMerchantWallet || "");

  useEffect(() => {
    if (propMerchantWallet && /^0x[a-f0-9]{40}$/i.test(propMerchantWallet)) {
      setResolvedMerchantWallet(propMerchantWallet.toLowerCase());
      return;
    }
    // Fallback: If receiptId is present and not a sample, resolve merchant wallet from receipt
    if (receiptId && !receiptId.startsWith("REC-SAMPLE") && receiptId !== "REC-CHECKOUT") {
      fetch(`/api/receipts/${encodeURIComponent(receiptId)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((data) => {
          const w = data?.item?.wallet || data?.item?.recipient || data?.receipt?.wallet || data?.receipt?.recipient;
          if (w && /^0x[a-f0-9]{40}$/i.test(w)) {
            setResolvedMerchantWallet(w.toLowerCase());
          }
        })
        .catch(() => {});
    }
  }, [propMerchantWallet, receiptId]);

  const targetMerchantWallet = (
    resolvedMerchantWallet ||
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

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Mobile Drawer Overlay Backdrop */}
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className="sm:hidden fixed inset-0 bg-black/50 backdrop-blur-xs z-40 animate-in fade-in duration-200"
        />
      )}

      <div className="fixed bottom-3 right-3 sm:bottom-5 sm:right-5 z-50 flex flex-col items-end font-sans antialiased max-w-full">
        {/* Expanded Chat Drawer / Mobile Bottom Sheet */}
        {isOpen ? (
          <div id="checkout-support-chat" role="dialog" aria-label="Checkout support" className="fixed inset-x-0 bottom-0 sm:bottom-5 sm:right-5 sm:left-auto w-full sm:w-96 h-[78vh] max-h-[78vh] sm:h-[480px] sm:max-h-[85vh] rounded-t-3xl sm:rounded-2xl border-t sm:border border-white/15 bg-neutral-950 text-white shadow-2xl flex flex-col overflow-hidden z-50 animate-in slide-in-from-bottom-5 sm:zoom-in-95 duration-250 backdrop-blur-2xl">
            {/* Mobile Top Drag Indicator */}
            <div className="sm:hidden w-12 h-1 rounded-full bg-white/30 mx-auto my-2 shrink-0" />

            {/* Header */}
            <div
              className="px-4 py-3 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between text-white shrink-0 shadow-sm relative"
              style={{ borderBottomColor: primaryColor }}
            >
              <div className="flex items-center gap-2.5">
                {logoUrl ? (
                  <div className="w-8 h-8 rounded-full bg-white/10 p-0.5 overflow-hidden shrink-0 border border-white/20 shadow-inner">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logoUrl} alt={brandName} className="w-full h-full object-contain rounded-full bg-white" />
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center font-bold text-xs shrink-0 border border-white/20">
                    💬
                  </div>
                )}
                <div className="space-y-0.5 overflow-hidden">
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-xs font-extrabold text-white truncate tracking-wide leading-tight">
                      {brandName !== "Merchant Support" ? `${brandName} Support` : "Merchant Support"}
                    </h4>
                  </div>
                  <div className="text-[10px] text-neutral-400">
                    <span>Checkout support</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 transition-colors text-white"
                title="Close Support Chat"
              >
                <X className="w-4 h-4 text-white" />
              </button>
            </div>

            {/* Messages Thread Container */}
            <div className="flex-1 p-3.5 overflow-y-auto space-y-3 bg-neutral-900/90 text-xs">
              {/* Introductory Support Banner */}
              <div className="p-3 rounded-xl border border-neutral-800 bg-neutral-800/80 text-[11px] text-neutral-300 text-center space-y-1 shadow-inner">
                <p className="font-bold text-white">Have questions about your checkout?</p>
                <p className="text-neutral-400 leading-snug">Ask the merchant about your payment, verification, or order.</p>
              </div>

              {/* Checkout context stays inside the chat. Opening it never sends a message. */}
              <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-3 space-y-2 text-[11px] text-neutral-400">
                <p className="font-semibold text-neutral-200">Checkout details</p>
                <p className="break-all">Receipt: {receiptId}</p>
                <p>Step {activeStep} of 4</p>
                {activeError && activeError !== "none" ? (
                  <>
                    <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed text-neutral-300">{activeError}</p>
                    <button type="button"
                      onClick={() => {
                        const details = `Receipt ${receiptId}, checkout step ${activeStep}. Details: ${activeError}`;
                        setComposerText(current => current.includes(details) ? current : current.trim() ? `${current}\n\n${details}` : `Hi! I need help with checkout. ${details}`);
                        inputRef.current?.focus();
                      }}
                      className="text-xs font-medium text-white underline decoration-neutral-600 underline-offset-4 hover:decoration-white">
                      Add details to my message
                    </button>
                  </>
                ) : activeStep === 2 ? (
                  <p className="leading-relaxed">Questions about identity verification? Ask here before continuing.</p>
                ) : null}
              </div>

              {loading && messages.length === 0 && (
                <div className="flex items-center justify-center h-32 text-neutral-400 font-medium">
                  <span className="animate-spin mr-2">⏳</span> Loading conversation...
                </div>
              )}

              {/* Quick Action Helper Chips */}
              {messages.length < 2 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Quick Options</p>
                  <div className="flex flex-col gap-1.5">
                    {quickChips.map((chip, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleSendMessage(chip.text)}
                        className="text-left px-3 py-2 rounded-xl border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 text-neutral-100 text-[11px] font-semibold transition-all duration-150 flex items-center justify-between shadow-sm active:scale-98"
                      >
                        <span className="truncate pr-2">{chip.label}</span>
                        <Send className="w-3.5 h-3.5 text-blue-400 shrink-0" />
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
                      className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-xs font-semibold leading-relaxed break-words shadow-md ${
                        isMe
                          ? "bg-blue-600 text-white rounded-tr-none"
                          : "bg-neutral-800 text-neutral-100 border border-neutral-700 rounded-tl-none"
                      }`}
                    >
                      {msg.body}
                    </div>
                    <span className="text-[9px] text-neutral-400 px-1 font-medium">
                      {formatTime(msg.createdAt)}
                    </span>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Composer Input Area */}
            <div className="p-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] border-t border-neutral-800 bg-neutral-950 shrink-0 space-y-2">
              {errorText && (
                <div className="text-[10px] text-red-400 px-1 font-bold truncate">{errorText}</div>
              )}
              <div className="flex items-end gap-2 relative">
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
                  className="flex-1 min-h-[42px] max-h-24 p-2.5 text-xs bg-neutral-900 border border-neutral-700 text-white placeholder:text-neutral-400 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-medium resize-none"
                />
                <button
                  onClick={() => handleSendMessage()}
                  disabled={sending || !composerText.trim()}
                  className="w-10 h-10 rounded-xl text-white font-bold flex items-center justify-center shadow-lg hover:opacity-90 active:scale-95 transition-all disabled:opacity-30 shrink-0 cursor-pointer"
                  style={{ backgroundColor: primaryColor }}
                  title="Send Message"
                >
                  <Send className="w-4 h-4 text-white stroke-[2.5]" />
                </button>
              </div>
            </div>
          </div>
        ) : (
        /* Collapsed Floating Trigger Button */
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label={unreadCount > 0 ? `Chat with us, ${unreadCount} unread messages` : "Chat with us"}
          aria-expanded={false}
          aria-controls="checkout-support-chat"
          className={`relative min-h-11 px-3.5 rounded-full text-xs shadow-sm flex items-center gap-2 transition-colors duration-150 cursor-pointer backdrop-blur-md border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 ${isLightText ? "bg-neutral-950/85 border-white/15 text-neutral-200 hover:bg-neutral-900" : "bg-white/90 border-neutral-200 text-neutral-700 hover:bg-neutral-50"}`}
        >
          <div className="relative flex items-center shrink-0">
            {logoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={logoUrl} alt={brandName} className="w-5 h-5 object-contain rounded-full bg-white p-0.5" />
            ) : (
              <MessageSquare className="w-4 h-4" style={{ color: primaryColor }} />
            )}
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-neutral-200 text-neutral-900 text-[9px] font-semibold flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </div>
          <span className="font-semibold tracking-wide truncate max-w-[140px]">
            Chat with us
          </span>
        </button>
      )}
    </div>
  </>,
  document.body
  );
}
