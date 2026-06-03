const https = require("https");
const { URL } = require("url");

const apiKey = "b66cb256-2178-3b5e-678c-37b501de2bf3";
const apiUrl = "https://vps-276db2b3.vps.ovh.us:8443/api/v2/domains";

const parsed = new URL(apiUrl);
const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "X-API-Key": apiKey,
};

const options = {
    hostname: parsed.hostname,
    port: parsed.port || 8443,
    path: parsed.pathname + parsed.search,
    method: "GET",
    headers,
    rejectUnauthorized: false,
    timeout: 10000,
};

const req = https.request(options, (res) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        console.log(`Status: ${res.statusCode}`);
        console.log("Body:\n", body);
    });
});

req.on("error", (err) => console.error("Error:", err.message));
req.end();
