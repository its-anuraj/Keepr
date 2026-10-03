// ==============================================================================
// KEEPR DIGITAL OWNERSHIP VAULT: Quantitative Benchmark Harness
// Evaluates full end-to-end receipt extraction (Image -> Backend -> Parser -> Reconciler)
// Measures Field-Level Accuracy, False Positives (Hallucinations),
// Missing Data, and Null Preservation against Ground Truth.
// ==============================================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { parseGeminiResponseToExtractedData } from '../src/services/receiptParser';
import { scannerCodeToCanonical } from '../src/services/categoryRules';

const CORPUS_PATH = path.join(__dirname, 'receipt-corpus', 'ground_truth.json');
const IMAGES_DIR = path.join(__dirname, '..', 'scratch', 'test-receipts');
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001/api/scan-receipt';

function normalizeStr(str: any): string | null {
  if (str === null || str === undefined) return null;
  return String(str).trim().toLowerCase().replace(/[\s\-_/\\,.]+/g, '');
}

function numericMatch(a: any, b: any, tolerance = 0.5): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  const numA = Number(a);
  const numB = Number(b);
  if (isNaN(numA) || isNaN(numB)) return false;
  return Math.abs(numA - numB) <= tolerance;
}

function stringMatch(extracted: any, groundTruth: any): boolean {
  if (groundTruth === null) {
    return extracted === null || extracted === undefined;
  }
  if (extracted === null || extracted === undefined) return false;

  const extNorm = normalizeStr(extracted);
  const gtNorm = normalizeStr(groundTruth);

  if (extNorm === gtNorm) return true;
  if (extNorm && gtNorm && (extNorm.includes(gtNorm) || gtNorm.includes(extNorm))) return true;
  return false;
}

