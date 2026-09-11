"use client";

import React, { Suspense } from "react";
import dynamic from "next/dynamic";
import LandingPageSkeleton from "@/components/landing/LandingPageSkeleton";

// Dynamically import home content with SSR disabled to avoid ThirdwebProvider context issues
const HomeContent = dynamic(() => import("@/components/landing/home-content"), {
  ssr: false,
  loading: () => <LandingPageSkeleton />,
});

export default function GetStartedPage() {
  return (
    <Suspense fallback={<LandingPageSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}
