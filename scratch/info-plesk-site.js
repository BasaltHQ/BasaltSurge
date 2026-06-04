require('dotenv').config({ path: '.env.local' });
const { PleskClient } = require('../src/lib/hosting/plesk/client');

async function run() {
    console.log("Querying Plesk settings on VPS for pay.aipowerpay.com...");
    const plesk = new PleskClient();

    try {
        const infoResult = await plesk.callCli("site", [
          "--info", "pay.aipowerpay.com"
        ]);
        console.log("Site info code:", infoResult.code);
        console.log("Site info output (stdout):\n", infoResult.stdout);
        console.log("Site info output (stderr):\n", infoResult.stderr);

        console.log("\nQuerying Plesk Git repositories...");
        const gitResult = await plesk.callCli("extension", [
          "--call", "git",
          "--list",
          "-domain", "pay.aipowerpay.com"
        ]);
        console.log("Git list code:", gitResult.code);
        console.log("Git list output (stdout):\n", gitResult.stdout);
        console.log("Git list output (stderr):\n", gitResult.stderr);
    } catch (e) {
        console.error("Failed to query info:");
        console.error(e);
    }
}

run();
