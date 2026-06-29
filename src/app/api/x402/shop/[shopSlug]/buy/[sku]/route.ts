import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";

// Helper to reliably construct absolute public URLs
function getPublicUrl(req: NextRequest) {
  const rawXfHost = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  const rawXfProto = req.headers.get("x-forwarded-proto") || "https";
  let hostname = rawXfHost.split(",")[0].trim();
  let protocol = rawXfProto.split(",")[0].trim();
  if (hostname.includes("localhost") || hostname.includes("127.0.0.1")) {
    protocol = "http";
  }
  const baseUrl = `${protocol}://${hostname}`;
  return `${baseUrl}${req.nextUrl.pathname}`;
}

export async function POST(req: NextRequest, context: any) {
  const correlationId = req.headers.get("x-correlation-id") || crypto.randomUUID();
  const publicUrl = getPublicUrl(req);

  try {
    const { shopSlug, sku } = await context.params;
    if (!shopSlug || !sku) {
      return NextResponse.json({ error: "Missing shop slug or sku" }, { status: 400 });
    }

    // 1. Fetch Item from Cosmos
    const container = await getContainer("skynetpod");
    const query = `
      SELECT c.sku, c.priceUsd, c.name, c.wallet 
      FROM c 
      WHERE c.type = 'inventory_item' AND c.sku = @sku
    `;
    const { resources: items } = await container.items.query({
      query,
      parameters: [{ name: "@sku", value: sku }]
    }).fetchNext();

    const item = items[0];
    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    const priceUsdRaw = Number(item.priceUsd || 0);
    const validPrice = Math.max(priceUsdRaw, 0.50);
    const priceStr = validPrice.toFixed(2);

    // 2. Are we being paid?
    const paymentProof = req.headers.get("x-payment");
    if (!paymentProof) {
      // Return strict 402 Challenge
      const { settlePayment, facilitator } = await import("thirdweb/x402");
      const { createThirdwebClient } = await import("thirdweb");
      const { defineChain } = await import("thirdweb/chains");

      const secretKey = process.env.THIRDWEB_SECRET_KEY || "";
      const chainId = Number(process.env.CHAIN_ID || process.env.NEXT_PUBLIC_CHAIN_ID || 8453);

      const { getSiteConfigForWallet } = await import("@/lib/site-config");
      const cfg = await getSiteConfigForWallet(item.wallet).catch(() => null as any);

      // Robust split resolution from reserve analytics
      const splitAddr = (cfg as any)?.splitAddress ||
        (cfg as any)?.split?.address ||
        (cfg as any)?.config?.splitAddress ||
        (cfg as any)?.config?.split?.address ||
        "";

      const payTo = (/^0x[a-f0-9]{40}$/i.test(splitAddr) ? splitAddr : item.wallet) as `0x${string}`;

      const client = createThirdwebClient({ secretKey });
      const network = defineChain(chainId);
      const thirdwebFacilitator = facilitator({
        client,
        serverWalletAddress: payTo,
        waitUntil: "confirmed",
      });

      const result = await settlePayment({
        resourceUrl: publicUrl,
        method: "POST",
        paymentData: null,
        payTo,
        network,
        price: `$${priceStr}`,
        routeConfig: {
          description: `Direct purchase of ${item.name}`,
          mimeType: "application/json" as const,
          outputSchema: {},
        },
        facilitator: thirdwebFacilitator,
      });

      const rawHeaders = (result as any).responseHeaders || {};
      const paymentRequiredB64 = rawHeaders["PAYMENT-REQUIRED"] || rawHeaders["payment-required"] || rawHeaders["Payment-Required"] || "";
      let challengeBody: any = {};
      if (paymentRequiredB64) {
        try {
          challengeBody = JSON.parse(Buffer.from(paymentRequiredB64, "base64").toString("utf-8"));
          const shopSchema = {
            type: "object",
            description: "Optional metadata"
          };

          if (challengeBody.accepts && Array.isArray(challengeBody.accepts)) {
            challengeBody.accepts.forEach((a: any) => {
              // INJECT EXPLICIT AMOUNT STRING FOR X402SCAN CRAWLER VALIDATION
              // Strictly enforce USDC (6 decimals)
              if (!a.amount) a.amount = a.maxAmountRequired || String(Math.floor(validPrice * 1000000));
              
              if (!a.outputSchema) a.outputSchema = {};
              if (!a.outputSchema.input) a.outputSchema.input = { type: "http", method: "POST" };
              a.outputSchema.input.schema = shopSchema;
            });
          }
            
          if (!challengeBody.extensions) challengeBody.extensions = {};
          challengeBody.extensions.bazaar = {
            discoverable: true,
            category: "commerce",
            tags: ["shopping", "retail", "pos", "items"],
            schema: {
              type: "object",
              properties: {
                input: shopSchema,
                output: { type: "object" }
              }
            }
          };
        } catch { /* ignore */ }
      }

      const updatedBody = {
        ...challengeBody,
        order: {
          shopSlug,
          sku,
          quantity: 1,
          totalUsd: validPrice,
          currency: "USD",
        },
      };

      rawHeaders["Payment-Required"] = Buffer.from(JSON.stringify(updatedBody)).toString("base64");

      return new NextResponse(JSON.stringify(updatedBody), {
        status: 402,
        headers: {
          "Payment-Required": rawHeaders["Payment-Required"],
          "x-correlation-id": correlationId,
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "payment-required, Payment-Required, PAYMENT-REQUIRED",
        },
      });
    }

    // ────────────────────────────────────────────────────────────
    // 3. Payment Present -> Validate
    // ────────────────────────────────────────────────────────────
    const { settlePayment, facilitator } = await import("thirdweb/x402");
    const { createThirdwebClient } = await import("thirdweb");
    const { defineChain } = await import("thirdweb/chains");

    const secretKey = process.env.THIRDWEB_SECRET_KEY || "";
    const chainId = Number(process.env.CHAIN_ID || process.env.NEXT_PUBLIC_CHAIN_ID || 8453);

    const { getSiteConfigForWallet } = await import("@/lib/site-config");
    const cfg = await getSiteConfigForWallet(item.wallet).catch(() => null as any);

    // Robust split resolution from reserve analytics
    const splitAddr = (cfg as any)?.splitAddress ||
      (cfg as any)?.split?.address ||
      (cfg as any)?.config?.splitAddress ||
      (cfg as any)?.config?.split?.address ||
      "";

    const payTo = (/^0x[a-f0-9]{40}$/i.test(splitAddr) ? splitAddr : item.wallet) as `0x${string}`;

    const client = createThirdwebClient({ secretKey });
    const network = defineChain(chainId);
    const thirdwebFacilitator = facilitator({
      client,
      serverWalletAddress: payTo,
      waitUntil: "confirmed",
    });

    const result = await settlePayment({
      resourceUrl: publicUrl,
      method: "POST",
      paymentData: paymentProof,
      payTo,
      network,
      price: `$${priceStr}`,
      routeConfig: {
        description: `Direct purchase of ${item.name}`,
        mimeType: "application/json" as const,
        outputSchema: {},
      },
      facilitator: thirdwebFacilitator,
    });

    if (result.status !== 200) {
      return NextResponse.json(
        { error: "Payment verification failed or insufficient payload", details: (result as any).responseBody?.errorMessage || "Payment Required" },
        { status: 402, headers: { "x-correlation-id": correlationId, "Access-Control-Allow-Origin": "*" } }
      );
    }

    // Settled Successfully
    const receiptId = `R-${Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0")}`;
    const ts = Date.now();

    const receipt = {
      receiptId,
      totalUsd: validPrice,
      currency: "USD",
      lineItems: [{ sku, qty: 1, name: item.name }],
      timestamp: ts,
      status: "paid",
    };

    return NextResponse.json(
      { ok: true, receipt },
      {
        status: 200,
        headers: {
          "x-correlation-id": correlationId,
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error: any) {
    console.error("Direct POS Error:", error);
    return NextResponse.json(
      { error: "internal_error", message: error.message || String(error) },
      { status: 500, headers: { "x-correlation-id": correlationId } }
    );
  }
}

export async function GET(req: NextRequest, { params }: { params: { shopSlug: string; sku: string } }) {
  // Discovery crawlers usually query via GET to pull headers. 
  // We forward to our POST handler to easily spit back the exact 402 payment requirements.
  return POST(req, { params });
}