export async function runBenchmark() {
  console.log('================================================================');
  console.log('KEEPR RECEIPT EXTRACTION BENCHMARK HARNESS');
  console.log('Full End-to-End Pipeline Evaluation with Deterministic Reconciliation');
  console.log('================================================================\n');

  if (!fs.existsSync(CORPUS_PATH)) {
    console.error(`Error: Ground truth corpus not found at ${CORPUS_PATH}`);
    process.exit(1);
  }

  const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8'));
  console.log(`Corpus Loaded: ${corpus.length} receipts\n`);

  const metrics: any = {
    totalReceipts: corpus.length,
    fieldScores: {
      merchantName: { correct: 0, missing: 0, wrong: 0, hallucinated: 0, nullPreserved: 0 },
      invoiceNumber: { correct: 0, missing: 0, wrong: 0, hallucinated: 0, nullPreserved: 0 },
      invoiceDate: { correct: 0, missing: 0, wrong: 0, hallucinated: 0, nullPreserved: 0 },
      total: { correct: 0, missing: 0, wrong: 0, hallucinated: 0, nullPreserved: 0 },
      tax: { correct: 0, missing: 0, wrong: 0, hallucinated: 0, nullPreserved: 0 },
      discount: { correct: 0, missing: 0, wrong: 0, hallucinated: 0, nullPreserved: 0 },
      subtotal: { correct: 0, missing: 0, wrong: 0, hallucinated: 0, nullPreserved: 0 },
      gstin: { correct: 0, missing: 0, wrong: 0, hallucinated: 0, nullPreserved: 0 },
      modelNumber: { correct: 0, missing: 0, wrong: 0, hallucinated: 0, nullPreserved: 0 },
      serialNumber: { correct: 0, missing: 0, wrong: 0, hallucinated: 0, nullPreserved: 0 },
      warrantyText: { correct: 0, missing: 0, wrong: 0, hallucinated: 0, nullPreserved: 0 },
      category: { correct: 0, missing: 0, wrong: 0, hallucinated: 0, nullPreserved: 0 },
    },
    itemsAccuracy: {
      totalExpectedItems: 0,
      extractedItems: 0,
      matchedItems: 0,
    },
    receiptDetails: [],
  };

  for (let i = 0; i < corpus.length; i++) {
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    const item = corpus[i];
    const imgPath = path.join(IMAGES_DIR, item.imageFile);
    console.log(`[${i + 1}/${corpus.length}] Evaluating "${item.id}" (${item.description})...`);

    if (!fs.existsSync(imgPath)) {
      console.warn(`  WARNING: Image file ${imgPath} does not exist. Skipping.`);
      continue;
    }

    const buf = fs.readFileSync(imgPath);
    const base64 = buf.toString('base64');
    const hashPrefix = crypto.createHash('sha256').update(base64).digest('hex').substring(0, 16);

    const t0 = Date.now();
    let res: any, rawJson: any;
    let attempts = 0;
    while (attempts < 2) {
      attempts++;
      try {
        res = await fetch(BACKEND_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: base64,
            mimeType: 'image/jpeg',
            fileName: item.imageFile,
          }),
        });
        rawJson = await res.json();
        if (res.ok && !rawJson.error) {
          break;
        }
        if (attempts < 2) {
          console.warn(`  Retry on error ${res.status}: ${rawJson?.message || rawJson?.error}. Waiting 4s...`);
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
      } catch (e: any) {
        if (attempts < 2) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
          console.error(`  FAIL: Network request failed: ${e.message}`);
        }
      }
    }

    if (!rawJson || rawJson.error) {
      console.error(`  FAILED to extract ${item.id}: ${rawJson?.error || 'Unknown error'}`);
    }

    const duration = Date.now() - t0;
    const gt = item.groundTruth;

    // Run raw response through Keepr domain parser with deterministic reconciliation
    const parsedData = parseGeminiResponseToExtractedData(rawJson, imgPath, item.imageFile);
    const comm = parsedData.common;

    const receiptReport: any = {
      id: item.id,
      durationMs: duration,
      model: rawJson.source?.model,
      fields: {},
    };

    // Helper to evaluate a field
    function evalField(fieldKey: string, extractedVal: any, expectedVal: any, isNumeric = false) {
      const isNullExpected = expectedVal === null || expectedVal === undefined;
      const isNullExtracted = extractedVal === null || extractedVal === undefined;

      if (isNullExpected) {
        if (isNullExtracted) {
          metrics.fieldScores[fieldKey].nullPreserved++;
          receiptReport.fields[fieldKey] = { status: 'NULL_PRESERVED', value: null };
        } else {
          metrics.fieldScores[fieldKey].hallucinated++;
          receiptReport.fields[fieldKey] = { status: 'HALLUCINATED', extracted: extractedVal, expected: null };
        }
      } else {
        if (isNullExtracted) {
          metrics.fieldScores[fieldKey].missing++;
          receiptReport.fields[fieldKey] = { status: 'MISSING', expected: expectedVal };
        } else {
          const isMatch = isNumeric
            ? numericMatch(extractedVal, expectedVal)
            : stringMatch(extractedVal, expectedVal);

          if (isMatch) {
            metrics.fieldScores[fieldKey].correct++;
            receiptReport.fields[fieldKey] = { status: 'CORRECT', value: extractedVal };
          } else {
            metrics.fieldScores[fieldKey].wrong++;
            receiptReport.fields[fieldKey] = { status: 'WRONG', extracted: extractedVal, expected: expectedVal };
          }
        }
      }
    }

    // Evaluate core scalar fields from domain ExtractedReceiptData
    evalField('merchantName', comm.merchant?.value, gt.merchantName);
    evalField('invoiceNumber', comm.invoiceNumber?.value, gt.invoiceNumber);
    evalField('invoiceDate', comm.purchaseDate?.value, gt.invoiceDate);
    evalField('total', comm.finalAmount?.value, gt.total, true);
    evalField('tax', comm.taxGst?.value, gt.tax, true);
    evalField('discount', comm.discount?.value, gt.discount, true);
    evalField('subtotal', comm.subtotal?.value, gt.subtotal, true);
    evalField('gstin', comm.gstin?.value, gt.gstin);
    evalField('modelNumber', comm.modelNumber?.value, gt.modelNumber);
    evalField('serialNumber', comm.serialNumber?.value, gt.serialNumber);
    evalField('warrantyText', comm.warrantyText?.value, gt.warrantyText);

    // Evaluate category
    const canonicalExtracted = scannerCodeToCanonical(parsedData.category);
    evalField('category', canonicalExtracted, item.category);

    // Evaluate line items
    const expectedItems = gt.items || [];
    const extractedItems = parsedData.items || [];
    metrics.itemsAccuracy.totalExpectedItems += expectedItems.length;
    metrics.itemsAccuracy.extractedItems += extractedItems.length;

    let matchedCount = 0;
    expectedItems.forEach((expItem: any) => {
      const match = extractedItems.find((extItem: any) => {
        return stringMatch(extItem.productName, expItem.name);
      });
      if (match) matchedCount++;
    });
    metrics.itemsAccuracy.matchedItems += matchedCount;

    receiptReport.itemsCount = {
      expected: expectedItems.length,
      extracted: extractedItems.length,
      matched: matchedCount,
    };

    metrics.receiptDetails.push(receiptReport);
    console.log(`  Completed in ${duration}ms (Items: ${matchedCount}/${expectedItems.length} matched)`);
  }

  // Compute summary tables
  console.log('\n================================================================');
  console.log('FIELD-LEVEL BENCHMARK RESULTS (End-to-End Pipeline)');
  console.log('================================================================');
  console.table(
    Object.keys(metrics.fieldScores).map(f => {
      const s = metrics.fieldScores[f];
      const totalOpportunities = s.correct + s.missing + s.wrong + s.hallucinated + s.nullPreserved;
      const accuracy = totalOpportunities > 0
        ? (((s.correct + s.nullPreserved) / totalOpportunities) * 100).toFixed(1) + '%'
        : 'N/A';
      return {
        Field: f,
        Correct: s.correct,
        NullPreserved: s.nullPreserved,
        Missing: s.missing,
        Wrong: s.wrong,
        Hallucinated: s.hallucinated,
        Accuracy: accuracy,
      };
    })
  );

  console.log('\n================================================================');
  console.log('LINE ITEM EXTRACTION PERFORMANCE');
  console.log('================================================================');
  console.log(`Expected Line Items:  ${metrics.itemsAccuracy.totalExpectedItems}`);
  console.log(`Extracted Line Items: ${metrics.itemsAccuracy.extractedItems}`);
  console.log(`Matched Line Items:   ${metrics.itemsAccuracy.matchedItems}`);
  const itemRecall = metrics.itemsAccuracy.totalExpectedItems > 0
    ? ((metrics.itemsAccuracy.matchedItems / metrics.itemsAccuracy.totalExpectedItems) * 100).toFixed(1)
    : 0;
  console.log(`Line Item Recall:     ${itemRecall}%\n`);

  // Compute total hallucination count across all fields
  let totalHallucinations = 0;
  let totalOpportunities = 0;
  let totalCorrect = 0;
  Object.values(metrics.fieldScores).forEach((s: any) => {
    totalHallucinations += s.hallucinated;
    totalCorrect += (s.correct + s.nullPreserved);
    totalOpportunities += (s.correct + s.missing + s.wrong + s.hallucinated + s.nullPreserved);
  });

  const overallAccuracy = ((totalCorrect / totalOpportunities) * 100).toFixed(1);
  console.log(`Overall Truthful Accuracy: ${overallAccuracy}%`);
  console.log(`Total Hallucinations:      ${totalHallucinations} (Goal: 0)`);
  console.log('================================================================\n');

  // Save results to scratch/benchmark_iteration_1.json
  const outPath = path.join(__dirname, '..', 'scratch', 'benchmark_iteration_1.json');
  fs.writeFileSync(outPath, JSON.stringify(metrics, null, 2), 'utf8');
  console.log(`Iteration 1 benchmark saved to ${outPath}`);

  return metrics;
}

runBenchmark().catch(err => {
  console.error('Benchmark execution failed:', err);
  process.exit(1);
});
