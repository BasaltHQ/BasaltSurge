require('dotenv').config({ path: '.env.local' });
const { PleskClient } = require('../src/lib/hosting/plesk/client');

async function main() {
    console.log("Testing Plesk REST API Connection...");
    console.log("PLESK_API_URL:", process.env.PLESK_API_URL);
    console.log("PLESK_MAIN_DOMAIN:", process.env.PLESK_MAIN_DOMAIN);
    console.log("PLESK_API_KEY:", process.env.PLESK_API_KEY ? "CONFIGURED (Ends with " + process.env.PLESK_API_KEY.slice(-4) + ")" : "MISSING");

    const plesk = new PleskClient();
    try {
        console.log("Attempting to list domains using Plesk CLI via REST API...");
        const result = await plesk.callCli("domain", ["--list"]);
        console.log("Connection successful!");
        console.log("Status code:", result.code);
        console.log("Output (first 200 chars):", (result.stdout || result.stderr || "").slice(0, 200));
    } catch (err) {
        console.error("Connection failed with error:");
        console.error(err.message);
    }
}

main();
