import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireRole } from "@/lib/auth";

const CONFIG_ID = "contract-widgets";
const CONFIG_PARTITION = "platform_config";

interface ContractConfig {
    msa: {
        widgetId: string;
        title: string;
        description: string;
        lastUpdated: string;
    };
    msas: {
        widgetId: string;
        title: string;
        description: string;
        lastUpdated: string;
    };
}

const DEFAULT_CONFIG: ContractConfig = {
    msa: {
        widgetId: "CBFCIBAA3AAABLblqZhAcvuUre-Wl9SplRpshpIXktBmcqH0bX_pANw6g4h-3k1aNaWOvcg_KApu-1KAFPMs*",
        title: "Standard Partner Agreement",
        description: "Standard MSA for partner onboarding",
        lastUpdated: new Date().toISOString(),
    },
    msas: {
        widgetId: "CBFCIBAA3AAABLblqZhAHRCQTck4tBTVuSFpOBUyzpaX3Pwfl4C7LnOMuF3NAsQix9gPj1Ei-619ikHBIyTI*",
        title: "Referred Partner Agreement",
        description: "Standard MSA for Partners onboarding from Referred Introducers/Sales Agents",
        lastUpdated: new Date().toISOString(),
    },
};

export async function GET(req: NextRequest) {
    try {
        const container = await getContainer();

        try {
            const { resource } = await container.item(CONFIG_ID, CONFIG_PARTITION).read();
            if (resource?.config) {
                return NextResponse.json({ config: resource.config });
            }
        } catch {
            // Not found, return defaults
        }

        return NextResponse.json({ config: DEFAULT_CONFIG });
    } catch (e: any) {
        console.error("[GET /api/admin/contracts] Error:", e);
        return NextResponse.json({ config: DEFAULT_CONFIG });
    }
}

export async function POST(req: NextRequest) {
    try {
        // Check admin permissions
        const caller = await requireRole(req, "admin");

        const body = await req.json();
        const { config } = body;

        if (!config?.msa?.widgetId || !config?.msas?.widgetId) {
            return NextResponse.json(
                { error: "Missing required widget IDs" },
                { status: 400 }
            );
        }

        const container = await getContainer();

        const doc = {
            id: CONFIG_ID,
            wallet: CONFIG_PARTITION,
            type: "contract-config",
            config,
            updatedAt: new Date().toISOString(),
            updatedBy: caller?.wallet || "unknown",
        };

        await container.items.upsert(doc);

        return NextResponse.json({ success: true, config });
    } catch (e: any) {
        console.error("[POST /api/admin/contracts] Error:", e);
        return NextResponse.json(
            { error: e?.message || "Failed to save configuration" },
            { status: 500 }
        );
    }
}
