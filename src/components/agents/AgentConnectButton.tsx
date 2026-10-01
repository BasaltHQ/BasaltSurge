"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { ConnectButton } from "thirdweb/react";
import { chain, getWallets } from "@/lib/thirdweb/client";
import { useThirdwebClient } from "@/hooks/useThirdwebClient";

type Props = Omit<ComponentProps<typeof ConnectButton>, "client" | "chain" | "wallets" | "accountAbstraction">;

// Both agent entry points must use the same project AND EIP-4337 wallet mode.
// Thirdweb's default in-app wallet exposes the personal address instead.
export default function AgentConnectButton(props: Props) {
    const client = useThirdwebClient();
    const [loaded, setLoaded] = useState<{ clientId: string; wallets: Awaited<ReturnType<typeof getWallets>> } | null>(null);
    const [error, setError] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setError(false);
        getWallets().then((wallets) => {
            if (!cancelled) setLoaded({ clientId: client.clientId, wallets });
        }).catch(() => {
            if (!cancelled) setError(true);
        });
        return () => { cancelled = true; };
    }, [client, attempt]);

    if (error) {
        return <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry wallet connection</button>;
    }
    if (!loaded?.wallets.length || loaded.clientId !== client.clientId) {
        return <span role="status" className="text-sm text-muted-foreground">Loading wallet connection…</span>;
    }
    return <ConnectButton key={client.clientId} {...props} client={client} chain={chain} wallets={loaded.wallets} />;
}
