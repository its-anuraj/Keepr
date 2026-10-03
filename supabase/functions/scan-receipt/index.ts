// ==============================================================================
// KEEPR DIGITAL OWNERSHIP VAULT: Supabase Edge Function
// Canonical Server-Side Gemini Multimodal Receipt Scanner
// ==============================================================================
// Runtime: Deno (Supabase Edge Runtime)
// Secrets required: GEMINI_API_KEY (stored in Supabase Vault / Edge Function Secrets)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-ignore - Deno npm: specifier resolved at runtime by Supabase Edge Functions
import { createClient } from "npm:@supabase/supabase-js@2";

declare const Deno: any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const candidateModels = [
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-flash-latest",
];

const systemPrompt = `
You are the institutional-grade Document & Ownership Extraction Engine for "Keepr", a digital ownership & document vault.

============================================================
PHASE 1: DOCUMENT VALIDATION (MANDATORY FIRST STEP)
============================================================
Carefully inspect the image to determine whether it is a genuine document or receipt.

NON-DOCUMENTS (MUST BE REJECTED):
The following are strictly NON-DOCUMENTS:
- Selfies, portraits, photos of people, animals, pets, or faces
- Photos of random objects, products, or packaging WITHOUT any document text
- Landscapes, nature, rooms, interiors, buildings, or food
- Screenshots of personal chat conversations, social media memes, or random websites
- Blurry, completely unrecognizable, blank, or black images

If the image is NOT a document/receipt/bill, return strictly:
{
  "status": "invalid_document",
  "document": {
    "category": null,
    "documentType": null,
    "confidence": 0.0,
    "documentTitle": null,
    "fields": {}
  },
  "routing": {
    "destination": "invalid"
  },
  "isReceipt": false,
  "isDocument": false,
  "receiptConfidence": 0.0,
  "rejectionReason": "This image does not appear to be a supported document or receipt.",
  "message": "Please upload a clear photo of your receipt, bill, or ownership document.",
  "items": []
}

============================================================
PHASE 2: TOP-LEVEL DOCUMENT CLASSIFICATION (DECIDE FIRST BEFORE EXTRACTION)
============================================================
Classify the document into EXACTLY ONE of these 4 top-level classes:

1. "PURCHASE_ITEM":
A receipt or invoice that represents purchase/acquisition of a physical item/product that Keepr should track as an Item (electronics, appliances, vehicles, furniture, clothing, accessories, etc.).
Strong signals: product/item line items, product names, quantity, unit price, item subtotal, total purchase amount, seller/merchant, purchase date, invoice/receipt number, SKU/model.
Subtype must be: "INVOICE" or "RECEIPT".
Destination: "item_review". isPhysicalItemPurchase: true, shouldCreateItem: true.

2. "GENERAL_DOCUMENT":
A valid document that should live in Documents and does NOT represent the purchase of a trackable physical item.
CRITICAL: These must NEVER become Items:
- College / school / university / tuition fee receipts -> Subtype: "FEE_RECEIPT" (Do NOT create an Item named "College Fee")
- Electricity, water, gas, internet, mobile bills -> Subtype: "UTILITY_BILL" (Do NOT create an Item)
- Vehicle registration certificate -> Subtype: "VEHICLE_RC" (Do NOT create an Item)
- Vehicle / motor insurance policy -> Subtype: "VEHICLE_INSURANCE" (Do NOT create an Item)
- Pollution Under Control certificate -> Subtype: "PUC" (Do NOT create an Item)
- Standalone warranty or guarantee certificate -> Subtype: "WARRANTY", "GUARANTEE", or "EXTENDED_WARRANTY"
- Service / repair invoice without physical item purchase (e.g. AC service, labour charges) -> Subtype: "SERVICE_DOCUMENT"
- Bank payment slip, counterfoil, rent receipt -> Subtype: "PAYMENT_RECEIPT"
- Delivery document without clear purchase items -> Subtype: "DELIVERY_DOCUMENT"
- Property deed, ownership document -> Subtype: "OWNERSHIP_DOCUMENT"
- Other non-purchase documents -> Subtype: "OTHER"
Destination: "document_review". isPhysicalItemPurchase: false, shouldCreateItem: false.

3. "AMBIGUOUS":
The model cannot confidently determine whether a physical item was purchased.
Destination: "review_type". isPhysicalItemPurchase: null, shouldCreateItem: false.

4. "INVALID_DOCUMENT":
Not a supported receipt/document/image, unreadable, corrupted, or unrelated content.
Destination: "invalid". isPhysicalItemPurchase: false, shouldCreateItem: false.

CRITICAL RULE:
A receipt or invoice does NOT automatically mean PURCHASE_ITEM.
The actual question is: "Does this document prove purchase of a physical item that should become a Keepr Item?"
If the document is a college fee receipt, electricity bill, vehicle RC, insurance, or AC service invoice, it MUST be GENERAL_DOCUMENT.

CANONICAL KEEPR CATEGORIES (For Documents Vault):
Must be strictly one of these 7 strings:
1. "Receipts & Invoices" (Only for physical item purchases)
2. "Vehicle Documents" (RC, PUC, Insurance, Vehicle Invoices)
3. "Warranty & Guarantee" (Warranty cards, guarantee terms)
4. "Fees & Payments" (College fees, school fees, payment receipts)
5. "Bills & Utilities" (Electricity, water, gas, broadband bills)
6. "Ownership & Purchase" (Deeds, agreements, ownership proof)
7. "Other Important Documents" (Miscellaneous certificates)

============================================================
PHASE 3: CATEGORY-SPECIFIC SCHEMA EXTRACTION
============================================================
Read ONLY what is visually legible on the document. NEVER invent, guess, or hallucinate missing data!

1. RECEIPTS & INVOICES (Retail store receipts, online purchases, tax invoices):
   Extract:
   - merchantName: Store or seller name
   - merchantAddress: Address of store/seller
   - merchantPhone: Phone number
   - merchantGstin: GSTIN number or tax ID
   - invoiceNumber: Invoice or receipt #
   - purchaseDate: Date of purchase (YYYY-MM-DD)
   - currency: Currency code (e.g. INR, USD)
   - subtotal: Subtotal number before tax/discount or null
   - discount: Discount amount or null
   - taxAmount: Total tax amount or null
   - taxRate: Tax rate string (e.g. "18%") or null
   - grandTotal: Final total paid (number)
   - items: Array of purchased items [ { name, category, productType, brand, model, serialNumber, quantity, unitPrice, lineSubtotal, lineDiscount, lineTax, lineTotal, returnUntil, warrantyUntil } ]

2. FEES & PAYMENTS (College, university, school, tuition, fee challans):
   Extract:
   - institutionName: College, university, or institute name
   - studentName: Student name
   - studentId: Student ID, roll number, enrollment number
   - course: Course or degree (e.g. "B.Tech Computer Science")
   - semester: Semester or academic year
   - feeType: e.g. "College Fee Receipt", "Tuition Fee", "Exam Fee", "Hostel Fee"
   - receiptNumber: Receipt or voucher #
   - paymentDate: Payment date (YYYY-MM-DD)
   - amount: Amount paid (number)
   - currency: Currency code (e.g. "INR")
   - paymentMode: Payment mode (e.g. "UPI", "Net Banking", "Card", "DD", "Cash")
   - transactionReference: Transaction reference # or UTR
   - dueDate: Due date if explicitly present, else null
   - issuerName: Institution name
   - documentDate: Payment/issue date (YYYY-MM-DD)
   CRITICAL: Do NOT create fake productName, purchasePrice, merchant, returnUntil, or warrantyUntil for Fee receipts!
   Category is "Fees & Payments", Document Type is "College Fee Receipt". Destination is "document_review".

3. VEHICLE DOCUMENTS (RC, PUC, Vehicle Invoice, Delivery Proof):
   Extract:
   - vehicleRegistrationNumber: License plate / registration #
   - ownerName: Owner name
   - vehicleMake: Manufacturer (e.g. "Honda", "Hyundai", "Tata")
   - vehicleModel: Model (e.g. "City", "Creta", "Nexon")
   - variant: Trim / variant (e.g. "ZX CVT")
   - vinChassisNumber: Chassis number / VIN
   - engineNumber: Engine number
   - policyNumber: Policy number if insurance
   - insurer: Insurer name if insurance
   - registrationDate: Registration date (YYYY-MM-DD)
   - issueDate: Issue date (YYYY-MM-DD)
   - expiryDate: Expiry date of RC or PUC (YYYY-MM-DD)
   - documentNumber: Certificate / document #
   - dealer: Dealership name
   - purchaseDate: Purchase date (YYYY-MM-DD)
   - amount: Amount if invoice or fee
   CRITICAL: Return deadline is strictly null. Never assume or fabricate warranty for vehicles!

4. INSURANCE (Motor, Health, Life policy documents):
   Extract:
   - policyNumber: Insurance policy #
   - insurer: Insurance company
   - insuredName: Policyholder name
   - vehicleNumber: Vehicle plate number if motor insurance
   - policyStartDate: Policy start date (YYYY-MM-DD)
   - policyExpiryDate: Policy expiry date (YYYY-MM-DD)
   - premiumAmount: Premium amount paid (number)
   - vehicleDetails: Make/model if present
   - documentNumber: Policy schedule or certificate #
   CRITICAL: Expiry date is policy expiry, NOT product warranty!

5. WARRANTY / GUARANTEE:
   Extract:
   - provider: Manufacturer or warranty provider
   - product: Covered product
   - brand: Brand
   - model: Model
   - serialNumber: Serial #
   - warrantyStartDate: Start date (YYYY-MM-DD)
   - warrantyEndDate: End date (YYYY-MM-DD)
   - guaranteeStartDate: Guarantee start date (YYYY-MM-DD)
   - guaranteeEndDate: Guarantee end date (YYYY-MM-DD)
   - terms: Brief summary of terms
   - documentNumber: Warranty certificate / card #
   CRITICAL: Never invent warranty end date. If duration is explicitly printed, calculate from start date, otherwise null.

6. UTILITY BILL (Electricity, Water, Gas, Broadband):
   Extract:
   - provider: Utility provider (e.g. BSES, Bescom, Tata Power)
   - customerName: Consumer name
   - accountNumber: Consumer number / CA number / account ID
   - billNumber: Bill # or invoice #
   - billingPeriod: e.g. "Sep 2026"
   - issueDate: Bill date (YYYY-MM-DD)
   - dueDate: Due date (YYYY-MM-DD)
   - amount: Bill amount payable (number)
   - currency: Currency code (e.g. "INR")
   - address: Service address
   - meterNumber: Meter number if printed

7. OWNERSHIP & PURCHASE:
   Extract:
   - owner: Owner name
   - seller: Seller name
   - documentNumber: Agreement / deed #
   - purchaseDate: Date (YYYY-MM-DD)
   - amount: Consideration amount (number)
   - description: Description of asset / property
   - referenceNumbers: Reference / registry numbers
   - issuer: Authority or issuing party
   - dates: Relevant dates
   - address: Asset / property address

============================================================
OUTPUT FORMAT (STRICT JSON ONLY)
============================================================
Return a single strictly valid JSON object matching this schema:
{
  "status": "success" | "invalid_document",
  "classification": {
    "topLevelClassification": "PURCHASE_ITEM" | "GENERAL_DOCUMENT" | "AMBIGUOUS" | "INVALID_DOCUMENT",
    "documentSubtype": "INVOICE" | "RECEIPT" | "FEE_RECEIPT" | "PAYMENT_RECEIPT" | "VEHICLE_RC" | "VEHICLE_INSURANCE" | "PUC" | "WARRANTY" | "GUARANTEE" | "EXTENDED_WARRANTY" | "UTILITY_BILL" | "DELIVERY_DOCUMENT" | "SERVICE_DOCUMENT" | "OWNERSHIP_DOCUMENT" | "OTHER" | null,
    "confidence": number,
    "reason": string,
    "isPhysicalItemPurchase": boolean | null,
    "shouldCreateItem": boolean
  },
  "document": {
    "category": "Receipts & Invoices" | "Vehicle Documents" | "Warranty & Guarantee" | "Fees & Payments" | "Bills & Utilities" | "Ownership & Purchase" | "Other Important Documents" | null,
    "documentType": string | null,
    "confidence": number,
    "documentTitle": string | null,
    "fields": { ...categorySpecificFieldsOnly... }
  },
  "routing": {
    "destination": "document_review" | "item_review" | "review_type" | "invalid"
  },
  "isReceipt": boolean,
  "isDocument": boolean,
  "documentCategory": string | null,
  "documentType": string | null,
  "documentTitle": string | null,
  "receiptNumber": string | null,
  "referenceNumber": string | null,
  "purchaseDate": string | null,
  "documentDate": string | null,
  "expiryDate": string | null,
  "merchantName": string | null,
  "issuerName": string | null,
  "merchantAddress": string | null,
  "merchantPhone": string | null,
  "merchantGstin": string | null,
  "currency": string | null,
  "subtotal": number | null,
  "discount": number | null,
  "taxAmount": number | null,
  "taxRate": string | null,
  "grandTotal": number | null,
  "items": [
    {
      "name": string | null,
      "category": string | null,
      "productType": string | null,
      "brand": string | null,
      "model": string | null,
      "serialNumber": string | null,
      "quantity": number | null,
      "unitPrice": number | null,
      "lineSubtotal": number | null,
      "lineDiscount": number | null,
      "lineTax": number | null,
      "lineTotal": number | null,
      "returnUntil": string | null,
      "warrantyUntil": string | null
    }
  ]
}
Return ONLY pure JSON. No markdown backticks, no preamble.
`;

