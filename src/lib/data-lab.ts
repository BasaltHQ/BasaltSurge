/** The Data Lab query language is deliberately small and read-only. */
export type LabField = { name: string; types: string[]; present: number };
export type LabSchema = { name: string; fields: LabField[]; sampled: number };
export type LabNode = { id: string; kind: "source" | "filter" | "transform" | "output"; label: string; detail: string; x: number; y: number };
export type LabEdge = { id: string; from: string; to: string };
export type LabFlow = { name: string; nodes: LabNode[]; edges: LabEdge[]; preset?: "checkout-ab" };

const sensitive = /password|secret|private.?key|api.?key|access.?token|refresh.?token|authorization|credential|mnemonic|seed.?phrase|client.?secret|connection.?string|session.?token|otp|two.?factor|recovery.?code|pin.?hash|^(token|pin|cvv|cvc|cookie|salt)$/i;
const fieldPattern = "[a-zA-Z_][a-zA-Z0-9_]*(?:\\.[a-zA-Z_][a-zA-Z0-9_]*)*";
function safeField(field: string) {
  if (!new RegExp(`^${fieldPattern}$`).test(field)) throw new Error("Invalid field path.");
  if (field.split(".").some(part => sensitive.test(part) || ["__proto__", "prototype", "constructor"].includes(part))) {
    throw new Error("Credential fields are not available in Data Lab.");
  }
  return `c.${field}`;
}

export function compileLabQuery(source: string) {
  if (source.length > 8000) throw new Error("Queries must be under 8,000 characters.");
  const match = /^\s*SELECT\s+(?:TOP\s+(\d+)\s+)?(\*|[\w.,\s]+?)\s+FROM\s+([a-zA-Z0-9_:-]+)(?:\s+WHERE\s+([\s\S]+?))?(?:\s+ORDER\s+BY\s+([\w.]+)(?:\s+(ASC|DESC))?)?\s*;?\s*$/i.exec(source);
  if (!match) throw new Error("Use SELECT [TOP 1–500] fields FROM schema [WHERE field = 'value' AND …] [ORDER BY field DESC].");
  const limit = Number(match[1] || 100);
  if (limit < 1 || limit > 500) throw new Error("TOP must be between 1 and 500.");
  const fields = match[2] === "*" ? "*" : match[2].split(",").map(field => {
    field = field.trim();
    if (!new RegExp(`^${fieldPattern}$`).test(field)) throw new Error("Select fields by name, separated by commas.");
    return safeField(field);
  }).join(", ");
  const parameters: { name: string; value: string | number | boolean | null }[] = [{ name: "@schema", value: match[3] }];
  const clauses = ["c.type = @schema"];
  if (match[4]) {
    let rest = match[4].trim();
    const predicate = new RegExp(`^(${fieldPattern})\\s*(>=|<=|!=|=|>|<)\\s*('(?:[^']|'')*'|-?\\d+(?:\\.\\d+)?|true|false|null)(?=\\s|$)`, "i");
    while (rest) {
      const part = predicate.exec(rest);
      if (!part || parameters.length > 20) throw new Error("WHERE supports up to 20 comparisons joined by AND. Quote text with single quotes.");
      const raw = part[3];
      const value = raw.startsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : JSON.parse(raw.toLowerCase());
      const name = `@p${parameters.length}`;
      parameters.push({ name, value });
      clauses.push(`${safeField(part[1])} ${part[2]} ${name}`);
      rest = rest.slice(part[0].length).trim();
      if (!rest) break;
      if (!/^AND\s+/i.test(rest)) throw new Error("Join comparisons with AND.");
      rest = rest.replace(/^AND\s+/i, "");
      if (!rest) throw new Error("A comparison must follow AND.");
    }
  }
  const order = match[5] ? ` ORDER BY ${safeField(match[5])} ${match[6]?.toUpperCase() || "ASC"}` : "";
  return { query: `SELECT TOP ${limit} ${fields} FROM c WHERE ${clauses.join(" AND ")}${order}`, parameters, limit, schema: match[3] };
}

export function redactLabValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[Depth limit]";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 100).map(item => redactLabValue(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith("_")).map(([key, item]) => [key, sensitive.test(key) ? "[REDACTED]" : redactLabValue(item, depth + 1)]));
  if (typeof value === "string" && value.length > 10000) return `${value.slice(0, 10000)}… [truncated]`;
  return value;
}

