"use client";

import React, { useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import LandingPageSkeleton from "@/components/landing/LandingPageSkeleton";

// Dynamically import home content with SSR disabled to avoid ThirdwebProvider context issues
const HomeContent = dynamic(() => import("@/components/landing/home-content"), {
  ssr: false,
  loading: () => <LandingPageSkeleton />,
});

function HomeWithRedirect() {
  const searchParams = useSearchParams();
  const shop = searchParams.get("shop");
  const host = searchParams.get("host");

  useEffect(() => {
    if (shop) {
      const brandKey = searchParams.get("brandKey") || "basaltsurge";
      window.location.href = `/shopify/settings?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host || "")}&brandKey=${encodeURIComponent(brandKey)}`;
    }
  }, [shop, host, searchParams]);

  if (shop) {
    return <LandingPageSkeleton />;
  }

  return <HomeContent />;
}

export default function Home() {
  return (
    <Suspense fallback={<LandingPageSkeleton />}>
      <HomeWithRedirect />
    </Suspense>
  );
}
