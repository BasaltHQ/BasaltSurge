"use client";

import React from "react";
import { usePathname } from "next/navigation";
import GlobalSplitGuard from "@/components/global-split-guard";
import { isWorkshopPath } from '@/lib/routing';

/**
 * SplitGuardMount
 * - Client-only wrapper that conditionally mounts GlobalSplitGuard
 * - Suppresses the split setup modal on buyer-facing receipt portal pages
 */
function shouldSuppressForPath(path: string): boolean {
  try {
    const p = (path || "/").toLowerCase();
    if (isWorkshopPath(p)) return true;
    // Suppress on buyer receipt portal pages, agent pages, apply page, and legal documents
    if (p.startsWith("/portal") || p.startsWith("/agents") || p.startsWith("/legal") || p.startsWith("/apply") || p.startsWith("/delivers") || p.startsWith("/drive")) return true;
    return false;
  } catch {
    return false;
  }
}

export default function SplitGuardMount() {
  const pathname = usePathname() || "/";
  const suppress = shouldSuppressForPath(pathname);

  if (suppress) return null;
  return <GlobalSplitGuard />;
}
