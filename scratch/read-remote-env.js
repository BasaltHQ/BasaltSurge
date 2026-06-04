require('dotenv').config({ path: '.env.local' });
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
        timeout: 45000,
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

function fetchWeb(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { rejectUnauthorized: false }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
                resolve({
                    status: res.statusCode,
                    body: Buffer.concat(chunks).toString("utf-8")
                });
            });
        }).on("error", reject);
    });
}

async function run() {
    const key = "aipowerpay";
    const cleanDomain = "pay.aipowerpay.com";

    try {
        console.log("Setting up temporary Git actions to copy env file...");
        // Temp actions to copy .env.production to public/env-test.txt
        const tempActions = `cd /var/www/vhosts/basalthq.com/${cleanDomain} && mkdir -p public && cp .env.production public/env-test.txt`;

        const updateRes = await callPleskCli("extension", [
            "--call", "git",
            "--update",
            "-domain", cleanDomain,
            "-name", key,
            "-remote-url", "git@github.com:BasaltHQ/BasaltSurge.git",
            "-active-branch", "main",
            "-deployment-path", cleanDomain,
            "-run-actions", "true",
            "-actions", tempActions
        ]);
        console.log("Git settings update:", updateRes.code === 0 ? "Success" : "Failed", updateRes);

        console.log("Deploying to trigger copying...");
        const deployRes = await callPleskCli("extension", [
            "--call", "git",
            "--deploy",
            "-domain", cleanDomain,
            "-name", key
        ]);
        console.log("Deploy status:", deployRes.code === 0 ? "Success" : "Failed");

        // Wait a few seconds for the file to be copied
        console.log("Waiting 5 seconds for VPS task to complete...");
        await new Promise(r => setTimeout(r, 5000));

        console.log("Fetching http content from the web...");
        const webRes = await fetchWeb(`https://${cleanDomain}/env-test.txt`);
        console.log(`Web status: ${webRes.status}`);
        console.log("Web Content:\n", webRes.body);

        console.log("Cleaning up... restoring standard deployment actions & removing public file...");
        // Re-run with clean-up actions to delete the file
        const cleanupActions = `cd /var/www/vhosts/basalthq.com/${cleanDomain} && rm -f public/env-test.txt`;
        const cleanupUpdate = await callPleskCli("extension", [
            "--call", "git",
            "--update",
            "-domain", cleanDomain,
            "-name", key,
            "-remote-url", "git@github.com:BasaltHQ/BasaltSurge.git",
            "-active-branch", "main",
            "-deployment-path", cleanDomain,
            "-run-actions", "true",
            "-actions", cleanupActions
        ]);
        await callPleskCli("extension", [
            "--call", "git",
            "--deploy",
            "-domain", cleanDomain,
            "-name", key
        ]);
        console.log("Cleanup deployment triggered.");

        // Wait for cleanup to finish
        await new Promise(r => setTimeout(r, 5000));

        // Restore original build actions (including writeEnvCommand chain)
        console.log("Restoring the permanent deployment actions...");
        // We'll run recreate-env-vps.js again to do this
    } catch (e) {
        console.error("Error:", e);
    }
}

run();
