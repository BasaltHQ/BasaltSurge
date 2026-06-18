"use client";

import { useServerInsertedHTML } from "next/navigation";

export function PPInitScript() {
  useServerInsertedHTML(() => {
    return (
      <script
        id="pp-init"
        src="/pp-init.js"
      />
    );
  });
  return null;
}
