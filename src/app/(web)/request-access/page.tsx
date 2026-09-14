"use client";

import { useRouter } from "next/navigation";
import { SignupWizard } from "@/components/signup-wizard";

export default function RequestAccessPage() {
    const router = useRouter();
    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-black">
            <SignupWizard isOpen inline onClose={() => router.push("/")} onComplete={() => router.push("/admin")} />
        </div>
    );
}
