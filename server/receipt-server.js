// ==============================================================================
// KEEPR DIGITAL OWNERSHIP VAULT: Secure Local Backend Server
// Server-Side Gemini API Proxy for Local Development & Testing ONLY
// ==============================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Read server-side secret only
let serverGeminiApiKey = process.env.GEMINI_API_KEY;
if (!serverGeminiApiKey) {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(/^GEMINI_API_KEY=(.+)$/m);
    if (match) serverGeminiApiKey = match[1].trim();
  }
}

const PORT = process.env.PORT || 3001;

// Verified active Gemini multimodal candidate cascade
const candidateModels = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-flash-latest',
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

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type, x-request-id');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'keepr-secure-receipt-backend-dev',
      port: PORT,
      geminiKeyConfigured: Boolean(serverGeminiApiKey),
    }));
    return;
  }

  if (req.method === 'POST' && (req.url === '/api/scan-receipt' || req.url === '/scan-receipt')) {
    const fallbackRequestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    if (!serverGeminiApiKey) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Receipt scanning is currently unavailable (Backend GEMINI_API_KEY missing).',
        requestId: req.headers['x-request-id'] || fallbackRequestId,
      }));
      return;
    }

    let bodyData = '';
    req.on('data', (chunk) => {
      bodyData += chunk;
    });

    req.on('end', async () => {
      try {
        const body = JSON.parse(bodyData);
        const requestId = body.requestId || req.headers['x-request-id'] || fallbackRequestId;
        const { imageBase64, mimeType = 'image/jpeg', fileName } = body;

        if (!imageBase64 || typeof imageBase64 !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Bad Request: Missing imageBase64 payload.', requestId }));
          return;
        }

        const cleanBase64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
        let resolvedMime = mimeType;
        const cleanName = (fileName || '').toLowerCase();
        if (cleanName.endsWith('.png')) resolvedMime = 'image/png';
        else if (cleanName.endsWith('.webp')) resolvedMime = 'image/webp';
        else if (cleanName.endsWith('.heic') || cleanName.endsWith('.heif')) resolvedMime = 'image/heic';

        const hashPrefix = crypto.createHash('sha256').update(cleanBase64).digest('hex').slice(0, 16);
        console.log(`[DevBackendProxy] requestId=${requestId} mime=${resolvedMime} base64Len=${cleanBase64.length} sha256Prefix=${hashPrefix}`);

        const requestPayload = {
          contents: [
            {
              role: 'user',
              parts: [
                { inlineData: { mimeType: resolvedMime, data: cleanBase64 } },
                { text: systemPrompt },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.0,
            responseMimeType: 'application/json',
          },
        };

        let response = null;
        let lastErrorText = '';
        let usedModel = '';

        for (const modelName of candidateModels) {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${serverGeminiApiKey}`;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 60000);

          try {
            console.log(`[DevBackendProxy] Attempting model: ${modelName} for requestId=${requestId}`);
            const candidateResp = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
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

            if (candidateResp.status === 400) {
              response = candidateResp;
              break;
            }

            if (candidateResp.status === 503 || candidateResp.status === 429) {
              await new Promise((resolve) => setTimeout(resolve, 2500));
              continue;
            }

            if (candidateResp.status === 404) break;
            response = candidateResp;
            break;
          } catch (e) {
            clearTimeout(timeoutId);
            lastErrorText = e.message || String(e);
          }
        }

        if (!response || !response.ok) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Receipt scanning is temporarily unavailable. Please try again.', requestId }));
          return;
        }

        const jsonResponse = await response.json();
        const candidateText = jsonResponse.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!candidateText) {
          res.writeHead(422, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: "We couldn't read this receipt clearly. Please upload a clearer photo.", requestId }));
          return;
        }

        let cleanJson = candidateText.trim();
        if (cleanJson.startsWith('```json')) cleanJson = cleanJson.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
        else if (cleanJson.startsWith('```')) cleanJson = cleanJson.replace(/^```\s*/i, '').replace(/\s*```$/i, '');

        const parsedData = JSON.parse(cleanJson);
        const rawCat = parsedData.document?.category || parsedData.documentCategory;
        const rawType = parsedData.document?.documentType || parsedData.documentType;
        let status = parsedData.status;
        if (!status) {
          if (parsedData.isReceipt === false && !parsedData.isDocument && !rawCat) {
            status = 'invalid_document';
          } else {
            status = 'success';
          }
        }
        let destination = parsedData.routing?.destination;
        if (!destination) {
          if (status === 'invalid_document') {
            destination = 'invalid';
          } else if (rawCat === 'Receipts & Invoices') {
            destination = 'item_review';
          } else if (rawCat) {
            destination = 'document_review';
          } else {
            destination = 'review_type';
          }
        }

        const normalizedPayload = {
          ...parsedData,
          status,
          document: {
            category: rawCat || null,
            documentType: rawType || null,
            confidence: parsedData.document?.confidence ?? parsedData.receiptConfidence ?? (status === 'invalid_document' ? 0.0 : 0.95),
            documentTitle: parsedData.documentTitle || parsedData.document?.documentTitle || rawType || null,
            fields: parsedData.document?.fields || {},
          },
          routing: {
            destination,
          },
          isReceipt: parsedData.isReceipt !== false && (rawCat === 'Receipts & Invoices' || parsedData.isReceipt === true),
          isDocument: Boolean(parsedData.isDocument || (rawCat && rawCat !== 'Receipts & Invoices')),
          documentCategory: rawCat || null,
          documentType: rawType || null,
          documentTitle: parsedData.documentTitle || parsedData.document?.documentTitle || rawType || null,
          source: {
            receiptImageRequired: true,
            provider: `dev-backend (${usedModel})`,
            model: usedModel,
            requestId,
          },
        };

        console.log(`[DevBackendProxy] requestId=${requestId} model=${usedModel} status=${status} cat=${rawCat} type=${rawType}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(normalizedPayload));
      } catch (err) {
        console.error(`[DevBackendProxy] Error:`, err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Internal server error', requestId }));
      }
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Keepr Secure Dev Receipt Proxy running on http://0.0.0.0:${PORT}`);
});
