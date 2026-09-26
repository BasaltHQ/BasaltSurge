import { getUser } from "thirdweb/wallets";
import { getContract } from "thirdweb";
import { getAllAdmins } from "thirdweb/extensions/erc4337";
import { predictSmartAccountAddress } from "thirdweb/wallets/smart";
import { isContractDeployed } from "thirdweb/utils";
import { chain } from "@/lib/thirdweb/server";
import { getWalletContactClient } from "@/lib/thirdweb/wallet-contact-client";

export type WalletSignupContact = {
    email?: string;
    phone?: string;
    source: "thirdweb";
    retrievedAt: number;
};

/** Never substitute merchant-entered contact data or unrelated linked profiles. */
export async function getWalletSignupContact(wallet: string, signerHint?: string, brandKey?: string): Promise<WalletSignupContact | null> {
    const client = await getWalletContactClient(brandKey);
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
    const signerUsers: NonNullable<Awaited<ReturnType<typeof getUser>>>[] = [];
    for (const address of addresses) {
        const user = await getUser({ client, walletAddress: address });
        if (!user) continue;
        if (user.walletAddress.toLowerCase() !== target && user.smartAccountAddress?.toLowerCase() !== target) {
            if (/^0x[a-fA-F0-9]{40}$/.test(user.walletAddress)) signerUsers.push(user);
            continue;
        }
        // Top-level contacts identify this wallet; linked profiles may be added later.
        const contact = toContact(user);
        if (contact) return contact;
    }
    const contract = getContract({ client, chain, address: wallet });
    if (!await isContractDeployed(contract)) {
        // Signup happens before the first transaction deploys the smart account.
        // Verify the hint against the factory used by our signup wallets, rather
        // than trusting a caller-supplied signer or requiring on-chain admins.
        for (const user of signerUsers) {
            const predicted = await predictSmartAccountAddress({ client, chain, adminAddress: user.walletAddress });
            if (predicted.toLowerCase() === target) {
                const contact = toContact(user);
                if (contact) return contact;
            }
        }
        return null;
    }
    // Older applications did not store the signer. Resolve a deployed smart
    // wallet's sole admin on chain; never guess among multiple wallet owners.
    // RPC failures must remain retryable errors, not false "no contact" results.
    const admins = await getAllAdmins({ contract });
    if (admins.length === 1) {
        const user = await getUser({ client, walletAddress: admins[0] });
        if (user?.walletAddress.toLowerCase() === admins[0].toLowerCase()) return toContact(user);
    }
    return null;
}
