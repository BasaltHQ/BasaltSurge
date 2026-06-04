require('dotenv').config({ path: '.env.local' });
const { PleskClient } = require('../src/lib/hosting/plesk/client');

async function run() {
    const key = "aipowerpay";
    const cleanDomain = "pay.aipowerpay.com";

    console.log("Enforcing VPS settings sync directly targeting main branch...");
    const plesk = new PleskClient();

    try {
        // Step 1: Update site www-root
        console.log("Step 1: Enforcing domain www-root to pay.aipowerpay.com...");
        const updateResult = await plesk.callCli("site", [
            "--update", cleanDomain,
            "-www-root", cleanDomain
        ]);
        console.log("Update result:", updateResult);

        // Step 2: Enforce Git settings update (pointing to main branch)
        console.log("Step 2: Updating Git repository settings to main branch and pay.aipowerpay.com path...");
        const gitUpdate = await plesk.callCli("extension", [
          "--call", "git",
          "--update",
          "-domain", cleanDomain,
          "-name", key,
          "-remote-url", "git@github.com:BasaltHQ/BasaltSurge.git",
          "-active-branch", "main",
          "-deployment-path", cleanDomain,
          "-run-actions", "true",
          "-actions", `export PATH=/opt/plesk/node/24/bin:$PATH && cd /var/www/vhosts/basalthq.com/${cleanDomain} && set -a && [ -f .env.production ] && . .env.production && set +a && npm install && npm run build && mkdir -p tmp && touch tmp/restart.txt`
        ]);
        console.log("Git update result:", gitUpdate);

        // Step 3: Toggle Node.js (disable/enable) to sync document roots
        console.log("Step 3: Disabling Node.js on domain...");
        await plesk.callCli("extension", [
          "--call", "nodejs",
          "--disable",
          "-domain", cleanDomain
        ]);
        console.log("Step 4: Re-enabling Node.js on domain...");
        await plesk.callCli("extension", [
          "--call", "nodejs",
          "--enable",
          "-domain", cleanDomain
        ]);

        console.log("VPS settings sync completed successfully!");
    } catch (e) {
        console.error("Failed to sync settings:");
        console.error(e);
    }
}

run();
