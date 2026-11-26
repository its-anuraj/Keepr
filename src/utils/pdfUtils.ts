/**
 * KEEPR: Universal PDF Utilities
 * Lightweight plain-text character stream extraction and metadata analysis for searchable PDFs.
 */

/**
 * Lightweight native parser to extract plain-text character streams from searchable PDFs.
 * Scans for standard PDF text operators: (text) Tj, [(t)(e)(x)(t)] TJ, etc.
 */
export function extractNativePdfText(rawPdfBinary: string): { text: string; pageCount: number } {
  try {
    let pageCount = 1;
    const pageMatches = rawPdfBinary.match(/\/Type\s*\/Page[^s]/g);
    if (pageMatches && pageMatches.length > 0) {
      pageCount = pageMatches.length;
    }

    // Extract text blocks enclosed in parenthesis before Tj or TJ
    const textFragments: string[] = [];

    // Match (string) Tj or 'string'
    const tjRegex = /\(([^)]+)\)\s*(?:Tj|'|")/g;
    let match: RegExpExecArray | null;
    while ((match = tjRegex.exec(rawPdfBinary)) !== null) {
      const fragment = match[1]
        .replace(/\\([()\\])/g, '$1')
        .replace(/\\[nrtbf]/g, ' ')
        .trim();
      if (fragment.length > 1) {
        textFragments.push(fragment);
      }
    }

    // Match array-based [(s)(t)(r)(i)(n)(g)] TJ
    const arrayRegex = /\[([^\]]+)\]\s*TJ/g;
    while ((match = arrayRegex.exec(rawPdfBinary)) !== null) {
      const inner = match[1];
      const partRegex = /\(([^)]+)\)/g;
      let partMatch: RegExpExecArray | null;
      let assembled = '';
      while ((partMatch = partRegex.exec(inner)) !== null) {
        assembled += partMatch[1].replace(/\\([()\\])/g, '$1');
      }
      if (assembled.trim().length > 1) {
        textFragments.push(assembled.trim());
      }
    }

    const cleanText = textFragments.join(' ').replace(/\s+/g, ' ').trim();
    return {
      text: cleanText,
      pageCount: Math.max(pageCount, 1),
    };
  } catch (err) {
    console.warn('[pdfUtils] Native PDF text parsing note:', err);
    return { text: '', pageCount: 1 };
  }
}
