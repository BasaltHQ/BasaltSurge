const test = require("node:test");
const assert = require("node:assert/strict");

// Test the core brand resolution and matching logic implemented in route.tsx
function evaluatePartnerAccess({ merchantDocs, sampleReceiptsCount = 0, containerType = "partner", brandKey = "payzentric" }) {
    const isPlatformBrandKey = (k) => !k || k === "portalpay" || k === "basaltsurge";

    const merchantBrandKeys = new Set();
    for (const doc of merchantDocs || []) {
        const bk = String(doc.brandKey || doc.theme?.brandKey || doc.config?.brandKey || "").trim().toLowerCase();
        if (bk) merchantBrandKeys.add(bk);
    }

    if (brandKey && !merchantBrandKeys.has(brandKey) && sampleReceiptsCount > 0) {
        merchantBrandKeys.add(brandKey);
    }

    let effectiveMerchantBrand = "";
    if (brandKey && merchantBrandKeys.has(brandKey)) {
        effectiveMerchantBrand = brandKey;
    } else {
        const siteDoc = merchantDocs.find((d) => d.type === "site_config" && (d.brandKey || d.theme?.brandKey));
        const splitDoc = merchantDocs.find((d) => d.type === "split_index" && d.brandKey);
        const shopDoc = merchantDocs.find((d) => d.type === "shop_config" && (d.brandKey || d.theme?.brandKey));
        const reqDoc = merchantDocs.find((d) => d.type === "client_request" && d.brandKey);
        effectiveMerchantBrand = String(
            siteDoc?.brandKey || siteDoc?.theme?.brandKey ||
            splitDoc?.brandKey ||
            shopDoc?.brandKey || shopDoc?.theme?.brandKey ||
            reqDoc?.brandKey ||
            Array.from(merchantBrandKeys)[0] || ""
        ).toLowerCase();
    }

    if (containerType === "partner") {
        if (!brandKey) {
            return { allowed: false, status: 500, error: "Configuration error" };
        }

        const brandMatches = merchantBrandKeys.has(brandKey) ||
            (isPlatformBrandKey(brandKey) ? (merchantBrandKeys.size === 0 || Array.from(merchantBrandKeys).some(isPlatformBrandKey)) : false) ||
            Array.from(merchantBrandKeys).some(isPlatformBrandKey);

        if (!brandMatches) {
            return { allowed: false, status: 403, error: "Unauthorized for this brand" };
        }
    }

    return { allowed: true, effectiveMerchantBrand };
}

test("Multi-brand merchant with payzentric and data-opt is allowed on payzentric partner container", () => {
    // Replicates wallet 0xd4057b535aa60018231f0dd22be3eb07949be3c3 from production logs
    const merchantDocs = [
        { id: "site:config:data-opt", type: "site_config", brandKey: "data-opt" },
        { id: "site:config", type: "site_config", brandKey: "payzentric" },
        { id: "shop:config:data-opt", type: "shop_config", brandKey: "data-opt" },
        { id: "shop:config:payzentric", type: "shop_config", brandKey: "payzentric" },
        { id: "client_request:123", type: "client_request", brandKey: "payzentric" },
    ];

    const result = evaluatePartnerAccess({
        merchantDocs,
        containerType: "partner",
        brandKey: "payzentric",
    });

    assert.equal(result.allowed, true);
    assert.equal(result.effectiveMerchantBrand, "payzentric");
});

test("Multi-brand merchant with xoinpay and payzentric is allowed on payzentric partner container", () => {
    // Replicates wallet 0x2f2ce02f7cdbb6922c6d276043f5b17427ec31e9 from production logs
    const merchantDocs = [
        { id: "client_request:abc", type: "client_request", brandKey: "xoinpay" },
        { id: "shop:config:xoinpay", type: "shop_config", brandKey: "xoinpay" },
        { id: "site:config:xoinpay", type: "site_config", brandKey: "xoinpay" },
        { id: "site:config:payzentric", type: "site_config", brandKey: "payzentric" },
    ];

    const result = evaluatePartnerAccess({
        merchantDocs,
        containerType: "partner",
        brandKey: "payzentric",
    });

    assert.equal(result.allowed, true);
    assert.equal(result.effectiveMerchantBrand, "payzentric");
});

test("Merchant belonging ONLY to another partner brand is blocked with 403 Unauthorized for this brand", () => {
    const merchantDocs = [
        { id: "site:config:competitor", type: "site_config", brandKey: "competitor" },
        { id: "shop:config:competitor", type: "shop_config", brandKey: "competitor" },
    ];

    const result = evaluatePartnerAccess({
        merchantDocs,
        containerType: "partner",
        brandKey: "payzentric",
    });

    assert.equal(result.allowed, false);
    assert.equal(result.status, 403);
    assert.equal(result.error, "Unauthorized for this brand");
});

test("Platform default merchant (portalpay/basaltsurge) is allowed as trusted cross-brand merchant", () => {
    const merchantDocs = [
        { id: "site:config:bs", type: "site_config", brandKey: "basaltsurge" },
        { id: "shop:config:bs", type: "shop_config", brandKey: "basaltsurge" },
    ];

    const result = evaluatePartnerAccess({
        merchantDocs,
        containerType: "partner",
        brandKey: "payzentric",
    });

    assert.equal(result.allowed, true);
});

test("Merchant with brandKey in theme.brandKey or config.brandKey is correctly resolved", () => {
    const merchantDocs = [
        { id: "shop:config:custom", type: "shop_config", theme: { brandKey: "payzentric" } },
        { id: "site:config:custom", type: "site_config", config: { brandKey: "payzentric" } },
    ];

    const result = evaluatePartnerAccess({
        merchantDocs,
        containerType: "partner",
        brandKey: "payzentric",
    });

    assert.equal(result.allowed, true);
    assert.equal(result.effectiveMerchantBrand, "payzentric");
});

test("Merchant with matching receipts on partner container is allowed via receipt fallback", () => {
    const merchantDocs = [
        { id: "legacy:config", type: "site_config" }, // no brandKey
    ];

    const result = evaluatePartnerAccess({
        merchantDocs,
        sampleReceiptsCount: 5,
        containerType: "partner",
        brandKey: "payzentric",
    });

    assert.equal(result.allowed, true);
    assert.equal(result.effectiveMerchantBrand, "payzentric");
});
