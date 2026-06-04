require('dotenv').config({ path: '.env.local' });
const { PleskClient } = require('../src/lib/hosting/plesk/client');

async function run() {
    const key = "aipowerpay";
    const cleanDomain = "pay.aipowerpay.com";

    console.log("Starting Plesk settings sync simulation...");
    const plesk = new PleskClient();

    try {
        // Step 1: Force Git repository settings update
        console.log("Step 1: Enforcing Git repository settings update...");
        const gitUpdate = await plesk.callCli("extension", [
          "--call", "git",
          "--update",
          "-domain", cleanDomain,
          "-name", key,
          "-remote-url", "git@github.com:BasaltHQ/BasaltSurge.git",
          "-active-branch", "production",
          "-deployment-path", cleanDomain,
          "-run-actions", "true",
          "-actions", `export PATH=/opt/plesk/node/24/bin:$PATH && cd /var/www/vhosts/basalthq.com/${cleanDomain} && set -a && [ -f .env.production ] && . .env.production && set +a && npm install && npm run build && mkdir -p tmp && touch tmp/restart.txt`
        ]);
        console.log("Git update result:", gitUpdate);

        // Step 2: Disable Node.js support on domain
        console.log("Step 2: Disabling Node.js on domain pay.aipowerpay.com...");
        const nodeDisable = await plesk.callCli("extension", [
          "--call", "nodejs",
          "--disable",
          "-domain", cleanDomain
        ]);
        console.log("Node disable result:", nodeDisable);

        // Step 3: Enable Node.js support on domain (will pick up the updated /pay.aipowerpay.com www-root)
        console.log("Step 3: Re-enabling Node.js on domain...");
        const nodeEnable = await plesk.callCli("extension", [
          "--call", "nodejs",
          "--enable",
          "-domain", cleanDomain
        ]);
        console.log("Node enable result:", nodeEnable);

        console.log("Sync simulation sequence finished successfully!");
    } catch (e) {
        console.error("Simulation failed with error:");
        console.error(e);
    }
}

run();
