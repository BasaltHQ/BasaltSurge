# AI Agent Integration Guide

Learn how to integrate PortalPay checkout and inventory flows using AI Coding Assistants (like Cursor, Copilot, or Gemini) equipped with custom workspace skills.

## Overview

AI Coding Assistants are highly effective at generating custom checkout pages, backend sync scripts, and webhook endpoints. To facilitate this, we provide a downloadable, pre-configured **AI Agent Skill (SKILL.md)**.

Providing this skill file directly to your AI assistant feeds it immediate, accurate context on authentication headers, payload validation, cryptographic signatures, and exact API schemas, minimizing syntax errors and security issues.

---

## AI Agent Skill Configuration

To facilitate automated e-commerce store integration, you can download our dynamic, tenant-branded AI Agent Skill configuration file:
👉 **[Download AI Agent Skill (SKILL.md)](/api/docs/download-skill)**

This skill configuration file provides detailed context and instructions to your LLM for:
- API authentication (`x-api-key`)
- Inventory registration (`POST /api/inventory`)
- Orders and checkout generation (`POST /api/orders`)
- Webhook signature checks (`HMAC-SHA256`)

> [!TIP]
> Upload this downloaded `SKILL.md` file directly into your AI coding assistant's context (e.g., dropping it into the chat box in Cursor, Copilot, or ChatGPT, or setting it as a custom system instruction) to ensure the AI writes accurate, secure integration code for your store.

---

## Core Agent Workflows

Here are the primary tasks your AI assistant can help you automate:

### 1. Catalog Syncing
Instruct the agent to write a script that connects to your e-commerce database (e.g., Shopify, WooCommerce, custom PostgreSQL) and pushes updates to the PortalPay inventory endpoint.

**API Endpoint**: `POST /api/inventory`
**Headers**:
```http
Content-Type: application/json
x-api-key: your_merchant_api_key
```

### 2. Creating Checkout Sessions
Instruct the agent to create a backend checkout route in your stack that parses user carts and creates a PortalPay receipt/order.

**API Endpoint**: `POST /api/orders`
**Payload Example**:
```json
{
  "items": [
    { "sku": "prod_1001", "qty": 2 }
  ],
  "jurisdictionCode": "US-CA"
}
```

### 3. Verifying Webhooks Cryptographically
Instruct the agent to secure your webhook endpoint by validating the signature sent in the `X-PortalPay-Signature` header. The payload is signed with the HMAC-SHA256 algorithm using your API key secret as the key.

> [!IMPORTANT]
> The signature is formatted as `sha256=<hex_digest>`. Ensure your verification function strips the prefix or validates it explicitly.

---

## Sample Agent Prompt

To bootstrap your AI assistant, upload the downloaded `SKILL.md` file to its context and use the following prompt:

```text
You are assisting in integrating my e-commerce store with the checkout system.
I have attached the custom integration skill rules (SKILL.md) and you can reference the online documentation at:
- /docs/guides/ecommerce

Based on these integration rules, write a Next.js API route that handles webhooks at `/api/webhooks/checkout`.
Make sure to parse the raw body and cryptographically verify the X-PortalPay-Signature using HMAC-SHA256 with my API key.
```

## Coding Assistant Compatibility & Usage

The downloaded `SKILL.md` file and copied documentation snippets are fully compatible and optimized for all modern AI coding assistants. Here is how to use them:

* **Cursor IDE**:
  Save the downloaded file as `SKILL.md` in your project root (or copy its contents into `.cursorrules` or a rule file in `.cursor/rules/`). In the Chat or Composer panel, reference the file using `@SKILL.md` to guide Cursor's code generation.
* **Claude Code (CLI)**:
  Save the file as `SKILL.md` in your project root. Claude Code's agentic search tools will automatically discover and read this file when you instruct it to write integration scripts or checkout logic.
* **GitHub Copilot**:
  Save the file as `SKILL.md` in your project. In the Copilot Chat window, use `#file:SKILL.md` to reference the rules during your conversation.
* **ChatGPT / Gemini (Web)**:
  Drag and drop the downloaded `SKILL.md` file into the prompt text area, or click the **Copy for LLM** button on any documentation page and paste the formatted tags as context alongside your instructions.

---

## Next Steps
- Read the [E-commerce Guide](./ecommerce.md) for complete backend and frontend code templates.
- Check the [API Reference](../api/README.md) to explore other inventory parameters and customer details.
