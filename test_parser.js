const { parseCosmosSql } = require("./src/lib/db/sql-parser");

const sql = "SELECT * FROM c WHERE c.id = @id";
const parameters = [{ name: "@id", value: "shopify_pending_auth:basalttest-lb1fdprz.myshopify.com" }];

try {
  const parsed = parseCosmosSql(sql, parameters);
  console.log("Parsed query:", JSON.stringify(parsed, null, 2));
} catch (e) {
  console.error("Parsing failed:", e);
}
