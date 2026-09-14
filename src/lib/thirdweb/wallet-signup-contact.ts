import { getUser } from "thirdweb/wallets";
import { getContract } from "thirdweb";
import { getAllAdmins } from "thirdweb/extensions/erc4337";
import { chain, getServerClient } from "@/lib/thirdweb/server";

export type WalletSignupContact = {
    email?: string;
    phone?: string;
    source: "thirdweb";
    retrievedAt: number;
};

/** Never substitute merchant-entered contact data or unrelated linked profiles. */
export async function getWalletSignupContact(wallet: string, signerHint?: string): Promise<WalletSignupContact | null> {
    const client = getServerClient();
    if (!client.secretKey) throw new Error("wallet_contact_lookup_unavailable");
    const target = wallet.toLowerCase();
    const addresses = [wallet];
    if (signerHint && /^0x[a-fA-F0-9]{40}$/.test(signerHint) && signerHint.toLowerCase() !== target) {
        addresses.push(signerHint);
    }
    const toContact = (user: Awaited<ReturnType<typeof getUser>>): WalletSignupContact | null => {
        if (!user?.email && !user?.phone) return null;
        return {
            ...(user.email ? { email: user.email } : {}),
            ...(user.phone ? { phone: user.phone } : {}),
            source: "thirdweb",
            retrievedAt: Date.now(),
        };
    };
    for (const address of addresses) {
        const user = await getUser({ client, walletAddress: address });
        if (!user || (user.walletAddress.toLowerCase() !== target && user.smartAccountAddress?.toLowerCase() !== target)) continue;
        // Top-level contacts identify this wallet; linked profiles may be added later.
        const contact = toContact(user);
        if (contact) return contact;
    }
    // Older applications did not store the signer. Resolve a deployed smart
    // wallet's sole admin on chain; never guess among multiple wallet owners.
    const admins = await getAllAdmins({ contract: getContract({ client, chain, address: wallet }) }).catch(() => []);
    if (admins.length === 1) {
        const user = await getUser({ client, walletAddress: admins[0] });
        if (user?.walletAddress.toLowerCase() === admins[0].toLowerCase()) return toContact(user);
    }
    return null;
}
