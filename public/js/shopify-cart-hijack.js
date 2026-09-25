/** Cart payment option. The legacy filename is retained for installed ScriptTags. */
(function () {
  "use strict";
  if (window.__surgeCartPayment) return;
  window.__surgeCartPayment = true;

  const source = document.currentScript;
  const sourceUrl = source && source.src;
  function start() {
    const config = document.querySelector("[data-surge-cart-config]");
    let gateway;
    try {
      gateway = new URL(config ? config.dataset.gateway : sourceUrl).origin;
      if (!gateway.startsWith("https://")) return;
    } catch { return; }
    const label = (config && config.dataset.buttonLabel) ||
      (new URL(gateway).hostname === "surge.basalthq.com" ? "Pay with Surge" : "Pay with PortalPay");
    const shop = (config && config.dataset.shop) || (window.Shopify && window.Shopify.shop);
    const cartRoot = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
    const placements = new Map();
    let busy = false;
    let observer;
    let queued = false;

    // App embeds load this same stylesheet through their schema.
    if (!config) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = gateway + "/css/shopify-cart-payment.css";
      document.head.appendChild(css);
    }

    function checkoutControls() {
      return Array.from(document.querySelectorAll(
        'button[name="checkout"], input[name="checkout"], a[href], button#checkout'
      )).filter(function (control) {
        if (control.tagName !== "A") return true;
        try {
          const url = new URL(control.href, window.location.href);
          return url.origin === window.location.origin && /\/(?:checkout|checkouts)\/?$/.test(url.pathname);
        } catch { return false; }
      });
    }

    function render() {
      queued = false;
      if (observer) observer.disconnect();
      for (const [anchor, view] of placements) {
        if (!anchor.isConnected || !view.wrapper.isConnected) {
          view.wrapper.remove();
          placements.delete(anchor);
        }
      }
      for (const anchor of checkoutControls()) {
        let view = placements.get(anchor);
        if (!view) {
          const wrapper = document.createElement("div");
          wrapper.className = "surge-cart-payment";
          const button = document.createElement("button");
          button.type = "button";
          button.className = "surge-cart-payment__button";
          button.dataset.surgePayment = "true";
          button.textContent = label;
          const message = document.createElement("p");
          message.className = "surge-cart-payment__message";
          message.setAttribute("role", "alert");
          message.hidden = true;
          wrapper.appendChild(button);
          wrapper.appendChild(message);
          anchor.insertAdjacentElement("afterend", wrapper);
          view = { wrapper, button, message };
          placements.set(anchor, view);
        }
        view.button.disabled = busy || anchor.disabled || anchor.getAttribute("aria-disabled") === "true";
        view.button.textContent = busy ? "Opening secure payment…" : label;
        view.button.setAttribute("aria-busy", String(busy));
      }
      if (observer) observer.observe(document.body, {
        childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "aria-disabled"]
      });
    }

    document.addEventListener("click", async function (event) {
      const button = event.target.closest && event.target.closest("[data-surge-payment]");
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (busy || button.disabled) return;
      busy = true;
      for (const view of placements.values()) { view.message.hidden = true; view.message.textContent = ""; }
      render();
      const controller = new AbortController();
      const timeout = window.setTimeout(function () { controller.abort(); }, 25000);
      try {
        if (!shop) throw new Error("Missing shop");
        const cartResponse = await fetch(cartRoot.replace(/\/?$/, "/") + "cart.js", {
          credentials: "same-origin", cache: "no-store", signal: controller.signal
        });
        if (!cartResponse.ok) throw new Error("Cart unavailable");
        const cart = await cartResponse.json();
        if (!Array.isArray(cart.items) || !cart.items.length || cart.total_price <= 0) {
          throw new Error("Empty cart");
        }
        const response = await fetch(gateway + "/api/shopify/create-order", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ cart, shop, domain: window.location.hostname })
        });
        if (!response.ok) throw new Error("Payment unavailable");
        const data = await response.json();
        const paymentUrl = new URL(data.paymentUrl);
        if (paymentUrl.protocol !== "https:" || paymentUrl.username || paymentUrl.password) {
          throw new Error("Invalid payment URL");
        }
        window.location.assign(paymentUrl.href);
      } catch (error) {
        busy = false;
        render();
        for (const view of placements.values()) {
          view.message.textContent = "We couldn’t open payment. Your cart is saved. Please try again.";
          view.message.hidden = false;
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }, true);

    if (window.MutationObserver) {
      observer = new MutationObserver(function () {
        if (queued) return;
        queued = true;
        window.requestAnimationFrame(render);
      });
    }
    render();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
