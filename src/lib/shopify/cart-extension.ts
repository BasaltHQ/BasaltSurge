import * as fs from "node:fs/promises";
import * as path from "node:path";

type CartExtensionConfig = { name: string; brandKey: string; applicationUrl: string };

/** Public assets only: the cart calls our backend, which retains all merchant credentials. */
export async function generateCartExtensionFiles(config: CartExtensionConfig): Promise<Record<string, string>> {
  const origin = new URL(config.applicationUrl).origin;
  if (!origin.startsWith("https://")) throw new Error("The Shopify cart payment gateway must use HTTPS.");
  const label = config.brandKey === "basaltsurge" ? "Pay with Surge" : `Pay with ${config.name}`;
  const schema = {
    name: "Cart payment option", target: "body",
    javascript: "surge-cart-payment.js", stylesheet: "surge-cart-payment.css",
    settings: [
      { type: "text", id: "button_label", label: "Button label", default: label },
      { type: "paragraph", content: "Shows a payment option beside Checkout on the cart page and in supported cart drawers." }
    ]
  };
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const [script, css] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "public/js/shopify-cart-hijack.js"), "utf8"),
    fs.readFile(path.join(process.cwd(), "public/css/shopify-cart-payment.css"), "utf8")
  ]);
  return {
    "extensions/cart-payment/shopify.extension.toml": 'name = "Cart payment option"\ntype = "theme"\n',
    "extensions/cart-payment/locales/en.default.json": "{}\n",
    "extensions/cart-payment/blocks/cart-payment.liquid": `<div hidden data-surge-cart-config
  data-gateway="${escape(origin)}"
  data-shop="{{ shop.permanent_domain | escape }}"
  data-button-label="{{ block.settings.button_label | escape }}"></div>
{% schema %}
${JSON.stringify(schema, null, 2).replace(/</g, "\\u003c")}
{% endschema %}
`,
    "extensions/cart-payment/assets/surge-cart-payment.js": script,
    "extensions/cart-payment/assets/surge-cart-payment.css": css
  };
}
