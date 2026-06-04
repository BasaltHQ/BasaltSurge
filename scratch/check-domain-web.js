const https = require("https");

function fetchWeb(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { rejectUnauthorized: false }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: Buffer.concat(chunks).toString("utf-8")
                });
            });
        }).on("error", reject);
    });
}

async function run() {
    try {
        console.log("Fetching https://pay.aipowerpay.com/ ...");
        const res = await fetchWeb("https://pay.aipowerpay.com/");
        console.log("HTTP Status:", res.status);
        console.log("Headers:", JSON.stringify(res.headers, null, 2));
        console.log("Body Snippet (first 400 chars):\n", res.body.substring(0, 400));
    } catch (e) {
        console.error("Error fetching:", e.message);
    }
}

run();
