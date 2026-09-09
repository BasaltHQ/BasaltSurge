"use client";

import React, { useState } from "react";
import { ReserveSettings } from "./ReserveSettings";
import { ReserveStrategy } from "./ReserveStrategy";
import { ReserveAnalytics } from "./ReserveAnalytics";
import { TipSettings } from "./TipSettings";
import { TaxManagement } from "./TaxManagement";
import { TransactionsViewer } from "./TransactionsViewer";
import { OfframpPanel } from "./OfframpPanel";

type ReserveTab = "configuration" | "analytics" | "transactions" | "tax" | "tips" | "offramp";

export function ReserveTabs({ initialTab = "configuration" }: { initialTab?: ReserveTab } = {}) {
  const [activeTab, setActiveTab] = useState<ReserveTab>(initialTab);

  return (
    <div className="-mt-6 w-full h-[calc(100vh-116px)] flex flex-col relative z-20">
      {/* Sleek background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-32 bg-[var(--pp-secondary)] opacity-10 blur-[100px] pointer-events-none" />

      {/* Header Area */}
      <div className="flex items-center justify-between relative z-10 shrink-0 p-4 md:p-8 pb-2 md:pb-4">
        <div className="flex items-center gap-3 md:gap-4">
          <div className="w-8 h-8 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-gradient-to-br from-foreground/10 to-transparent flex items-center justify-center overflow-hidden shadow-lg border border-foreground/5 backdrop-blur-md">
            <svg className="w-4 h-4 md:w-6 md:h-6 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
            </svg>
          </div>
          <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-br from-foreground to-foreground/60 bg-clip-text text-transparent">Reserve</h1>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col px-4 md:px-8 pb-4 md:pb-8 relative z-10 gap-2 md:gap-6">
        {/* Tab Navigation */}
        <div className="rounded-xl md:rounded-2xl bg-foreground/[0.02] border border-foreground/[0.04] p-1.5 md:p-2 backdrop-blur-sm shrink-0 shadow-sm flex items-center overflow-x-auto gap-1 md:gap-2 scrollbar-none">
          {[
            { id: "configuration", label: "Configuration" },
            { id: "analytics", label: "Analytics" },
            { id: "transactions", label: "Transactions" },
            { id: "tax", label: "Tax" },
            { id: "tips", label: "Tips" },
            { id: "offramp", label: "Fiat Offramp" }
          ].map(tab => (
            <button
              key={tab.id}
              className={`px-3 md:px-5 py-1.5 md:py-2.5 whitespace-nowrap rounded-lg text-[10px] md:text-sm font-bold uppercase tracking-wider transition-all flex-shrink-0 ${
                activeTab === tab.id
                  ? "bg-[var(--pp-secondary)] text-white shadow-md shadow-[var(--pp-secondary)]/20"
                  : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
              }`}
              onClick={() => setActiveTab(tab.id as ReserveTab)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Scrollable Content Pane */}
        <div className="flex-1 min-h-0 rounded-2xl md:rounded-3xl bg-foreground/[0.015] border border-foreground/[0.03] backdrop-blur-sm overflow-y-auto shadow-2xl relative custom-scrollbar">
          <div className="p-4 md:p-8">
            {activeTab === "configuration" && (
              <div className="space-y-6 md:space-y-8 w-full">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg md:text-2xl font-bold">Configuration</h2>
                    <p className="text-xs md:text-sm text-muted-foreground mt-1">
                      Configure processing fee and target reserve ratios. Defaults are applied immediately.
                    </p>
                  </div>
                  <span className="text-[10px] uppercase font-bold tracking-[0.2em] text-[var(--pp-secondary)] px-3 py-1 rounded-full bg-[var(--pp-secondary)]/10 border border-[var(--pp-secondary)]/20">Admin</span>
                </div>
                <ReserveSettings />
                <div className="h-px bg-foreground/5" />
                <ReserveStrategy />
              </div>
            )}

            {activeTab === "analytics" && (
              <div className="space-y-6 md:space-y-8">
                <ReserveAnalytics />
              </div>
            )}

            {activeTab === "transactions" && (
              <div className="space-y-6 md:space-y-8">
                <TransactionsViewer />
              </div>
            )}

            {activeTab === "tax" && (
              <div className="space-y-6 md:space-y-8 w-full">
                <TaxManagement />
              </div>
            )}

            {activeTab === "tips" && (
              <div className="space-y-6 md:space-y-8 w-full">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg md:text-2xl font-bold">Tip Settings</h2>
                    <p className="text-xs md:text-sm text-muted-foreground mt-1">
                      Configure the tip percentage presets shown on the payment portal.
                    </p>
                  </div>
                  <span className="text-[10px] uppercase font-bold tracking-[0.2em] text-[var(--pp-secondary)] px-3 py-1 rounded-full bg-[var(--pp-secondary)]/10 border border-[var(--pp-secondary)]/20">Merchant</span>
                </div>
                <TipSettings />
              </div>
            )}

            {activeTab === "offramp" && (
              <div className="space-y-6 md:space-y-8 w-full">
                <OfframpPanel />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
