import { NextResponse } from "next/server";

const BASE_RPC_URL = process.env.BASE_RPC_URL || process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";
const STANDARD_ENTRY_POINT = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id = 1, jsonrpc = "2.0", method, params = [] } = body;

    // Handle supported entry points call
    if (method === "eth_supportedEntryPoints") {
      return NextResponse.json({
        jsonrpc,
        id,
        result: [STANDARD_ENTRY_POINT],
      });
    }

    // Handle gas estimation for user operations
    if (method === "eth_estimateUserOperationGas") {
      return NextResponse.json({
        jsonrpc,
        id,
        result: {
          preVerificationGas: "0x186a0", // 100,000 gas
          verificationGasLimit: "0x249f0", // 150,000 gas
          callGasLimit: "0x493e0", // 300,000 gas
        },
      });
    }

    // Forward standard EVM RPC calls directly to Base RPC node
    const res = await fetch(BASE_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data);

  } catch (err: any) {
    console.error("[Bundler API Error]:", err);
    return NextResponse.json({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32603, message: err?.message || "Internal bundler execution error" },
    }, { status: 500 });
  }
}