Deno.serve(async (req: Request) => {
  // 1. CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let requestId = req.headers.get("x-request-id") || `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  try {
    // 2. Validate Server-Side Secret Presence (Never logged or leaked)
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) {
      console.error(`[ScanReceipt] ERROR: Missing GEMINI_API_KEY in server secrets for requestId=${requestId}`);
      return new Response(
        JSON.stringify({
          error: "Receipt scanning is temporarily unavailable (Server secret unconfigured).",
          requestId,
        }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Missing Authorization header.", requestId }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    if (supabaseUrl && supabaseAnonKey) {
      try {
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();

        // 1. Check if token is a valid Supabase user session
        const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: authHeader } },
          auth: { persistSession: false },
        });
        const { data: { user } } = await supabaseClient.auth.getUser(token);

        if (user) {
          console.log(`[ScanReceipt] Authenticated user=${user.id} for requestId=${requestId}`);
        } else if (token === supabaseAnonKey) {
          console.log(`[ScanReceipt] Authenticated via Keepr client key for requestId=${requestId}`);
        } else {
          console.warn(`[ScanReceipt] Auth verification rejected for requestId=${requestId}`);
          return new Response(
            JSON.stringify({ error: "Unauthorized: Invalid or expired session.", requestId }),
            {
              status: 401,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      } catch (authErr: any) {
        console.warn(`[ScanReceipt] Auth service exception:`, authErr?.message);
      }
    }

    const body = await req.json();
    if (body.requestId) {
      requestId = body.requestId;
    }
    const { imageBase64, mimeType = "image/jpeg", fileName } = body;

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return new Response(
        JSON.stringify({ error: "Bad Request: Missing imageBase64 payload.", requestId }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const cleanBase64 = imageBase64.includes(",")
      ? imageBase64.split(",")[1]
      : imageBase64;

    let resolvedMime = mimeType;
    const cleanName = (fileName || "").toLowerCase();
    if (cleanName.endsWith(".png")) resolvedMime = "image/png";
    else if (cleanName.endsWith(".webp")) resolvedMime = "image/webp";
    else if (cleanName.endsWith(".heic") || cleanName.endsWith(".heif")) resolvedMime = "image/heic";

    // Safe diagnostic telemetry: SHA-256 hash prefix
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(cleanBase64));
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const hashPrefix = hashHex.slice(0, 16);

    console.log(`[ScanReceipt] requestId=${requestId} mime=${resolvedMime} base64Len=${cleanBase64.length} sha256Prefix=${hashPrefix}`);

    const requestPayload = {
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: resolvedMime,
                data: cleanBase64,
              },
            },
            {
              text: systemPrompt,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.0,
        responseMimeType: "application/json",
      },
    };

    let response: Response | null = null;
    let lastErrorText = "";
    let usedModel = "";
    const startTime = Date.now();

    for (const modelName of candidateModels) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      try {
        console.log(`[ScanReceipt] Attempting model ${modelName} for requestId=${requestId}`);
        const candidateResp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestPayload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (candidateResp.ok) {
          response = candidateResp;
          usedModel = modelName;
          break;
        }

        const errText = await candidateResp.text();
        lastErrorText = errText;
        console.warn(`[ScanReceipt] Model ${modelName} returned status ${candidateResp.status}: ${errText.slice(0, 150)}`);

        if (candidateResp.status === 400) {
          return new Response(
            JSON.stringify({ error: "Invalid image format or corrupted image file.", requestId }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        if (candidateResp.status === 503 || candidateResp.status === 429) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          continue;
        }

        if (candidateResp.status === 404) {
          continue;
        }

        response = candidateResp;
        break;
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastErrorText = err.message || String(err);
        console.warn(`[ScanReceipt] Model ${modelName} fetch error: ${lastErrorText}`);
      }
    }

    const durationMs = Date.now() - startTime;

    if (!response || !response.ok) {
      console.error(`[ScanReceipt] All Gemini candidates failed for requestId=${requestId}. Duration=${durationMs}ms Error=${lastErrorText.slice(0, 200)}`);
      return new Response(
        JSON.stringify({ error: "Receipt scanning is temporarily unavailable. Please try again.", requestId }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const jsonResponse = await response.json();
    const candidateText = jsonResponse.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!candidateText) {
      return new Response(
        JSON.stringify({ error: "We couldn't read this receipt clearly. Please upload a clearer photo.", requestId }),
        {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let cleanJson = candidateText.trim();
    if (cleanJson.startsWith("```json")) {
      cleanJson = cleanJson.replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
    } else if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson.replace(/^```\s*/i, "").replace(/\s*```$/i, "");
    }

    const parsedData = JSON.parse(cleanJson);
    const rawCat = parsedData.document?.category || parsedData.documentCategory;
    const rawType = parsedData.document?.documentType || parsedData.documentType;
    let status = parsedData.status;
    if (!status) {
      if (parsedData.isReceipt === false && !parsedData.isDocument && !rawCat) {
        status = "invalid_document";
      } else {
        status = "success";
      }
    }
    let destination = parsedData.routing?.destination;
    let classification = parsedData.classification;

    if (!classification) {
      if (status === "invalid_document") {
        classification = {
          topLevelClassification: "INVALID_DOCUMENT",
          documentSubtype: null,
          confidence: 0.99,
          reason: "Image does not appear to be a supported receipt or document.",
          isPhysicalItemPurchase: false,
          shouldCreateItem: false,
        };
      } else if (rawCat === "Receipts & Invoices" && Array.isArray(parsedData.items) && parsedData.items.length > 0) {
        classification = {
          topLevelClassification: "PURCHASE_ITEM",
          documentSubtype: rawType === "Invoice" ? "INVOICE" : "RECEIPT",
          confidence: parsedData.document?.confidence ?? 0.95,
          reason: "Document contains physical item purchase line items.",
          isPhysicalItemPurchase: true,
          shouldCreateItem: true,
        };
      } else if (rawCat && rawCat !== "Receipts & Invoices") {
        let sub: string = "OTHER";
        if (rawType?.includes("Fee")) sub = "FEE_RECEIPT";
        else if (rawType?.includes("Electricity") || rawType?.includes("Water") || rawType?.includes("Bill")) sub = "UTILITY_BILL";
        else if (rawType?.includes("Insurance")) sub = "VEHICLE_INSURANCE";
        else if (rawType?.includes("RC")) sub = "VEHICLE_RC";
        else if (rawType?.includes("PUC")) sub = "PUC";
        else if (rawType?.includes("Warranty")) sub = "WARRANTY";
        else if (rawType?.includes("Guarantee")) sub = "GUARANTEE";
        classification = {
          topLevelClassification: "GENERAL_DOCUMENT",
          documentSubtype: sub,
          confidence: parsedData.document?.confidence ?? 0.95,
          reason: "Document represents general ownership or institutional record.",
          isPhysicalItemPurchase: false,
          shouldCreateItem: false,
        };
      } else {
        classification = {
          topLevelClassification: "AMBIGUOUS",
          documentSubtype: null,
          confidence: 0.50,
          reason: "Unable to determine with high confidence if a physical item was purchased.",
          isPhysicalItemPurchase: null,
          shouldCreateItem: false,
        };
      }
    }

    if (!destination) {
      if (classification.topLevelClassification === "INVALID_DOCUMENT") {
        destination = "invalid";
      } else if (classification.topLevelClassification === "PURCHASE_ITEM") {
        destination = "item_review";
      } else if (classification.topLevelClassification === "GENERAL_DOCUMENT") {
        destination = "document_review";
      } else {
        destination = "review_type";
      }
    }

    const normalizedPayload = {
      ...parsedData,
      status,
      classification,
      document: {
        category: rawCat || null,
        documentType: rawType || null,
        confidence: classification.confidence ?? (status === "invalid_document" ? 0.0 : 0.95),
        documentTitle: parsedData.documentTitle || parsedData.document?.documentTitle || rawType || null,
        fields: parsedData.document?.fields || {},
      },
      routing: {
        destination,
      },
      isReceipt: classification.topLevelClassification === "PURCHASE_ITEM",
      isDocument: classification.topLevelClassification === "GENERAL_DOCUMENT",
      documentCategory: rawCat || null,
      documentType: rawType || null,
      documentTitle: parsedData.documentTitle || parsedData.document?.documentTitle || rawType || null,
      source: {
        receiptImageRequired: true,
        provider: `supabase-edge-function (${usedModel})`,
        model: usedModel,
        requestId,
      },
    };

    console.log(`[ScanReceipt] Success requestId=${requestId} model=${usedModel} status=${status} cat=${rawCat} type=${rawType}`);

    return new Response(
      JSON.stringify(normalizedPayload),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error(`[ScanReceipt] Uncaught error:`, error?.message);
    return new Response(
      JSON.stringify({ error: "Receipt scanning is temporarily unavailable. Please try again.", requestId }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
