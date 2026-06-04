const https = require("https");
const http = require("http");

function fetchVPSDirect(options) {
    return new Promise((resolve, reject) => {
        const lib = options.port === 443 ? https : http;
        const req = lib.request({
            ...options,
            rejectUnauthorized: false,
            timeout: 10000
        }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: Buffer.concat(chunks).toString("utf-8")
                });
            });
        });
        req.on("error", reject);
        req.end();
    });
}

async function run() {
    console.log("Querying VPS directly for pay.aipowerpay.com...");
    try {
        const res = await fetchVPSDirect({
            hostname: "51.81.186.244",
            port: 443,
            path: "/",
            method: "GET",
            headers: {
                "Host": "pay.aipowerpay.com",
                "User-Agent": "Mozilla/5.0"
            }
        });
        console.log("HTTP Status:", res.status);
        console.log("Headers:", JSON.stringify(res.headers, null, 2));
        console.log("Body Snippet (first 800 chars):\n", res.body.substring(0, 800));
    } catch (e) {
        console.error("Direct connection failed:", e.message);
    }
}

run();
