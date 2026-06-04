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

async function run() {
    const key = "aipowerpay";
    const cleanDomain = "pay.aipowerpay.com";
    const conn = process.env.COSMOS_CONNECTION_STRING || process.env.MONGODB_CONNECTION_STRING || process.env.DB_CONNECTION_STRING;

    try {
        console.log("Updating Git actions to run diagnostic DB writer...");
        
        // Single-line Node.js command that executes on the VPS during deploy
        const nodeScript = `const fs = require('fs'); const { MongoClient } = require('mongodb'); const file = '.env.production'; const exists = fs.existsSync(file); const size = exists ? fs.statSync(file).size : 0; const content = exists ? fs.readFileSync(file, 'utf8') : ''; const client = new MongoClient('${conn}'); client.connect().then(async () => { const db = client.db('surge'); const coll = db.collection('surge_events'); await coll.updateOne({ id: 'diagnostic:env', brandKey: 'aipowerpay' }, { $set: { exists, size, contentSnippet: content.substring(0, 1500), updatedAt: new Date() } }, { upsert: true }); await client.close(); console.log('DB Report complete'); }).catch(e => { console.error(e); });`;
        
        // Double escape single quotes for bash
        const escapedNodeScript = nodeScript.replace(/'/g, "'\\''");
        const diagnosticActions = `export PATH=/opt/plesk/node/24/bin:$PATH && cd /var/www/vhosts/basalthq.com/${cleanDomain} && node -e '${escapedNodeScript}'`;

        const updateRes = await callPleskCli("extension", [
            "--call", "git",
            "--update",
            "-domain", cleanDomain,
            "-name", key,
            "-remote-url", "git@github.com:BasaltHQ/BasaltSurge.git",
            "-active-branch", "main",
            "-deployment-path", cleanDomain,
            "-run-actions", "true",
            "-actions", diagnosticActions
        ]);
        console.log("Git actions update status:", updateRes.code === 0 ? "Success" : "Failed");

        console.log("Deploying repository to trigger the diagnostic reporter...");
        const deployRes = await callPleskCli("extension", [
            "--call", "git",
            "--deploy",
            "-domain", cleanDomain,
            "-name", key
        ]);
        console.log("Deploy triggered status:", deployRes.code === 0 ? "Success" : "Failed");

        console.log("Waiting 8 seconds for reporter to complete on VPS...");
        await new Promise(r => setTimeout(r, 8000));

        console.log("Fetching diagnostic report from Cosmos DB...");
        const client = new MongoClient(conn);
        await client.connect();
        const db = client.db('surge');
        const coll = db.collection('surge_events');
        const report = await coll.findOne({ id: 'diagnostic:env', brandKey: 'aipowerpay' });
        console.log("=== DIAGNOSTIC REPORT FROM VPS ===");
        console.log(JSON.stringify(report, null, 2));
        await client.close();

        // Restore original build actions (including writeEnvCommand chain)
        console.log("\nRestoring the permanent deployment actions...");
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
