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
PHASE 2: DOCUMENT TYPE CLASSIFICATION (DECIDE FIRST)
============================================================
If the image IS a valid document, determine its classification:
A. Retail Purchase Receipt / Invoice -> Category: "Receipts & Invoices"
   Document Types: "Receipt", "Invoice", "Purchase Bill"
   Destination: "item_review"
B. College / Education Fee Document -> Category: "Fees & Payments"
   Document Types: "College Fee Receipt", "Payment Receipt", "Fee Challan"
   Destination: "document_review"
C. Vehicle Document -> Category: "Vehicle Documents"
   Document Types: "RC", "Insurance", "PUC", "Vehicle Invoice", "Delivery Document"
   Destination: "document_review"
D. Warranty / Guarantee Document -> Category: "Warranty & Guarantee"
   Document Types: "Warranty Certificate", "Guarantee Certificate", "Extended Warranty"
   Destination: "document_review"
E. Insurance Document -> Category: "Vehicle Documents" (if motor) or "Other Important Documents"
   Document Types: "Insurance"
   Destination: "document_review"
F. Utility Bill -> Category: "Bills & Utilities"
   Document Types: "Electricity Bill", "Water Bill", "Internet Bill", "Gas Bill", "Other Utility Bill"
   Destination: "document_review"
G. Ownership / Purchase Document -> Category: "Ownership & Purchase"
   Document Types: "Ownership Document", "Purchase Agreement", "Delivery Proof"
   Destination: "document_review"
H. Other Important Document -> Category: "Other Important Documents"
   Document Types: "Other Important Document"
   Destination: "document_review"
I. Unknown / Uncertain (confidence < 0.60)
   Category: null, Document Type: null
   Destination: "review_type"

CANONICAL KEEPR CATEGORIES:
Must be strictly one of these 7 strings:
1. "Receipts & Invoices"
2. "Vehicle Documents"
3. "Warranty & Guarantee"
4. "Fees & Payments"
5. "Bills & Utilities"
6. "Ownership & Purchase"
7. "Other Important Documents"

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
