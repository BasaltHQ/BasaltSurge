const https = require("https");
const { URL } = require("url");

const apiKey = "b66cb256-2178-3b5e-678c-37b501de2bf3";
const apiUrl = "https://vps-276db2b3.vps.ovh.us:8443/enterprise/control/agent.php";

const xmlPacket = `<?xml version="1.0" encoding="UTF-8"?>
<packet>
  <server>
    <get/>
  </server>
</packet>`;

const parsed = new URL(apiUrl);
const headers = {
    "Content-Type": "text/xml",
    "HTTP_PRETTY_PRINT": "TRUE",
    "KEY": apiKey,
    "Content-Length": String(Buffer.byteLength(xmlPacket, "utf-8")),
};

const options = {
    hostname: parsed.hostname,
    port: parsed.port || 8443,
    path: parsed.pathname + parsed.search,
    method: "POST",
    headers,
    rejectUnauthorized: false, // Accept self-signed certs
    timeout: 10000,
};

console.log("Testing connection to Plesk API...");
console.log("URL:", apiUrl);

const req = https.request(options, (res) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        console.log(`HTTP Status: ${res.statusCode} ${res.statusMessage}`);
        console.log("Response Body:\n", body);
    });
});

req.on("error", (err) => {
    console.error("Request Failed:", err.message);
});

req.on("timeout", () => {
    console.error("Request timed out");
    req.destroy();
});

req.write(xmlPacket);
req.end();
