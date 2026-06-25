'use client';

import React, { useState } from 'react';
import { Copy, Check, Sparkles } from 'lucide-react';

interface CopyForLlmButtonProps {
  content: string;
  pageTitle: string;
}

export function CopyForLlmButton({ content, pageTitle }: CopyForLlmButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      const promptReadyText = `Below is the official developer documentation page for "${pageTitle}" from our payment checkout system. Use this documentation context to implement the required code:

<documentation_page title="${pageTitle}">
${content}
</documentation_page>`;
      await navigator.clipboard.writeText(promptReadyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`
        relative overflow-hidden flex items-center gap-2.5 px-4 py-2 rounded-lg text-xs font-bold tracking-wide uppercase transition-all duration-300 active:scale-95 group
        ${copied 
          ? 'bg-emerald-500 text-white border border-emerald-600 shadow-[0_0_15px_rgba(16,185,129,0.4)]' 
          : 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white border border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.3)] hover:shadow-[0_0_20px_rgba(99,102,241,0.5)]'
        }
      `}
      title="Copy page content formatted for LLM prompts"
    >
      {/* Background radial gradient glow on hover */}
      <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-primary/10 via-transparent to-primary/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 animate-bounce text-white" />
          <span>Copied for LLM!</span>
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5 group-hover:scale-110 transition-transform duration-200" />
          <span>Copy for LLM</span>
          <Sparkles className="w-3 h-3 text-amber-300 animate-pulse group-hover:rotate-12 transition-transform" />
        </>
      )}
    </button>
  );
}
