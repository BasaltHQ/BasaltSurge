"use client";

import React, { useState } from "react";
import {
  FileText,
  Camera,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ShieldCheck,
  Upload,
  User,
  Sparkles,
} from "lucide-react";

export interface SimulatedStripeIdentityElementProps {
  isLightText?: boolean;
  primaryColor?: string;
  simulatedError?: string;
  onSuccess: () => void;
  onError: (msg: string) => void;
}

export function SimulatedStripeIdentityElement({
  isLightText = true,
  primaryColor = "#635BFF",
  simulatedError = "none",
  onSuccess,
  onError,
}: SimulatedStripeIdentityElementProps) {
  const [docType, setDocType] = useState<"dl" | "passport" | "id">("dl");
  const [stage, setStage] = useState<"select" | "capturing" | "verifying" | "approved">("select");
  const [progressMsg, setProgressMsg] = useState("");

  const handleStartVerification = () => {
    setStage("capturing");
    setTimeout(() => {
      setStage("verifying");
      setProgressMsg("Uploading encrypted documents to Stripe Identity...");
      setTimeout(() => {
        setProgressMsg("Scanning barcode & verifying security holograms...");
        setTimeout(() => {
          setProgressMsg("Facial matching selfie to government ID (99.4% confidence)...");
          setTimeout(() => {
            if (simulatedError === "kyc_rejection") {
              const err = "Stripe Identity Rejection: Document could not be authenticated. Please submit an unexpired government ID.";
              setStage("select");
              onError(err);
              return;
            }
            setStage("approved");
            setTimeout(() => {
              onSuccess();
            }, 800);
          }, 1000);
        }, 1000);
      }, 1000);
    }, 1200);
  };

  return (
    <div
      className={`p-4 rounded-2xl border transition-all duration-300 ${
        isLightText
          ? "bg-[#0c0a17] border-purple-500/30 text-white shadow-2xl"
          : "bg-white border-purple-500/30 text-black shadow-xl"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
        <div className="flex items-center gap-2">
          <div className="h-6 px-2.5 rounded-lg bg-purple-600 text-white font-black text-[11px] tracking-tight flex items-center shadow-sm">
            <span>stripe</span>
          </div>
          <span className="text-xs font-bold text-purple-300 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Identity Verification
          </span>
        </div>
        <div className="text-[10px] text-purple-300/80 font-mono">Level 2 (L2) Compliance</div>
      </div>

      {stage === "select" && (
        <div className="space-y-3 text-left">
          <p className="text-xs font-medium opacity-90">
            Select document type for simulated identity verification:
          </p>

          <div className="grid grid-cols-3 gap-2">
            {[
              { id: "dl", label: "Driver's License" },
              { id: "passport", label: "Passport" },
              { id: "id", label: "State ID" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setDocType(item.id as any)}
                className={`py-2 px-1.5 rounded-xl border text-[11px] font-bold text-center transition cursor-pointer ${
                  docType === item.id
                    ? "bg-purple-600 border-purple-400 text-white shadow-md"
                    : "bg-white/5 border-white/10 text-zinc-400 hover:text-white"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Document Upload Preview Box */}
          <div className="p-4 rounded-xl border border-dashed border-purple-400/40 bg-purple-500/5 flex flex-col items-center justify-center gap-2 text-center my-2">
            <Upload className="w-6 h-6 text-purple-400 animate-pulse" />
            <div className="text-xs font-bold text-purple-200">
              Front & Back ID Capture
            </div>
            <p className="text-[10.5px] opacity-70">
              Simulates high-resolution camera scan with encrypted biometric verification.
            </p>
          </div>

          <button
            type="button"
            onClick={handleStartVerification}
            className="w-full h-11 rounded-xl font-bold text-xs bg-purple-600 hover:bg-purple-500 text-white transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer active:scale-95"
          >
            <Camera className="w-4 h-4" />
            <span>Simulate Stripe ID Capture & Verification</span>
          </button>
        </div>
      )}

      {stage === "capturing" && (
        <div className="py-6 flex flex-col items-center justify-center space-y-3 text-center">
          <Camera className="w-8 h-8 text-purple-400 animate-bounce" />
          <p className="text-xs font-bold text-purple-200">Capturing Photo ID & Live Biometric Selfie...</p>
        </div>
      )}

      {stage === "verifying" && (
        <div className="py-6 flex flex-col items-center justify-center space-y-3 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
          <div className="space-y-1">
            <p className="text-xs font-bold text-purple-200">Stripe Compliance Engine Running</p>
            <p className="text-[11px] text-purple-300/80 font-mono animate-pulse">{progressMsg}</p>
          </div>
        </div>
      )}

      {stage === "approved" && (
        <div className="py-6 flex flex-col items-center justify-center space-y-3 text-center animate-in zoom-in-95">
          <CheckCircle2 className="w-10 h-10 text-emerald-400 animate-bounce" />
          <div className="space-y-1">
            <p className="text-xs font-bold text-emerald-300 uppercase tracking-wider">
              Identity Verification Approved!
            </p>
            <p className="text-[11px] text-emerald-400/80">Advancing to payment selection...</p>
          </div>
        </div>
      )}
    </div>
  );
}