export function inferLabFields(rows: Record<string, unknown>[]): LabField[] {
  const fields = new Map<string, { types: Set<string>; present: number }>();
  for (const row of rows) {
    const walk = (obj: Record<string, unknown>, prefix = "", depth = 0) => {
      for (const [key, value] of Object.entries(obj)) {
        if (key.startsWith("_") || sensitive.test(key)) continue;
        const name = prefix + key;
        const field = fields.get(name) || { types: new Set<string>(), present: 0 };
        field.types.add(value === null ? "null" : Array.isArray(value) ? "array" : value instanceof Date ? "date" : typeof value);
        field.present++;
        fields.set(name, field);
        if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && depth < 2) walk(value as Record<string, unknown>, `${name}.`, depth + 1);
      }
    };
    walk(row);
  }
  return [...fields.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, field]) => ({ name, types: [...field.types], present: field.present }));
}

export const starterFlow: LabFlow = {
  name: "Receipt investigation",
  nodes: [
    { id: "source", kind: "source", label: "Receipts", detail: "Explore receipt records", x: 50, y: 100 },
    { id: "filter", kind: "filter", label: "Select a cohort", detail: "Define a status or date range", x: 350, y: 100 },
    { id: "output", kind: "output", label: "Review results", detail: "Compare, investigate, export", x: 650, y: 100 },
  ],
  edges: [{ id: "a", from: "source", to: "filter" }, { id: "b", from: "filter", to: "output" }],
};

export const checkoutAbFlow: LabFlow = {
  name: "Checkout v1 vs v2", preset: "checkout-ab",
  nodes: [
    { id: "checkout-brand", kind: "source", label: "Partner brand / container", detail: "Choose the partner brand in the experiment controls. New eligible receipts only.", x: 40, y: 190 },
    { id: "checkout-assign", kind: "filter", label: "Stable 50/50 assignment", detail: "Pin one version per receipt. Explicit receipt and URL overrides are excluded from the randomized cohorts.", x: 330, y: 190 },
    { id: "checkout-v1", kind: "transform", label: "A · v1 sequential", detail: "Shared validation, identity, payment recovery and state capture. One step at a time.", x: 630, y: 70 },
    { id: "checkout-v2", kind: "transform", label: "B · v2 accordion", detail: "The same checkout logic with the accordion presentation.", x: 630, y: 310 },
    { id: "checkout-compare", kind: "output", label: "Compare outcomes", detail: "Compare assigned and exposed receipts, payment conversion, funnel reach, KYC, errors and paid order value.", x: 930, y: 190 },
  ],
  edges: [
    { id: "ab-source", from: "checkout-brand", to: "checkout-assign" },
    { id: "ab-a", from: "checkout-assign", to: "checkout-v1" }, { id: "ab-b", from: "checkout-assign", to: "checkout-v2" },
    { id: "ab-a-result", from: "checkout-v1", to: "checkout-compare" }, { id: "ab-b-result", from: "checkout-v2", to: "checkout-compare" },
  ],
};

export function isLabFlow(value: unknown): value is LabFlow {
  if (!value || typeof value !== "object") return false;
  const flow = value as LabFlow;
  if (flow.preset !== undefined && flow.preset !== "checkout-ab") return false;
  if (typeof flow.name !== "string" || flow.name.length > 100 || !Array.isArray(flow.nodes) || !Array.isArray(flow.edges) || flow.nodes.length > 100 || flow.edges.length > 300) return false;
  const ids = new Set(flow.nodes.map(node => node?.id));
  return ids.size === flow.nodes.length && new Set(flow.edges.map(edge => edge?.id)).size === flow.edges.length && flow.nodes.every(node => node && typeof node.id === "string" && ["source", "filter", "transform", "output"].includes(node.kind) && typeof node.label === "string" && node.label.length <= 100 && typeof node.detail === "string" && node.detail.length <= 4000 && Number.isFinite(node.x) && Number.isFinite(node.y) && node.x >= 0 && node.x <= 2000 && node.y >= 0 && node.y <= 1500) && flow.edges.every(edge => edge && typeof edge.id === "string" && ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to);
}
