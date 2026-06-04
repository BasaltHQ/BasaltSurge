import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Mock globals for NextRequest to compile
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/platform/brands/[brandKey]/provision/route";

async function run() {
    console.log("Mocking provision API call for brand 'aipowerpay'...");
    
    // We mock the request object
    const reqBody = {
        target: "plesk",
        action: "deploy",
        image: "myregistry.azurecr.io/payportal:latest",
        resourceGroup: "rg-portalpay",
        name: "pp-aipowerpay",
        location: "westus2",
        env: {
            BRAND_KEY: "aipowerpay",
            NEXT_PUBLIC_BRAND_KEY: "aipowerpay"
        },
        domains: ["pay.aipowerpay.com"]
    };

    // Construct a NextRequest. Note: we need to bypass requireThirdwebAuth if possible, 
    // but first let's see if we can call requireThirdwebAuth. Since requireThirdwebAuth relies on 
    // thirdweb cookie / auth header, let's see how it behaves.
    // If it fails with unauthorized, we can mock/patch requireThirdwebAuth temporarily for testing
    // to isolate the provisioning logic.
    
    const requestUrl = "http://localhost:3001/api/platform/brands/aipowerpay/provision";
    
    const req = new NextRequest(requestUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Cookie": "some-cookie-for-auth" // We might need to mock requireThirdwebAuth
        },
        body: JSON.stringify(reqBody)
    });

    const ctx = {
        params: Promise.resolve({ brandKey: "aipowerpay" })
    };

    try {
        console.log("Invoking POST route handler...");
        const response = await POST(req, ctx);
        console.log("Response Status:", response.status);
        const resText = await response.text();
        console.log("Response Body:", resText);
    } catch (e: any) {
        console.error("CRASH IN ROUTE HANDLER:");
        console.error(e);
        if (e.stack) {
            console.error(e.stack);
        }
    }
}

run();
