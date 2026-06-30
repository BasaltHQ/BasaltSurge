"use client";

import { useState, useEffect } from "react";
import { getClient } from "@/lib/thirdweb/client";
import { createThirdwebClient } from "thirdweb";

export function useThirdwebClient(): ReturnType<typeof createThirdwebClient> {
  const [activeClient, setActiveClient] = useState(() => getClient());

  useEffect(() => {
    const handleUpdate = () => {
      setActiveClient(getClient());
    };
    window.addEventListener("pp:thirdweb-client-id:updated", handleUpdate);
    return () => {
      window.removeEventListener("pp:thirdweb-client-id:updated", handleUpdate);
    };
  }, []);

  return activeClient;
}
