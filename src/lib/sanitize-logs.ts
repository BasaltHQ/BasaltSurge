/**
 * Utility to obscure SSNs, Tax IDs, and sensitive PII from client & server logs.
 */
export function maskSensitiveData(data: any, seen = new WeakSet<object>()): any {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === "string") {
    // Obscure 9-digit SSN numbers (e.g. 492949611 or 492-94-9611) -> ***-**-9611
    return data
      .replace(/\b(cos_[A-Za-z0-9]+)_secret_[A-Za-z0-9]+\b/g, "$1_secret_[REDACTED]")
      .replace(/\b(?:liwltoken|sk_live|sk_test|rk_live|rk_test)_[A-Za-z0-9_]+\b/g, "[REDACTED]")
      .replace(/\bBearer\s+[^\s"',}]+/gi, "Bearer [REDACTED]")
      .replace(/(["']?(?:client_?secret|oauth_?token|access_?token|refresh_?token|verification_?token|crypto_?payment_?token)["']?\s*[:=]\s*["']?)[^\s"',}&]+/gi, "$1[REDACTED]")
      .replace(/\b(\d{3})[-]?(\d{2})[-]?(\d{4})\b/g, "***-**-$3");
  }

  if (data instanceof Error) {
    const sanitizedErr = new Error(maskSensitiveData(data.message));
    sanitizedErr.name = data.name;
    if (data.stack) {
      sanitizedErr.stack = maskSensitiveData(data.stack);
    }
    return sanitizedErr;
  }

  if (typeof data === "object") {
    if (seen.has(data)) return "[Circular]";
    seen.add(data);
    if (Array.isArray(data)) {
      return data.map(value => maskSensitiveData(value, seen));
    }

    const sanitized: Record<string, any> = {};
    for (const [key, val] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      const credentialKey = lowerKey.replace(/[^a-z]/g, "");
      if (["clientsecret", "oauthtoken", "accesstoken", "refreshtoken", "refreshedtoken", "verificationtoken", "cryptopaymenttoken", "authorization", "password", "secretkey"].includes(credentialKey)) {
        sanitized[key] = "[REDACTED]";
        continue;
      }
      const isSensitiveKey =
        lowerKey.includes("ssn") ||
        lowerKey.includes("tax_id") ||
        lowerKey.includes("taxid") ||
        lowerKey.includes("id_number") ||
        lowerKey.includes("idnumber") ||
        lowerKey.includes("social_security") ||
        lowerKey.includes("national_id");

      if (isSensitiveKey) {
        if (typeof val === "string") {
          const cleaned = val.replace(/\D/g, "");
          sanitized[key] = cleaned.length >= 4 ? `***-**-${cleaned.slice(-4)}` : "***-**-****";
        } else if (typeof val === "number") {
          const cleaned = String(val).replace(/\D/g, "");
          sanitized[key] = cleaned.length >= 4 ? `***-**-${cleaned.slice(-4)}` : "***-**-****";
        } else if (val && typeof val === "object" && typeof (val as any).value === "string") {
          const valObj = val as Record<string, any>;
          const cleaned = valObj.value.replace(/\D/g, "");
          sanitized[key] = {
            ...valObj,
            value: cleaned.length >= 4 ? `***-**-${cleaned.slice(-4)}` : "***-**-****"
          };
        } else {
          sanitized[key] = "***-**-****";
        }
      } else {
        sanitized[key] = maskSensitiveData(val, seen);
      }
    }
    return sanitized;
  }

  return data;
}
