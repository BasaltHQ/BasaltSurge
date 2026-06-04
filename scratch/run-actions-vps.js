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
        timeout: 60000,
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
        console.log("Triggering deployment actions explicitly on VPS...");
        const actionsResult = await callPleskCli("extension", [
            "--call", "git",
            "--run-deployment-actions",
            "-domain", cleanDomain,
            "-name", key
        ]);
        console.log("Status Code:", actionsResult.code);
        console.log("stdout:\n", actionsResult.stdout);
        console.log("stderr:\n", actionsResult.stderr);
    } catch (e) {
        console.error("Failed to run actions:", e.message);
    }
}

run();
