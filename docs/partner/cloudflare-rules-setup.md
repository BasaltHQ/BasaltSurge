# Cloudflare Configuration & Rules Specification for Partner Containers

This guide details the exact **Cloudflare rules and security configurations** required when pointing custom partner domains (e.g. `pay.lucky13marketing.com`, `checkout.aipowerpay.com`) to a PortalPay whitelabel container.

---

## 1. Overview & Architecture

PortalPay containers are built on Next.js. Next.js uses dynamic server rendering alongside unique build chunk hashes for client scripts (`/_next/static/chunks/*`). 

Without proper Cloudflare rules:
* Edge proxies will cache stale HTML documents, causing browsers to request missing JS/CSS chunk hashes (**404 Not Found** and **MIME type `text/plain` errors**).
* Client-side JavaScript (e.g., canvas color sampling, background blur, receipt QR generators) will throw **CORS errors** (`Access-Control-Allow-Origin header missing`) when inspecting cross-origin brand images.
* Cloudflare WAF managed rules or Bot Management may intercept POST webhooks or terminal payment polling endpoints (`/api/terminal/check-payment`) with **403 Forbidden** or **401 Unauthorized**.

Follow the 4 steps below in the Cloudflare Dashboard for your domain.

---

## 2. Step-by-Step Cloudflare Configuration

### Step 1: Cache Rules (Prevents 404 Chunk & MIME Type Errors)

Go to **Caching** $\rightarrow$ **Cache Rules** in the Cloudflare Dashboard and create **two** rules:

#### **Rule A: Bypass Cache for Dynamic Pages & API (Priority: 1)**
* **Rule Name**: `Bypass Cache for Portal App and API`
* **Field Match**:
  * **URI Path** `does not start with` `/_next/static/`
* **Cache eligibility**: **Bypass cache**
* **Browser Cache TTL**: **Bypass cache** (respect origin headers)

#### **Rule B: Long-Term Caching for Static Chunks (Priority: 2)**
* **Rule Name**: `Cache Next.js Static Chunks`
* **Field Match**:
  * **URI Path** `starts with` `/_next/static/`
* **Cache eligibility**: **Eligible for cache**
* **Edge Cache TTL**: **Ignore origin and cache** $\rightarrow$ **1 Month** (or 1 Year)

---

### Step 2: Transform Rules for CORS (Fixes Cross-Origin Asset Sampling)

Standard HTML `<img>` tags display images visually, but JavaScript canvas sampling, background blur tools, or PWA caching enforce strict CORS. 

Go to **Rules** $\rightarrow$ **Transform Rules** $\rightarrow$ **Modify Response Header**:

* **Rule Name**: `PortalPay CORS Headers`
* **Expression**:
  * **Hostname** `equals` `pay.yourpartnerdomain.com` (or `(http.host contains "pay.")`)
* **Response Headers Modification**:
  * **Set static**: `Access-Control-Allow-Origin` = `*`
  * **Set static**: `Access-Control-Allow-Methods` = `GET, POST, OPTIONS, PUT, DELETE`
  * **Set static**: `Access-Control-Allow-Headers` = `*`

---

### Step 3: WAF Security Custom Rules (Unblocks API & Webhook Endpoints)

To prevent Cloudflare Bot Management or Web Application Firewall (WAF) managed rules from blocking terminal polling or developer webhooks:

Go to **Security** $\rightarrow$ **WAF** $\rightarrow$ **Custom Rules**:

* **Rule Name**: `Allow PortalPay API and Webhooks`
* **Expression**:
  * **URI Path** `starts with` `/api/`
* **Action**: **Skip**
* **WAF Components to Skip**: Select **All Managed Rules** and **Browser Integrity Check**.

---

### Step 4: SSL/TLS Encryption Mode (Prevents Redirect Loops)

Go to **SSL/TLS** $\rightarrow$ **Overview**:

* **Encryption Mode**: Set to **Full (strict)**.
* *(Note: Do NOT set to "Flexible". Next.js behind a reverse proxy will trigger infinite HTTPS redirect loops if SSL is set to Flexible).*

---

## 3. Verification & Deployment Checklist

After applying the 4 rules above:

1. **Purge Cloudflare Cache**:
   * Navigate to **Caching** $\rightarrow$ **Configuration**.
   * Click **Purge Everything**.

2. **Verify Header Responses via `curl`**:
   ```bash
   # Test API endpoint headers
   curl -I "https://pay.yourpartnerdomain.com/api/site/config"

   # Test CORS headers on static assets
   curl -I -H "Origin: https://pay.yourpartnerdomain.com" "https://pay.yourpartnerdomain.com/_next/static/css/app.css"
   ```

3. **Verify DevTools Console**:
   * Open the portal page in an Incognito window with DevTools open (`F12`).
   * Confirm there are **no 404 chunk errors**, **no 403 API errors**, and **no red CORS policy warnings**.
