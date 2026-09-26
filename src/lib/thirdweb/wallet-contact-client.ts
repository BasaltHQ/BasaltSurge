import { createThirdwebClient } from "thirdweb";
import { readBrandOverridesCached } from "@/lib/brand-config";
import { getServerClient } from "@/lib/thirdweb/server";

/** Resolve the same project used by the brand's signup UI, using server-only credentials. */
export async function getWalletContactClient(brandKey?: string) {
    const key = brandKey?.trim().toLowerCase();
    if (!key) return getServerClient();

    const overrides = await readBrandOverridesCached(key);
    const suffix = key.toUpperCase().replace(/-/g, "_");
    const isPlatform = key === "basaltsurge" || key === "portalpay";
    const clientId = overrides?.thirdwebClientId?.trim()
        || (!isPlatform ? process.env[`NEXT_PUBLIC_THIRDWEB_CLIENT_ID_${suffix}`] : undefined)
        || process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID;
    const secretKey = overrides?.thirdwebSecretKey?.trim()
        || (!isPlatform ? process.env[`THIRDWEB_SECRET_KEY_${suffix}`] : undefined)
        || process.env.THIRDWEB_SECRET_KEY;

    if (!secretKey) throw new Error("wallet_contact_lookup_unavailable");
    const client = createThirdwebClient({ secretKey });
    // A different project's key returns an empty user result, hiding a
    // configuration problem behind the UI's "no contact" state.
    if (clientId && client.clientId !== clientId) {
        throw new Error("wallet_contact_project_mismatch");
    }
    return client;
}
