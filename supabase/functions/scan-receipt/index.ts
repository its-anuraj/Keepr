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
PHASE 2: CANONICAL 3-ENTITY CLASSIFICATION (DECIDE FIRST BEFORE EXTRACTION)
============================================================
Classify the document into EXACTLY ONE of these 3 canonical entity types:

1. "PURCHASED_ITEM":
A receipt or invoice that represents purchase or acquisition of a physical, trackable product (laptop, phone, TV, refrigerator, appliances, furniture, vehicle, clothing, tools).
Evidence: product line items, quantity, unit price, item subtotal, total purchase amount, seller/merchant, purchase date, invoice number.
Subtype must be: "INVOICE" or "RECEIPT".
Destination: "item_review". isPhysicalItemPurchase: true, shouldCreateItem: true.

2. "DOCUMENT":
A document, record, certificate, or bill stored for records, administrative, legal, or utility purposes:
- College / school / university / tuition fee receipts -> Subtype: "FEE_RECEIPT" (MUST NOT become a Purchased Item)
- Electricity, water, gas, internet, mobile bills -> Subtype: "UTILITY_BILL" (MUST NOT become a Purchased Item)
- Vehicle registration certificate -> Subtype: "VEHICLE_RC" (MUST NOT become a Purchased Item)
- Vehicle / motor insurance policy -> Subtype: "VEHICLE_INSURANCE" (MUST NOT become a Purchased Item)
- Pollution Under Control certificate -> Subtype: "PUC" (MUST NOT become a Purchased Item)
- Standalone warranty or guarantee certificate -> Subtype: "WARRANTY" or "GUARANTEE"
- Payment receipts, challans, bank counterfoils -> Subtype: "PAYMENT_RECEIPT"
- Property deeds, ownership agreements -> Subtype: "OWNERSHIP_DOCUMENT"
- Delivery proofs without product lines -> Subtype: "DELIVERY_DOCUMENT"
- Other non-purchase documents -> Subtype: "OTHER"
Destination: "document_review". isPhysicalItemPurchase: false, shouldCreateItem: false.

3. "SERVICE_REPAIR":
A document or bill recording maintenance, repair, servicing, inspection, or part replacement performed on an existing product:
- Laptop or computer repair invoice (e.g. keyboard replacement, OS reinstall) -> Subtype: "SERVICE_DOCUMENT"
- Mobile phone repair receipt (e.g. screen replacement, battery change) -> Subtype: "SERVICE_DOCUMENT"
- Vehicle servicing bill or dealership service invoice (e.g. oil change, periodic maintenance) -> Subtype: "SERVICE_DOCUMENT"
- AC, washing machine, or home appliance repair bill -> Subtype: "SERVICE_DOCUMENT"
- Service center job sheet or inspection report -> Subtype: "SERVICE_DOCUMENT"
Evidence: problem/complaint, work performed, parts replaced, technician/service center, labour charge, repair total, warranty coverage.
Destination: "service_review". isPhysicalItemPurchase: false, shouldCreateItem: false.

If the document is ambiguous or confidence < 0.80:
Destination: "review_type".

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

1. RECEIPTS & INVOICES (Physical Product Purchases):
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

2. SERVICE & REPAIR (Maintenance, repairs, inspections, parts replaced):
   - serviceDate: Date of service/repair (YYYY-MM-DD)
   - serviceType: "Repair" | "Maintenance" | "Servicing" | "Inspection" | "Part Replacement" | "Software / Technical" | "Cleaning" | "Other"
   - title: Short title (e.g. "MacBook Screen Replacement", "Honda City 20,000km Service")
   - problemDescription: Issue or customer complaint
   - workPerformed: Summary of repair/service work completed
   - partsReplaced: List of parts replaced
   - technicianNotes: Technician advice or comments
   - serviceProvider: Workshop / repair center name
   - serviceProviderAddress: Address of service center
   - serviceProviderPhone: Phone number
   - warrantyCovered: "yes" | "no" | "unknown"
   - coverageType: Coverage scheme or null
   - coverageReferenceNumber: Claim # or approval #
   - amountPaid: Total service cost or amount paid (number)
   - currency: Currency code (e.g. "INR")
   - postServiceWarranty: boolean (true if repair includes post-service warranty)
   - postServiceWarrantyUntil: Expiry date of repair warranty (YYYY-MM-DD)
   - postServiceGuarantee: boolean
   - postServiceGuaranteeUntil: Expiry date of guarantee (YYYY-MM-DD)
   - relatedItemCandidates: Array of candidate item names/brands/serials mentioned (e.g. ["Honda City ZX", "DL 01 AB 1234"])

