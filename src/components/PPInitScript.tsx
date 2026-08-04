"use client";

import { useServerInsertedHTML } from "next/navigation";

interface PPInitScriptProps {
  domains?: Record<string, string>;
}

export function PPInitScript({ domains }: PPInitScriptProps) {
  useServerInsertedHTML(() => {
    return (
      <>
        <script
          id="pp-thirdweb-init"
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var bk = document.documentElement.getAttribute('data-pp-brand-key') || 'basaltsurge';
                  var match = document.cookie.match(new RegExp('(^| )pp_tw_client_id_' + bk + '=([^;]+)'));
                  var cached = match ? match[2] : null;
                  if (!cached) {
                    cached = localStorage.getItem('pp-thirdweb-client-id:' + bk);
                  }
                  if (cached) {
                    document.documentElement.setAttribute('data-pp-thirdweb-client-id', cached);
                  }
                } catch(e) {}
              })();
            `,
          }}
        />
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
