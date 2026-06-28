/**
 * Shopify Cart Checkout Hijack Script
 * Automatically intercepts checkout button clicks and routes them to the payment gateway.
 */
(function() {
  // Determine brand dynamically from hostname or script source origin
  const scriptEl = document.currentScript || document.querySelector('script[src*="shopify-cart-hijack.js"]');
  let backendHost = "";
  if (scriptEl && scriptEl.src) {
    try {
      backendHost = new URL(scriptEl.src).origin;
    } catch {}
  }
  if (!backendHost) {
    backendHost = window.location.origin; // fallback
  }
  const isPlatform = backendHost.includes("basaltsurge") || backendHost.includes("surge");
  const brandName = isPlatform ? "BasaltSurge" : "PortalPay";

  console.log(`[${brandName}] Shopify Cart Hijack active.`);

  // Run initialization on load and when DOM changes
  function init() {
    const buttons = document.querySelectorAll(
      'input[name="checkout"], button[name="checkout"], form[action="/cart"] button[type="submit"], .cart__submit, .checkout-button'
    );
    
    buttons.forEach(btn => {
      if (btn.dataset.portalpayAttached) return;
      btn.dataset.portalpayAttached = "true";
      
      btn.addEventListener("click", function(e) {
        // Intercept standard checkout redirection
        e.preventDefault();
        e.stopPropagation();
        
        console.log(`[${brandName}] Checkout intercepted. Processing cart...`);
        
        // Show loading state if button has text/value
        const originalText = btn.tagName === 'INPUT' ? btn.value : btn.textContent;
        const setBtnText = (t) => {
          if (btn.tagName === 'INPUT') btn.value = t;
          else btn.textContent = t;
        };
        setBtnText("Processing Payment...");
        btn.disabled = true;

        fetch("/cart.js")
          .then(res => {
            if (!res.ok) throw new Error("Failed to fetch cart");
            return res.json();
          })
          .then(cart => {
            const shop = (window.Shopify && window.Shopify.shop) || window.location.hostname;
            return fetch(`${backendHost}/api/shopify/create-order`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                cart,
                shop,
                domain: window.location.hostname
              })
            });
          })
          .then(res => {
            if (!res.ok) return res.json().then(err => { throw new Error(err.message || "Checkout generation failed"); });
            return res.json();
          })
          .then(data => {
            if (data?.paymentUrl) {
              console.log(`[${brandName}] Redirecting to Checkout:`, data.paymentUrl);
              window.location.href = data.paymentUrl;
            } else {
              throw new Error("Missing payment URL in response");
            }
          })
          .catch(err => {
            console.error(`[${brandName}] Checkout intercept error:`, err);
            // Fallback: Proceed with standard Shopify checkout if our server fails
            setBtnText(originalText);
            btn.disabled = false;
            
            // Standard action fallback
            const form = btn.closest("form");
            if (form) {
              // Add hidden input checkout to bypass standard event handler
              const input = document.createElement("input");
              input.type = "hidden";
              input.name = "checkout";
              input.value = "1";
              form.appendChild(input);
              form.submit();
            } else {
              window.location.href = "/checkout";
            }
          });
      });
    });
  }

  // Monitor DOM for dynamically loaded carts (e.g. drawer carts)
  if (window.MutationObserver) {
    const observer = new MutationObserver(() => init());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Initial runs
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
