"use client";

import React from "react";
import { useActiveAccount } from "thirdweb/react";
import { useBrand } from "@/contexts/BrandContext";
import PlatformAnalyticsPanel from "./PlatformAnalyticsPanel";

export default function PartnerAnalyticsPanel() {
  const account = useActiveAccount();
  const brand = useBrand();
  const wallet = String(account?.address || "").trim().toLowerCase();
  const brandKey = String(brand.key || "").trim().toLowerCase();

  if (!brandKey || ["basaltsurge", "portalpay", "global", "all"].includes(brandKey)) {
    return (
      <div className="glass-pane rounded-2xl border p-6" role="status">
        <h1 className="text-2xl font-semibold">Partner Analytics</h1>
        <p className="mt-2 text-sm text-muted-foreground">Open this panel from your partner brand to view its analytics.</p>
      </div>
    );
  }

  return <PlatformAnalyticsPanel key={`${brandKey}:${wallet}`} audience="partner" brandKey={brandKey} brandName={brand.name} />;
}
