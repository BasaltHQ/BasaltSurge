import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

/**
 * GET /api/stripe/onramp-quote
 * Fetches a Stripe Crypto Onramp quote for USDC on Base.
 * Query: ?amount=6.13&currency=usd
 * Returns: { ok, quote: { destinationAmount, destinationCurrency, fees, sourceTotal } }
 */
export async function GET(req: NextRequest) {
  try {
    const stripeKey = process.env.STRIPE_API_KEY;
    if (!stripeKey) {
      return NextResponse.json({ ok: false, error: "stripe_not_configured" }, { status: 500 });
    }

    const url = new URL(req.url);
    const sourceAmount = url.searchParams.get("amount") || "10";
    const sourceCurrency = url.searchParams.get("currency") || "usd";

    const params = new URLSearchParams();
    params.append("source_amount", sourceAmount);
    params.append("source_currency", sourceCurrency);
    params.append("destination_currencies[]", "usdc");
    params.append("destination_networks[]", "base");
    params.append("ui_mode", "headless");

    let response = await fetch(
      `https://api.stripe.com/v1/crypto/onramp/quotes?${params.toString()}`,
      {
        method: "GET",
        headers: { "Authorization": `Bearer ${stripeKey}` },
      }
    );

    let data = await response.json().catch(() => ({}));

    if (!response.ok && (data.error?.code === "crypto_onramp_invalid_parameter" || response.status === 404)) {
      // Fallback to Beta v2 endpoint /v1/crypto/onramp_quotes
      const v2Response = await fetch(
        `https://api.stripe.com/v1/crypto/onramp_quotes?${params.toString()}`,
        {
          method: "GET",
          headers: { "Authorization": `Bearer ${stripeKey}` },
        }
      );
      if (v2Response.ok) {
        response = v2Response;
        data = await v2Response.json().catch(() => ({}));
      }
    }

    if (!response.ok) {
      console.error("[STRIPE QUOTE] Quote fetch failed:", data);
      return NextResponse.json(
        { ok: false, error: data.error?.message || "quote_failed" },
        { status: response.status }
      );
    }

    // Extract the base_network USDC quote
    const baseQuotes = data.destination_network_quotes?.base_network || [];
    const usdcQuote = baseQuotes.find((q: any) => q.destination_currency === "usdc");

    if (!usdcQuote) {
      return NextResponse.json({
        ok: true,
        quote: null,
        allQuotes: baseQuotes,
      });
    }

    return NextResponse.json({
      ok: true,
      quote: {
        destinationAmount: usdcQuote.destination_amount,
        destinationCurrency: usdcQuote.destination_currency,
        destinationNetwork: usdcQuote.destination_network,
        fees: usdcQuote.fees,
        sourceTotal: usdcQuote.source_total_amount,
      },
    });
  } catch (e: any) {
    console.error("[STRIPE QUOTE] Error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "internal_error" }, { status: 500 });
  }
}
