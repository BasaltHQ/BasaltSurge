require('dotenv').config({ path: '.env.local' });
const { MongoClient } = require('mongodb');
const https = require("https");
const { URL } = require("url");

const apiKey = "b66cb256-2178-3b5e-678c-37b501de2bf3";
const hostUrl = "https://vps-276db2b3.vps.ovh.us:8443";

async function callPleskCli(utility, params) {
    const apiUrl = `${hostUrl}/api/v2/cli/${utility}/call`;
    const postData = JSON.stringify({ params });
    const parsed = new URL(apiUrl);
    
    const headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-API-Key": apiKey,
        "Content-Length": String(Buffer.byteLength(postData, "utf-8"))
    };

    const options = {
        hostname: parsed.hostname,
        port: parsed.port || 8443,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers,
        rejectUnauthorized: false,
        timeout: 90000, // Extend timeout for full npm clean install
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
                const body = Buffer.concat(chunks).toString("utf-8");
                if (res.statusCode && res.statusCode >= 400) {
                    reject(new Error(`HTTP ${res.statusCode}: ${body}`));
                } else {
                    try {
                        resolve(JSON.parse(body));
                    } catch {
                        resolve({ raw: body });
                    }
                }
            });
        });
        req.on("error", (err) => reject(err));
        req.write(postData);
        req.end();
    });
}

