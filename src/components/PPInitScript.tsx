"use client";

import { useServerInsertedHTML } from "next/navigation";

interface PPInitScriptProps {
  domains?: Record<string, string>;
}

export function PPInitScript({ domains }: PPInitScriptProps) {
  useServerInsertedHTML(() => {
    return (
      <>
        {domains && (
          <script
            id="dynamic-domains"
            dangerouslySetInnerHTML={{
              __html: `window.__DYNAMIC_DOMAINS__ = ${JSON.stringify(domains)};`,
            }}
          />
        )}
        <script
          id="pp-init"
          src="/pp-init.js"
        />
      </>
    );
  });
  return null;
}