3. FEES & PAYMENTS (College, university, school, tuition, fee challans):
   - institutionName: College, university, or institute name
   - studentName: Student name
   - studentId: Student ID, roll number, enrollment number
   - course: Course or degree
   - semester: Semester or academic year
   - feeType: e.g. "College Fee Receipt", "Tuition Fee"
   - receiptNumber: Receipt or voucher #
   - paymentDate: Payment date (YYYY-MM-DD)
   - amount: Amount paid (number)
   - currency: Currency code (e.g. "INR")
   - paymentMode: Payment mode (e.g. "UPI", "Net Banking", "Card")
   - transactionReference: Transaction reference #
   - dueDate: Due date if explicitly present, else null
   - issuerName: Institution name
   - documentDate: Payment/issue date (YYYY-MM-DD)

4. VEHICLE DOCUMENTS (RC, PUC, Insurance):
   - vehicleRegistrationNumber, ownerName, vehicleMake, vehicleModel, variant, vinChassisNumber, engineNumber
   - policyNumber, insurer, registrationDate, issueDate, expiryDate, documentNumber

5. UTILITY BILL (Electricity, Water, Gas, Broadband):
   - provider, customerName, accountNumber, billNumber, billingPeriod, issueDate, dueDate, amount, currency

6. WARRANTY / GUARANTEE:
   - provider, product, brand, model, serialNumber, warrantyStartDate, warrantyEndDate, terms

============================================================
OUTPUT FORMAT (STRICT JSON ONLY)
============================================================
Return a single strictly valid JSON object matching this schema:
{
  "status": "success" | "invalid_document",
  "classification": {
    "entityType": "PURCHASED_ITEM" | "DOCUMENT" | "SERVICE_REPAIR",
    "topLevelClassification": "PURCHASE_ITEM" | "GENERAL_DOCUMENT" | "AMBIGUOUS" | "INVALID_DOCUMENT",
    "documentSubtype": string | null,
    "confidence": number,
    "reason": string,
    "isPhysicalItemPurchase": boolean | null,
    "shouldCreateItem": boolean
  },
  "routing": {
    "destination": "item_review" | "document_review" | "service_review" | "review_type" | "invalid"
  },
  "purchase": {
    "purchaseDate": string | null,
    "merchantName": string | null,
    "merchantAddress": string | null,
    "merchantPhone": string | null,
    "invoiceNumber": string | null,
    "currency": string | null,
    "subtotal": number | null,
    "discount": number | null,
    "taxAmount": number | null,
    "taxRate": string | null,
    "grandTotal": number | null,
    "products": [
      {
        "name": string,
        "category": string | null,
        "productType": string | null,
        "brand": string | null,
        "model": string | null,
        "serialNumber": string | null,
        "quantity": number,
        "unitPrice": number | null,
        "lineSubtotal": number | null,
        "lineDiscount": number | null,
        "lineTax": number | null,
        "lineTotal": number,
        "returnUntil": string | null,
        "warrantyUntil": string | null
      }
    ]
  },
  "document": {
    "category": string | null,
    "documentType": string | null,
    "confidence": number,
    "documentTitle": string | null,
    "fields": {}
  },
  "serviceRepair": {
    "serviceDate": string | null,
    "serviceType": string | null,
    "title": string | null,
    "problemDescription": string | null,
    "workPerformed": string | null,
    "partsReplaced": string | null,
    "technicianNotes": string | null,
    "serviceProvider": string | null,
    "serviceProviderAddress": string | null,
    "serviceProviderPhone": string | null,
    "warrantyCovered": "yes" | "no" | "unknown" | null,
    "coverageType": string | null,
    "coverageReferenceNumber": string | null,
    "amountPaid": number | null,
    "currency": string | null,
    "postServiceWarranty": boolean | null,
    "postServiceWarrantyUntil": string | null,
    "postServiceGuarantee": boolean | null,
    "postServiceGuaranteeUntil": string | null,
    "relatedItemCandidates": string[],
    "supportingDocumentCandidates": string[]
  },
  "warnings": [],
  "missingFields": [],

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
  "dueDate": string | null,
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
