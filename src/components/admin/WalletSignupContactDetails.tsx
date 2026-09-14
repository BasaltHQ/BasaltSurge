"use client";

import { useEffect, useState } from "react";
import type { WalletSignupContact } from "@/lib/thirdweb/wallet-signup-contact";

export function WalletSignupContactDetails({ requestId, brandKey }: {
    requestId: string;
    brandKey: string;
}) {
    const [contact, setContact] = useState<WalletSignupContact>();
    const [recordedAtSubmission, setRecordedAtSubmission] = useState(false);
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        setStatus("loading");
        setContact(undefined);
        setRecordedAtSubmission(false);
        const params = new URLSearchParams({ brandKey, walletContactRequestId: requestId });
        fetch(`/api/partner/client-requests?${params}`, { credentials: "include", cache: "no-store", signal: controller.signal })
            .then(async response => {
                if (!response.ok) throw new Error("lookup_failed");
                const data = await response.json();
                if (!controller.signal.aborted) {
                    setContact(data.contact || undefined);
                    setRecordedAtSubmission(data.recordedAtSubmission === true);
                    setStatus("ready");
                }
            })
            .catch(() => { if (!controller.signal.aborted) setStatus("error"); });
        return () => controller.abort();
    }, [requestId, brandKey, attempt]);

    return (
        <div className="mt-3 border-t border-white/10 pt-3 space-y-2">
            <h5 className="text-xs font-semibold">Wallet Sign-up Contact</h5>
            {status === "loading" ? <p className="text-xs text-muted-foreground">Looking up wallet contact...</p>
                : status === "error" ? <div className="text-xs text-muted-foreground">Wallet contact lookup unavailable. <button type="button" className="underline" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>
                : !contact ? <p className="text-xs text-muted-foreground">No sign-up email or phone is available from the wallet provider.</p>
                : <>
                    {contact.email && <div className="grid grid-cols-[80px_1fr] gap-2 text-sm"><span className="text-muted-foreground">Email</span><a className="break-all select-all hover:underline" href={`mailto:${contact.email}`}>{contact.email}</a></div>}
                    {contact.phone && <div className="grid grid-cols-[80px_1fr] gap-2 text-sm"><span className="text-muted-foreground">Phone</span><a className="break-all select-all hover:underline" href={`tel:${contact.phone}`}>{contact.phone}</a></div>}
                    <p className="text-xs text-muted-foreground">From Thirdweb&apos;s wallet record{recordedAtSubmission ? " at application submission" : " (current lookup)"}.</p>
                </>}
        </div>
    );
}
