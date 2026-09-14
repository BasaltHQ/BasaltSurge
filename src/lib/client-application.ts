export type ApplicationIssue = { field: string; message: string; step: 1 | 2 };

/** Keep provider identity details out of the normal application-list payload. */
export function withoutWalletSignupIdentity(input: Record<string, any>): Record<string, any> {
    const output = { ...input };
    delete output.walletSignupContact;
    delete output.walletSignerAddress;
    return output;
}

const requiredFields = [
    ["legalBusinessName", "Legal Business Name", 1],
    ["shopName", "DBA / Shop Name", 1],
    ["businessType", "Business Type", 1],
    ["ein", "Tax ID / SSN", 1],
    ["phone", "Phone Number", 1],
    ["website", "Website", 1],
    ["businessAddress.street", "Street Address", 1],
    ["businessAddress.city", "City", 1],
    ["businessAddress.state", "State / Province", 1],
    ["businessAddress.zip", "ZIP / Postal Code", 1],
    ["businessAddress.country", "Country", 1],
    ["logoUrl", "Business Logo", 1],
    ["notes", "Notes / Description", 1],
    ["slug", "Shop Slug", 2],
    ["shopLogoUrl", "Shop Logo", 2],
    ["faviconUrl", "Favicon", 2],
    ["primaryColor", "Primary Color", 2],
    ["secondaryColor", "Secondary Color", 2],
    ["layoutMode", "Layout Style", 2],
    ["description", "Shop Description", 2],
] as const;

/** Shared by both wizard steps and the submission API. */
export function validateClientApplication(input: unknown, step?: 1 | 2): ApplicationIssue[] {
    const data = (input && typeof input === "object" ? input : {}) as Record<string, any>;
    const issues: ApplicationIssue[] = [];
    for (const [field, label, fieldStep] of requiredFields) {
        if (step && fieldStep !== step) continue;
        const value: unknown = field.split(".").reduce<any>((obj, key) => obj?.[key], data);
        if (typeof value !== "string" || !value.trim()) {
            issues.push({ field, message: `${label} is required.`, step: fieldStep });
        }
    }
    const check = (field: string, valid: boolean, message: string, fieldStep: 1 | 2) => {
        if ((!step || step === fieldStep) && !issues.some(issue => issue.field === field) && !valid) {
            issues.push({ field, message, step: fieldStep });
        }
    };
    check("ein", /^\d{9}$/.test(String(data.ein || "").replace(/[- ]/g, "")), "Tax ID / SSN must contain 9 digits.", 1);
    check("phone", /^\+?[\d\s().-]+$/.test(data.phone || "") && String(data.phone || "").replace(/\D/g, "").length >= 10, "Enter a complete phone number.", 1);
    check("businessAddress.country", /^[a-z]{2}$/i.test(data.businessAddress?.country || ""), "Enter a two-letter country code.", 1);
    check("businessType", ["llc", "corp", "sole_prop", "partnership"].includes(data.businessType), "Select a business type.", 1);
    let validWebsite = false;
    try {
        const value = String(data.website || "").trim();
        const url = new URL(value.includes("://") ? value : `https://${value}`);
        validWebsite = ["http:", "https:"].includes(url.protocol) && url.hostname.includes(".");
    } catch { /* Report invalid websites below. */ }
    check("website", validWebsite, "Enter a valid website address.", 1);
    check("slug", /^[a-z0-9][a-z0-9-]{1,}$/.test(data.slug || ""), "Shop Slug must contain at least 2 lowercase letters, numbers, or hyphens and start with a letter or number.", 2);
    for (const field of ["primaryColor", "secondaryColor"]) {
        check(field, /^#[0-9a-f]{6}$/i.test(data[field] || ""), "Enter a color in #RRGGBB format.", 2);
    }
    check("layoutMode", ["minimalist", "balanced", "maximalist"].includes(data.layoutMode), "Select a layout style.", 2);
    return issues;
}
