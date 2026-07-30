import { NextResponse } from "next/server";
import { keccak256, encodePacked, concatHex, pad, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Default standard Base Verifying Paymaster fallback contract address
const DEFAULT_PAYMASTER_ADDRESS = (process.env.NEXT_PUBLIC_VERIFYING_PAYMASTER_ADDRESS || "0x000000000000003c2b379e3eb171d115dec86be2") as `0x${string}`;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id = 1, jsonrpc = "2.0", method, params = [] } = body;

    // Handle paymaster sponsorship request
    if (method === "pm_sponsorUserOperation" || method === "eth_paymasterAndDataForUserOperation") {
      const [userOp, entryPoint] = params;

      if (!userOp) {
        return NextResponse.json({
          jsonrpc,
          id,
          error: { code: -32602, message: "Missing userOp parameters" },
        }, { status: 400 });
      }

      const paymasterPrivateKey = process.env.PAYMASTER_PRIVATE_KEY || process.env.SETTLEMENT_PRIVATE_KEY || process.env.ADMIN_SETTLEMENT_KEY;

      if (!paymasterPrivateKey) {
        return NextResponse.json({
          jsonrpc,
          id,
          error: { code: -32603, message: "Paymaster private key is not configured on container" },
        }, { status: 500 });
      }

      const formattedKey = (paymasterPrivateKey.startsWith("0x") ? paymasterPrivateKey : `0x${paymasterPrivateKey}`) as `0x${string}`;
      const account = privateKeyToAccount(formattedKey);
      const paymasterAddress = DEFAULT_PAYMASTER_ADDRESS;

      // Validity timestamps: valid for 24 hours from current timestamp
      const validUntil = Math.floor(Date.now() / 1000) + 86400;
      const validAfter = Math.floor(Date.now() / 1000) - 60; // 1 minute buffer in past

      const userOpHash = userOp.userOpHash || userOp.hash;

      let signature = "0x" as `0x${string}`;
      if (userOpHash) {
        const packed = encodePacked(
          ["address", "uint48", "uint48", "bytes32"],
          [paymasterAddress, validUntil, validAfter, userOpHash as `0x${string}`]
        );
        const hashToSign = keccak256(packed);
        signature = await account.signMessage({ message: { raw: hashToSign } });
      }

      const validUntilHex = pad(toHex(validUntil), { size: 6 });
      const validAfterHex = pad(toHex(validAfter), { size: 6 });

      const paymasterAndData = concatHex([
        paymasterAddress,
        validUntilHex,
        validAfterHex,
        signature,
      ]);

      return NextResponse.json({
        jsonrpc,
        id,
        result: {
          paymasterAndData,
          preVerificationGas: userOp.preVerificationGas || "0x186a0",
          verificationGasLimit: userOp.verificationGasLimit || "0x249f0",
          callGasLimit: userOp.callGasLimit || "0x493e0",
        },
      });
    }

    return NextResponse.json({
      jsonrpc,
      id,
      error: { code: -32601, message: `Unsupported method: ${method}` },
    }, { status: 400 });

  } catch (err: any) {
    console.error("[Paymaster API Error]:", err);
    return NextResponse.json({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32603, message: err?.message || "Internal paymaster processing error" },
    }, { status: 500 });
  }
}