async function run() {
    const key = "aipowerpay";
    const cleanDomain = "pay.aipowerpay.com";

    try {
        console.log("Connecting to Cosmos DB to fetch overrides...");
        const conn = process.env.COSMOS_CONNECTION_STRING || process.env.MONGODB_CONNECTION_STRING || process.env.DB_CONNECTION_STRING;
        const client = new MongoClient(conn);
        await client.connect();
        
        const db = client.db('surge');
        const coll = db.collection('surge_events');
        const doc = await coll.findOne({ id: 'brand:config', $or: [ { wallet: key }, { brandKey: key }, { key: key } ] });
        await client.close();

        // Build base env
        const baseEnv = {};
        const allowPrefixes = [
            "NEXT_PUBLIC_", "AZURE_", "COSMOS_", "THIRDWEB_", "PORTALPAY_", "MONGODB_",
            "APIM_", "AFD_", "UNISWAP_", "ETHERSCAN_", "BLOCKSCOUT_", "SEVENSHIFTS_",
            "TOAST_", "VARUNI_", "JWT_", "RESERVE_", "DEFAULT_", "PP_BRAND_", "AGENT_",
            "DB_", "S3_", "CLOUDFLARE_", "STRIPE_", "LINK_", "ELEVENLABS_", "PLESK_"
        ];
        const allowExact = [
            "JWT_SECRET", "NODE_ENV", "PORT", "WEBSITES_PORT", "BRAND_NAME", "BACKOFFICE_NAME",
            "DEMO_MODE", "DEMO_STUBS", "NEXT_PUBLIC_DEMO_MODE", "ADMIN_WALLETS", "PARTNER_WALLET",
            "NEXT_PUBLIC_PARTNER_WALLET", "NEXT_PUBLIC_APP_URL", "BRAND_KEY", "NEXT_PUBLIC_BRAND_KEY",
            "NEXT_PUBLIC_BRAND_NAME", "BRAND_APP_URL", "NEXT_PUBLIC_BRAND_APP_URL", "PP_BRAND_NAME",
            "PP_BRAND_LOGO", "PP_BRAND_FAVICON", "PP_BRAND_SYMBOL", "AGENT_WALLETS_JSON",
            "NEXT_PUBLIC_AGENT_WALLETS_JSON", "embedded", "DEBUG", "HOSTING_PROVIDER",
            "STORAGE_PROVIDER", "WEBSITES_ENABLE_APP_SERVICE_STORAGE"
        ];
        const denyKeys = new Set([
            "Path", "ComSpec", "PATHEXT", "ProgramFiles", "ProgramData", "CommonProgramFiles", "CommonProgramFiles(x86)",
            "SystemRoot", "WINDIR", "USERPROFILE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "NUMBER_OF_PROCESSORS", "PROCESSOR_IDENTIFIER"
        ]);

        for (const [k, v] of Object.entries(process.env)) {
            if (typeof v !== 'string') continue;
            if (denyKeys.has(k)) continue;
            if (allowExact.includes(k) || allowPrefixes.some((p) => k.startsWith(p))) {
                baseEnv[k] = v;
            }
        }

        const brandNameOverride = doc.name || key;
        const brandLogoOverride = doc.logos?.app || "";
        const brandFaviconOverride = doc.logos?.favicon || "";
        const brandSymbolOverride = doc.logos?.symbol || brandLogoOverride || "";
        const brandPartnerWallet = doc.partnerWallet || "";
        const brandAppUrl = doc.appUrl || `https://${cleanDomain}`;
        const brandPrimaryColor = doc.colors?.primary || "";
        const brandAccentColor = doc.colors?.accent || "";
        const thirdwebClientId = doc.thirdwebClientId || "";
        const thirdwebSecretKey = doc.thirdwebSecretKey || "";
        const thirdwebAuthEndpointSecret = doc.thirdwebAuthEndpointSecret || "";
        
        const agentsList = Array.isArray(doc.agents) ? doc.agents : [];
        const firstAgent = agentsList[0];
        const agentWallet = firstAgent ? String(firstAgent.wallet || "") : "";
        const agentFeeBps = firstAgent && typeof firstAgent.bps === "number" ? firstAgent.bps : 0;
        const agentsJson = JSON.stringify(agentsList);

        const env = {
            ...baseEnv,
            BRAND_KEY: key,
            NEXT_PUBLIC_BRAND_KEY: key,
            CONTAINER_TYPE: "partner",
            NEXT_PUBLIC_CONTAINER_TYPE: "partner",
            NEXT_PUBLIC_APP_URL: brandAppUrl,
            BRAND_NAME: brandNameOverride,
            NEXT_PUBLIC_BRAND_NAME: brandNameOverride,
            PP_BRAND_NAME: brandNameOverride,
            BRAND_APP_URL: brandAppUrl,
            NEXT_PUBLIC_BRAND_APP_URL: brandAppUrl,
            BRAND_PRIMARY_COLOR: brandPrimaryColor,
            NEXT_PUBLIC_BRAND_PRIMARY_COLOR: brandPrimaryColor,
            BRAND_ACCENT_COLOR: brandAccentColor,
            NEXT_PUBLIC_BRAND_ACCENT_COLOR: brandAccentColor,
            BRAND_LOGO_URL: brandLogoOverride,
            NEXT_PUBLIC_BRAND_LOGO_URL: brandLogoOverride,
            PP_BRAND_LOGO: brandLogoOverride,
            BRAND_FAVICON_URL: brandFaviconOverride,
            NEXT_PUBLIC_BRAND_FAVICON_URL: brandFaviconOverride,
            PP_BRAND_FAVICON: brandFaviconOverride,
            PP_BRAND_SYMBOL: brandSymbolOverride,
            PLESK_MAIN_DOMAIN: cleanDomain,
            THIRDWEB_CLIENT_ID: thirdwebClientId || baseEnv.THIRDWEB_CLIENT_ID || "",
            NEXT_PUBLIC_THIRDWEB_CLIENT_ID: thirdwebClientId || baseEnv.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || "",
            THIRDWEB_SECRET_KEY: thirdwebSecretKey || baseEnv.THIRDWEB_SECRET_KEY || "",
            THIRDWEB_AUTH_ENDPOINT_SECRET: thirdwebAuthEndpointSecret || baseEnv.THIRDWEB_AUTH_ENDPOINT_SECRET || "",
            ...(agentWallet ? {
                AGENT_WALLET: agentWallet,
                NEXT_PUBLIC_AGENT_WALLET: agentWallet
            } : {}),
            ...(agentFeeBps ? {
                AGENT_SPLIT_BPS: String(agentFeeBps),
                NEXT_PUBLIC_AGENT_SPLIT_BPS: String(agentFeeBps)
            } : {}),
            AGENT_WALLETS_JSON: agentsJson,
            NEXT_PUBLIC_AGENT_WALLETS_JSON: agentsJson,
            ADMIN_WALLETS: brandPartnerWallet,
            PARTNER_WALLET: brandPartnerWallet,
            NEXT_PUBLIC_PARTNER_WALLET: brandPartnerWallet,
            NEXT_PUBLIC_OWNER_WALLET: brandPartnerWallet,
            NEXT_PUBLIC_RECIPIENT_ADDRESS: brandPartnerWallet,
        };

        const sortedEnv = Object.entries(env).sort(([a], [b]) => a.localeCompare(b));
        
        // Single line echo chain to write env
        const echoCommands = [
            `echo '# Generated .env.production' > .env.production`,
            ...sortedEnv.map(([k, v]) => `echo '${k}="${String(v || "").replace(/'/g, "'\\''")}"' >> .env.production`)
        ];
        const writeEnvCommand = echoCommands.join(" && ");

        console.log("Updating Git deployment actions to force clean node_modules and rebuild...");
        const branch = process.env.PLESK_GIT_BRANCH || "main";
        
        // Actions list with rm -rf node_modules
        const cleanBuildActions = `export PATH=/opt/plesk/node/24/bin:$PATH && cd /var/www/vhosts/basalthq.com/${cleanDomain} && ${writeEnvCommand} && rm -rf node_modules && npm install && npm run build && mkdir -p tmp && touch tmp/restart.txt`;

        const gitUpdate = await callPleskCli("extension", [
            "--call", "git",
            "--update",
            "-domain", cleanDomain,
            "-name", key,
            "-remote-url", "git@github.com:BasaltHQ/BasaltSurge.git",
            "-active-branch", branch,
            "-deployment-path", cleanDomain,
            "-run-actions", "true",
            "-actions", cleanBuildActions
        ]);
        console.log("Git settings update result:", JSON.stringify(gitUpdate, null, 2));

        if (gitUpdate.code !== 0) {
            throw new Error(`Git configuration update failed: ${gitUpdate.stderr || gitUpdate.stdout}`);
        }

        console.log("Triggering Git deploy (this will run clean install, please wait as it takes 1-2 minutes)...");
        const gitDeploy = await callPleskCli("extension", [
            "--call", "git",
            "--deploy",
            "-domain", cleanDomain,
            "-name", key
        ]);
        console.log("Git deploy result:", JSON.stringify(gitDeploy, null, 2));

        console.log("\nRestoring the standard deployment actions (no rm -rf node_modules) for future pulls...");
        // Re-run test-echo-env.js to restore standard actions
        const exec = require('child_process').exec;
        exec('node scratch/test-echo-env.js', (err, stdout, stderr) => {
            if (err) {
                console.error("Failed to restore standard actions:", err);
            } else {
                console.log("Original deployment actions successfully restored!");
            }
        });
        
    } catch (e) {
        console.error("Rebuild failed:", e.message);
    }
}

run();
