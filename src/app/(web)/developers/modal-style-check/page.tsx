"use client";

import { useEffect, useState } from "react";
import { AccessPendingModal } from "@/components/access-pending-modal";
import { AuthModal } from "@/components/auth-modal";

export default function ModalStyleCheck() {
  const [modal, setModal] = useState("pending");
  useEffect(() => {
    document.body.classList.add("with-landing-navbar");
    return () => document.body.classList.remove("with-landing-navbar");
  }, []);
  return <main style={{ padding: 160 }}>
    <button onClick={() => setModal("pending")}>Preview pending</button>
    <button onClick={() => setModal("auth")}>Preview auth</button>
    <AccessPendingModal isOpen={modal === "pending"} hasPendingApplication onClose={() => setModal("")} onOpenApplication={() => {}} />
    <AuthModal isOpen={modal === "auth"} onClose={() => setModal("")} onSuccess={() => {}} onError={() => {}} />
  </main>;
}
