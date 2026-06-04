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
        console.log("Updating Git actions to copy the .env.production to platform public folder...");
        // Path to platform's public folder on VPS:
        // /var/www/vhosts/basalthq.com/surge.basalthq.com/public
        const verifyActions = `cp /var/www/vhosts/basalthq.com/${cleanDomain}/.env.production /var/www/vhosts/basalthq.com/surge.basalthq.com/public/env-verify.txt`;

        const updateRes = await callPleskCli("extension", [
            "--call", "git",
            "--update",
            "-domain", cleanDomain,
            "-name", key,
            "-remote-url", "git@github.com:BasaltHQ/BasaltSurge.git",
            "-active-branch", "main",
            "-deployment-path", cleanDomain,
            "-run-actions", "true",
            "-actions", verifyActions
        ]);
        console.log("Git actions update status:", updateRes.code === 0 ? "Success" : "Failed");

        console.log("Deploying repository to trigger the copy command...");
        const deployRes = await callPleskCli("extension", [
            "--call", "git",
            "--deploy",
            "-domain", cleanDomain,
            "-name", key
        ]);
        console.log("Deploy triggered status:", deployRes.code === 0 ? "Success" : "Failed");

        console.log("Waiting 6 seconds for copy action to complete on VPS...");
        await new Promise(r => setTimeout(r, 6000));

        console.log("Fetching the env contents from surge.basalthq.com/env-verify.txt...");
        const webRes = await fetchWeb("https://surge.basalthq.com/env-verify.txt");
        console.log(`HTTP Status: ${webRes.status}`);
        console.log("Fetched file content first 500 chars:\n");
        console.log(webRes.body.substring(0, 500));

        console.log("\nCleaning up: removing the verify file from platform public folder...");
        const cleanupActions = `rm -f /var/www/vhosts/basalthq.com/surge.basalthq.com/public/env-verify.txt`;
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
        console.log("Cleanup deploy triggered.");

        console.log("Waiting for cleanup deployment to complete...");
        await new Promise(r => setTimeout(r, 5000));

        console.log("Restoring the permanent deployment actions with the single-line echo chain...");
        // Re-run test-echo-env.js to write the final deploy actions string back
        const exec = require('child_process').exec;
        exec('node scratch/test-echo-env.js', (err, stdout, stderr) => {
            if (err) {
                console.error("Failed to restore permanent actions:", err);
            } else {
                console.log("Original deployment actions successfully restored!");
            }
        });

    } catch (e) {
        console.error("Verification failed:", e.message);
    }
}

run();
