# Branding & Whitelabel Customization

This guide details how white-label partners configure their visual identity, upload brand assets, and propagate custom CSS themes across their merchant network.

---

## 1. Configuring Brand Logos

Under the **Branding** tab in the Partner/Admin sidebar, you can upload and manage three distinct brand logo files:

1.  **Symbol Logo**: A 1:1 square icon (e.g., `36x36px` or similar). This is used in the collapsed admin sidebar, small receipt headers, and mobile navigation headers.
2.  **Favicon**: The small icon displayed in the browser tab title bar (standard `.ico` or `.png`).
3.  **App Logo**: A wide landscape logo (e.g., `180x36px`). This is used in the expanded admin header, large invoice layouts, and the shopper checkout portal banner.

> [!TIP]
> Use transparent WebP or PNG format files for logos to ensure they render smoothly across dark and glassmorphism backgrounds.

---

## 2. Setting CSS Theme Variables

You can customize color presets directly in the Branding Panel. These values inject custom styling configurations dynamically:

*   **Primary Color (`--pp-primary`)**: The accent color used for primary buttons, active tabs, and highlights.
*   **Secondary Color (`--pp-secondary`)**: The accent color used for secondary actions, borders, and glowing button shadows.
*   **Background Gradients**: Set up dark gradients (e.g., standard `#000000` to HSL deep blue/purple hues) to customize background ambients.

---

## 3. Brand Propagation

Once branding settings are saved, the system compiles the config overrides. The styling propagates to these surfaces:

*   **Shopper Portal (`/portal/<receiptId>`)**: Customers checkout on a page styled with your app logo, primary accent colors, and custom favicon.
*   **Receipt Details**: On-chain receipt listings, invoice prints, and QR code modal headers display your symbol logo and brand name.
*   **Merchant Dashboards**: Onboarded merchants operate within a console carrying your partner branding (expanded sidebar logos, chimes, and theme highlights).
*   **Email Confirmations**: Customer emails carry the branded logo and custom sender headers.
