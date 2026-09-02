import { NextRequest, NextResponse } from "next/server";
import { getSiteConfigForWallet } from "@/lib/site-config";
import { getContract, getContractEvents, prepareEvent, createThirdwebClient } from "thirdweb";
import { base } from "thirdweb/chains";
import { getContainer } from "@/lib/cosmos";

// Lazy client initialization — avoids crash during `next build` when env vars
// aren't available in the shell session (Plesk injects them only at runtime).
let _client: ReturnType<typeof createThirdwebClient> | null = null;
function getThirdwebClient() {
    if (!_client) {
        _client = createThirdwebClient({
            clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || "",
            secretKey: process.env.THIRDWEB_SECRET_KEY || ""
        });
    }
    return _client;
}

export const dynamic = 'force-dynamic';

async function handleCheckPayment(params: {
    wallet?: string;
    receiptId?: string;
    since?: any;
    amount?: any;
    currency?: string;
}) {
    const { wallet, receiptId, since, amount, currency } = params;

    if (!wallet || !receiptId || !since) {
        return NextResponse.json({ error: "Missing required params (wallet, receiptId, since)" }, { status: 400 });
    }

    const sinceTime = typeof since === "number"
        ? (since > 1000000000000 ? since : since * 1000)
        : new Date(since).getTime();

    if (isNaN(sinceTime)) {
        return NextResponse.json({ error: "Invalid since parameter" }, { status: 400 });
    }

    const normalizedWallet = String(wallet).toLowerCase();

    // 1. Fast path: Check DB Status first (avoid slow blockchain scans if already paid)
    const container = await getContainer();
    const { resource: receiptDoc } = await container.item(`receipt:${receiptId}`, normalizedWallet).read<any>();

    if (receiptDoc) {
        const isPaid = receiptDoc.status === "paid" || receiptDoc.status === "checkout_success";
        if (isPaid) {
            const hasTx = receiptDoc.txHash || receiptDoc.transactionHash || receiptDoc.stripeSessionId;
            return NextResponse.json({ ok: true, paid: true, txHash: hasTx, receipt: receiptDoc });
        }
    }

    // If we don't have amount or currency, we cannot perform the blockchain check, but we can return paid: false safely
    if (!amount || !currency || Number(amount) <= 0) {
        return NextResponse.json({ ok: true, paid: false, warning: "Missing amount/currency/rates for chain check" });
    }

    // 2. Get Split Address
    const cfg = await getSiteConfigForWallet(normalizedWallet).catch(() => null);
    let splitAddress = (cfg as any)?.splitAddress || (cfg as any)?.split?.address;

    if (!splitAddress || !/^0x[a-f0-9]{40}$/i.test(splitAddress)) {
        return NextResponse.json({ ok: false, error: "no_split_config" });
    }

    // 3. Determine Tokens to watch
    const isNative = currency === "ETH";
    const tokens = (cfg as any)?.tokens || [];
    let tokenConfig = tokens.find((t: any) => t.symbol === currency);

    // Fallback: use hardcoded Base mainnet token addresses if config doesn't have them
    if (!tokenConfig && !isNative) {
        const fallbackTokens: Record<string, { address: string; decimals: number }> = {
            "USDC": { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
            "USDT": { address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 },
            "cbBTC": { address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8 },
            "cbXRP": { address: "0xcb585250f852C6c6bf90434AB21A00f02833a4af", decimals: 6 },
            "SOL": { address: process.env.NEXT_PUBLIC_BASE_SOL_ADDRESS || "0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82", decimals: 9 },
        };
        const fallback = fallbackTokens[currency];
        if (fallback) {
            tokenConfig = { symbol: currency, ...fallback };
        }
    }

    let foundTx: any = null;

    const expected = Number(amount);
    const minAmount = expected * 0.90; // Tighten slightly to 10%
    const maxAmount = expected * 1.10;

    // BLOCKCHAIN CHECK
    try {
        // OPTIMIZATION: Fetch latest block number to limit scan range
        // Base block time is ~2s. Capped at 300 blocks (~10 minutes) or dynamic based on sinceTime
        const nowMs = Date.now();
        const elapsedSec = Math.max(0, (nowMs - sinceTime) / 1000);
        const blocksToScan = Math.min(300, Math.ceil(elapsedSec / 2) + 30); // 30-block (~1m) buffer, capped at 300 blocks (10m)

        let latestBlock = BigInt(0);
        try {
            const rpcRes = await fetch("https://mainnet.base.org", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
                signal: AbortSignal.timeout(4000)
            });
            const rpcJson = await rpcRes.json();
            if (rpcJson.result) {
                latestBlock = BigInt(rpcJson.result);
            }
        } catch (e) {
            console.error("Failed to fetch latest block, defaulting to recent heuristic", e);
        }

        const safeFromBlock = latestBlock > BigInt(blocksToScan) ? latestBlock - BigInt(blocksToScan) : undefined;

        const contract = getContract({
            client: getThirdwebClient(),
            chain: base,
            address: splitAddress as `0x${string}`,
        });

        let events: any[] = [];
        const fetchOptions = {
            contract,
            fromBlock: safeFromBlock,
        };

        if (isNative) {
            const event = prepareEvent({
                signature: "event PaymentReceived(address from, uint256 amount)"
            });
            events = await getContractEvents({
                ...fetchOptions,
                events: [event],
            });
        } else {
            if (tokenConfig?.address) {
                const tokenContract = getContract({
                    client: getThirdwebClient(),
                    chain: base,
                    address: tokenConfig.address as `0x${string}`,
                });

                const event = prepareEvent({
                    signature: "event Transfer(address indexed from, address indexed to, uint256 value)",
                    filters: {
                        to: splitAddress as `0x${string}`
                    }
                });

                events = await getContractEvents({
                    contract: tokenContract,
                    fromBlock: safeFromBlock,
                    events: [event],
                });
            }
        }

        // FILTER EVENTS
        const candidates = events.filter(e => {
            const rawVal = e.args?.amount || e.args?.value || BigInt(0);
            const decimals = isNative ? 18 : (tokenConfig?.decimals || 6);
            const val = Number(rawVal) / (10 ** decimals);
            return val >= minAmount && val <= maxAmount;
        });

        for (const c of candidates) {
            const blockHex = "0x" + c.blockNumber.toString(16);
            let ts = 0;

            try {
                const rpcUrl = process.env.NEXT_PUBLIC_ALCHEMY_KEY
                    ? `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_KEY}`
                    : "https://mainnet.base.org";

                const rpcResponse = await fetch(rpcUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        jsonrpc: "2.0",
                        id: 1,
                        method: "eth_getBlockByNumber",
                        params: [blockHex, false]
                    }),
                    signal: AbortSignal.timeout(4000)
                });
                const rpcData = await rpcResponse.json();
                if (rpcData?.result?.timestamp) {
                    ts = parseInt(rpcData.result.timestamp, 16) * 1000;
                }
            } catch (e) {
                console.error("RPC block fetch failed", e);
            }

            // Verify timestamp strictly: Must have a valid timestamp >= receipt creation time
            if (ts <= 0 || ts < sinceTime) {
                console.log(`[CHECK PAYMENT] Block timestamp ${ts} is before receipt created ${sinceTime} or invalid. Skipping tx ${c.transactionHash}`);
                continue;
            }

            // Check if this transaction hash is already used in the database to prevent duplicate matching
            const normTxHash = String(c.transactionHash).toLowerCase();
            const querySpec = {
                query: "SELECT * FROM c WHERE c.type = 'receipt' AND (LOWER(c.txHash) = @txHash OR LOWER(c.transactionHash) = @txHash)",
                parameters: [{ name: "@txHash", value: normTxHash }]
            };
            const { resources: existingReceipts } = await container.items.query(querySpec).fetchAll();
            if (existingReceipts && existingReceipts.length > 0) {
                console.log(`[CHECK PAYMENT] Transaction hash ${c.transactionHash} already used for receipt: ${existingReceipts[0].id}, skipping.`);
                continue;
            }

            foundTx = c.transactionHash;
            break;
        }

    } catch (e) {
        console.error("Chain check failed", e);
    }

    // Check DB Status regardless of chain scan (to catch widget success)
    if (receiptDoc) {
        const isPaid = receiptDoc.status === "paid" || receiptDoc.status === "checkout_success";
        const hasTx = receiptDoc.txHash || receiptDoc.transactionHash || foundTx;

        // If already paid/success, return immediately
        if (isPaid) {
            // Optimization: If foundTx matches and status is only checkout_success, we could upgrade to "paid".
            if (foundTx && receiptDoc.status !== "paid") {
                receiptDoc.status = "paid";
                receiptDoc.txHash = foundTx;
                receiptDoc.paidAt = Date.now();
                receiptDoc.lastUpdatedAt = Date.now();
                receiptDoc.paymentMethod = "crypto_verified_poll";
                await container.item(`receipt:${receiptId}`, normalizedWallet).replace(receiptDoc);
                return NextResponse.json({ ok: true, paid: true, txHash: foundTx, receipt: receiptDoc });
            }
            return NextResponse.json({ ok: true, paid: true, txHash: hasTx, receipt: receiptDoc });
        }

        // Not paid yet in DB. If we found a tx on chain, update it.
        if (foundTx) {
            receiptDoc.status = "paid";
            receiptDoc.txHash = foundTx;
            receiptDoc.paidAt = Date.now();
            receiptDoc.lastUpdatedAt = Date.now();
            receiptDoc.paymentMethod = "crypto_fallback_poll";

            await container.item(`receipt:${receiptId}`, normalizedWallet).replace(receiptDoc);
            return NextResponse.json({ ok: true, paid: true, txHash: foundTx, receipt: receiptDoc });
        }
    }

    return NextResponse.json({ ok: true, paid: false });
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const { wallet, receiptId, since, amount, currency } = body;

        return await handleCheckPayment({ wallet, receiptId, since, amount, currency });
    } catch (e: any) {
        console.error("Check-payment global error:", e);
        return NextResponse.json({ error: e.message || "failed" }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    try {
        const url = new URL(req.url);
        const wallet = url.searchParams.get("wallet") || undefined;
        const receiptId = url.searchParams.get("receiptId") || undefined;
        const since = url.searchParams.get("since") || undefined;
        const amount = url.searchParams.get("amount") || undefined;
        const currency = url.searchParams.get("currency") || undefined;

        // since can be numeric string or timestamp representation
        let parsedSince: any = since;
        if (since && /^\d+$/.test(since)) {
            parsedSince = Number(since);
        }

        return await handleCheckPayment({
            wallet,
            receiptId,
            since: parsedSince,
            amount: amount ? Number(amount) : undefined,
            currency
        });
    } catch (e: any) {
        console.error("Check-payment GET global error:", e);
        return NextResponse.json({ error: e.message || "failed" }, { status: 500 });
    }
}
