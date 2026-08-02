/**
 * Utility to obscure SSNs, Tax IDs, and sensitive PII from client & server logs.
 */
export function maskSensitiveData(data: any): any {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === "string") {
    // Obscure 9-digit SSN numbers (e.g. 492949611 or 492-94-9611) -> ***-**-9611
    return data.replace(/\b(\d{3})[-]?(\d{2})[-]?(\d{4})\b/g, "***-**-$3");
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
    if (Array.isArray(data)) {
      return data.map(maskSensitiveData);
    }

    const sanitized: Record<string, any> = {};
    for (const [key, val] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
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
        sanitized[key] = maskSensitiveData(val);
      }
    }
    return sanitized;
  }

  return data;
}
