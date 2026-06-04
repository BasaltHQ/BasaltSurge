require('dotenv').config({ path: '.env.local' });
const { PleskClient } = require('../src/lib/hosting/plesk/client');

async function run() {
    console.log("Querying Plesk Git repository settings for pay.aipowerpay.com repository aipowerpay...");
    const plesk = new PleskClient();

    try {
        const gitInfo = await plesk.callCli("extension", [
          "--call", "git",
          "--info",
          "-domain", "pay.aipowerpay.com",
          "-name", "aipowerpay"
        ]);
        console.log("Git info code:", gitInfo.code);
        console.log("Git info output (stdout):\n", gitInfo.stdout);
        console.log("Git info output (stderr):\n", gitInfo.stderr);
    } catch (e) {
        console.error("Failed to query Git info:");
        console.error(e);
    }
}

run();
