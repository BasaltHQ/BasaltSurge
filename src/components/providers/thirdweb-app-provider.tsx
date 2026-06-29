import React, { useState, useEffect } from "react";
import { ThirdwebProvider } from "thirdweb/react";
import { getResolvedClientId } from "@/lib/thirdweb/client";

export function ThirdwebAppProvider({ children }: { children: React.ReactNode }) {
  const [clientId, setClientId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      try {
        return getResolvedClientId();
      } catch { }
    }
    return "";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && typeof customEvent.detail === "string") {
        setClientId(customEvent.detail);
      }
    };

    window.addEventListener("pp:thirdweb-client-id:updated", handleUpdate);
    return () => {
      window.removeEventListener("pp:thirdweb-client-id:updated", handleUpdate);
    };
  }, []);

  return (
    <ThirdwebProvider key={clientId}>
      {children}
    </ThirdwebProvider>
  );
}
