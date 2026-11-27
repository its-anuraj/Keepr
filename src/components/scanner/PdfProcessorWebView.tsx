import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
import {
  classifyPdfPages,
  DEFAULT_MAX_PDF_PAGES,
  PdfDocumentType,
  PdfPageTextInfo,
  PdfValidationErrorCode,
  TEXT_DENSE_MIN_CHARS_PER_PAGE,
} from '../../services/pdfReceiptProcessor';
import type { PdfPageRegionPayload } from '../../types/scanner';

export interface ProcessedPdfPageOutput extends PdfPageTextInfo {
  renderedImageBase64?: string | null;
  renderedImageMimeType?: 'image/jpeg';
  tempImageUri?: string | null;
  regions?: PdfPageRegionPayload[];
  status?: 'ok' | 'failed';
}

export interface PdfWebViewProcessResult {
  success: boolean;
  totalPages: number;
  processedPages: number;
  truncatedByPageLimit: boolean;
  pdfType: PdfDocumentType;
  combinedText: string;
  pages: ProcessedPdfPageOutput[];
  tempImageUris: string[];
  failedPages?: Array<{ pageNumber: number; error: string }>;
  errorCode?: PdfValidationErrorCode;
  errorMessage?: string;
}

export interface PdfProcessorOptions {
  maxPages?: number;
  renderScale?: number;
  onProgress?: (progress: { stage: string; currentPage?: number; totalPages?: number }) => void;
}

export interface PdfProcessorWebViewHandle {
  processPdf: (base64: string, options?: PdfProcessorOptions) => Promise<PdfWebViewProcessResult>;
}

interface PendingJob {
  jobId: string;
  base64: string;
  maxPages: number;
  renderScale: number;
  onProgress?: PdfProcessorOptions['onProgress'];
  resolve: (result: PdfWebViewProcessResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const PDFJS_VERSION = '3.11.174';

/**
 * Safely clean up temporary rendered JPEG page files created during scanned PDF OCR.
 * NEVER deletes or touches the user's original PDF file.
 */
export async function cleanupTempPdfRenderFiles(uris: string[]): Promise<void> {
  if (!Array.isArray(uris) || uris.length === 0) return;
  await Promise.all(
    uris.map(async (uri) => {
      if (!uri) return;
      try {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      } catch {
        // Non-fatal cache cleanup warning
      }
    })
  );
}

/**
 * Hidden offscreen WebView powered by PDF.js that:
 * 1. Inspects ALL pages in a PDF cleanly with isolated per-page error handling.
 * 2. Extracts reading-order text per page and detects multi-image / embedded receipt regions.
 * 3. Renders full pages AND crops separate receipt sub-regions when a single PDF page contains multiple receipt images.
 */
export const PdfProcessorWebView = forwardRef<PdfProcessorWebViewHandle, Record<string, unknown>>(
  function PdfProcessorWebView(_props, ref) {
    const webViewRef = useRef<WebView | null>(null);
    const [webViewReady, setWebViewReady] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);
    const pendingJobsRef = useRef<Map<string, PendingJob>>(new Map());
    const queuedDispatchRef = useRef<Array<string>>([]);

    const processorHtml = useMemo(
      () => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js"></script>
</head>
<body>
<script>
(function() {
  function post(payload) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }

  function decodeBase64(b64) {
    var clean = (b64 || '').replace(/^data:[^;]+;base64,/, '').replace(/\\s+/g, '');
    var raw = atob(clean);
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) {
      arr[i] = raw.charCodeAt(i);
    }
    return arr;
  }

  function extractStructuredTextFromContent(textContent) {
    if (!textContent || !Array.isArray(textContent.items)) return '';
    var items = textContent.items.filter(function(it) {
      return it && typeof it.str === 'string' && it.str.length > 0;
    });
    if (items.length === 0) return '';

    items.sort(function(a, b) {
      var ay = (a.transform && a.transform[5]) || 0;
      var by = (b.transform && b.transform[5]) || 0;
      if (Math.abs(by - ay) > 4.0) return by - ay;
      var ax = (a.transform && a.transform[4]) || 0;
      var bx = (b.transform && b.transform[4]) || 0;
      return ax - bx;
    });

    var lines = [];
    var currentLine = [];
    var lastY = null;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var y = (item.transform && item.transform[5]) || 0;
      if (lastY === null || Math.abs(y - lastY) <= 4.0) {
        currentLine.push(item.str);
      } else {
        var lineText = currentLine.join(' ').replace(/\\s+/g, ' ').trim();
        if (lineText) lines.push(lineText);
        currentLine = [item.str];
      }
      lastY = y;
    }
    if (currentLine.length > 0) {
      var lastLineText = currentLine.join(' ').replace(/\\s+/g, ' ').trim();
      if (lastLineText) lines.push(lastLineText);
    }
    return lines.join('\\n').trim();
  }

  function multiplyMatrix(m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];
  }

  function rectOverlapRatio(a, b) {
    var ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    var iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    var inter = ix * iy;
    var minArea = Math.max(1, Math.min(a.width * a.height, b.width * b.height));
    return inter / minArea;
  }

  async function inspectPageImageRegions(page, pageViewport) {
    try {
      var opList = await page.getOperatorList();
      if (!opList || !Array.isArray(opList.fnArray)) {
        return { hasImages: false, imageCount: 0, regions: [] };
      }
      var OPS = window.pdfjsLib && window.pdfjsLib.OPS;
      if (!OPS) return { hasImages: false, imageCount: 0, regions: [] };

      var ctm = pageViewport.transform.slice(0);
      var stack = [];
      var rawRects = [];
      var totalImageOps = 0;

      for (var i = 0; i < opList.fnArray.length; i++) {
        var fn = opList.fnArray[i];
        var args = opList.argsArray[i];

        if (fn === OPS.save) {
          stack.push(ctm.slice(0));
        } else if (fn === OPS.restore) {
          if (stack.length > 0) ctm = stack.pop();
        } else if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
          ctm = multiplyMatrix(ctm, args);
        } else if (
          fn === OPS.paintImageXObject ||
          fn === OPS.paintInlineImageXObject ||
          fn === OPS.paintJpegXObject
        ) {
          totalImageOps++;
          // In PDF user space, images map unit square (0,0)-(1,1) through CTM
          var corners = [
            [ctm[4], ctm[5]],
            [ctm[0] + ctm[4], ctm[1] + ctm[5]],
            [ctm[2] + ctm[4], ctm[3] + ctm[5]],
            [ctm[0] + ctm[2] + ctm[4], ctm[1] + ctm[3] + ctm[5]]
          ];
          var minX = Math.min(corners[0][0], corners[1][0], corners[2][0], corners[3][0]);
          var maxX = Math.max(corners[0][0], corners[1][0], corners[2][0], corners[3][0]);
          var minY = Math.min(corners[0][1], corners[1][1], corners[2][1], corners[3][1]);
          var maxY = Math.max(corners[0][1], corners[1][1], corners[2][1], corners[3][1]);

          var cx = Math.max(0, minX);
          var cy = Math.max(0, minY);
          var cw = Math.min(pageViewport.width, maxX) - cx;
          var ch = Math.min(pageViewport.height, maxY) - cy;

          // Only treat substantial images (> 16% page dimension) as receipt photo candidates
          if (cw >= pageViewport.width * 0.16 && ch >= pageViewport.height * 0.12) {
            rawRects.push({ x: cx, y: cy, width: cw, height: ch });
          }
        }
      }

      // Deduplicate heavily overlapping layers while keeping distinct stacked/grid receipt photos
      var distinct = [];
      for (var r = 0; r < rawRects.length; r++) {
        var cand = rawRects[r];
        var merged = false;
        for (var d = 0; d < distinct.length; d++) {
          if (rectOverlapRatio(distinct[d], cand) > 0.55) {
            merged = true;
            break;
          }
        }
        if (!merged) distinct.push(cand);
      }

      // Sort top-to-bottom, left-to-right
      distinct.sort(function(a, b) {
        if (Math.abs(a.y - b.y) > pageViewport.height * 0.08) return a.y - b.y;
        return a.x - b.x;
      });

      return {
        hasImages: totalImageOps > 0 || distinct.length > 0,
        imageCount: Math.max(totalImageOps, distinct.length),
        regions: distinct.slice(0, 6)
      };
    } catch (e) {
      return { hasImages: false, imageCount: 0, regions: [] };
    }
  }

  function cropCanvasRegionToBase64(sourceCanvas, rect) {
    try {
      var pad = 16;
      var sx = Math.max(0, Math.floor(rect.x - pad));
      var sy = Math.max(0, Math.floor(rect.y - pad));
      var sw = Math.min(sourceCanvas.width - sx, Math.ceil(rect.width + pad * 2));
      var sh = Math.min(sourceCanvas.height - sy, Math.ceil(rect.height + pad * 2));
      if (sw < 40 || sh < 40) return null;

      var subCanvas = document.createElement('canvas');
      subCanvas.width = sw;
      subCanvas.height = sh;
      var sctx = subCanvas.getContext('2d');
      if (!sctx) return null;
      sctx.fillStyle = '#FFFFFF';
      sctx.fillRect(0, 0, sw, sh);
      sctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
      var out = subCanvas.toDataURL('image/jpeg', 0.90).replace(/^data:image\\/jpeg;base64,/, '');
      subCanvas.width = 1;
      subCanvas.height = 1;
      return out;
    } catch (_) {
      return null;
    }
  }

  async function renderPageAndRegions(page, targetScale, pageNumber) {
    var baseViewport = page.getViewport({ scale: 1.0 });
    var maxDim = Math.max(baseViewport.width || 1, baseViewport.height || 1);
    var effectiveScale = targetScale || 2.0;
    if (maxDim * effectiveScale > 2000) {
      effectiveScale = Math.max(1.0, 2000 / maxDim);
    }

    var viewport = page.getViewport({ scale: effectiveScale });
    var imgInspection = await inspectPageImageRegions(page, viewport);

    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    var ctx = canvas.getContext('2d');
    if (!ctx) {
      return { pageBase64: null, imgInspection: imgInspection, regionPayloads: [] };
    }

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;

    var pageBase64 = canvas.toDataURL('image/jpeg', 0.88).replace(/^data:image\\/jpeg;base64,/, '');

    // If 2+ distinct receipt image rectangles sit on the same page, crop each cleanly
    var regionPayloads = [];
    if (imgInspection.regions.length >= 2) {
      for (var ri = 0; ri < imgInspection.regions.length; ri++) {
        var box = imgInspection.regions[ri];
        var subB64 = cropCanvasRegionToBase64(canvas, box);
        if (subB64) {
          regionPayloads.push({
            pageNumber: pageNumber,
            regionIndex: ri + 1,
            base64: subB64,
            mimeType: 'image/jpeg',
            bbox: {
              x: Math.round(box.x),
              y: Math.round(box.y),
              width: Math.round(box.width),
              height: Math.round(box.height)
            }
          });
        }
      }
    }

    canvas.width = 1;
    canvas.height = 1;
    return { pageBase64: pageBase64, imgInspection: imgInspection, regionPayloads: regionPayloads };
  }

  async function processJob(msg) {
    var jobId = msg.jobId;
    var pdfDoc = null;
    try {
      if (!window.pdfjsLib) {
        post({
          type: 'RESULT',
          jobId: jobId,
          success: false,
          errorCode: 'UNREADABLE_PDF',
          errorMessage: 'PDF engine unavailable offline; using native fallback.'
        });
        return;
      }

      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js';

      var bytes = decodeBase64(msg.base64);
      var loadingTask = window.pdfjsLib.getDocument({ data: bytes });
      pdfDoc = await loadingTask.promise;

      var totalPages = pdfDoc.numPages || 0;
      if (totalPages === 0) {
        post({
          type: 'RESULT',
          jobId: jobId,
          success: false,
          errorCode: 'EMPTY_PDF',
          errorMessage: 'The PDF contains 0 pages.'
        });
        return;
      }

      var maxPages = Math.max(1, Number(msg.maxPages) || ${DEFAULT_MAX_PDF_PAGES});
      var pagesToProcess = Math.min(totalPages, maxPages);
      var pagesOut = [];

      for (var p = 1; p <= pagesToProcess; p++) {
        post({
          type: 'PROGRESS',
          jobId: jobId,
          stage: 'Inspecting page ' + p + ' of ' + pagesToProcess,
          currentPage: p,
          totalPages: totalPages
        });

        try {
          var page = await pdfDoc.getPage(p);
          var textContent = await page.getTextContent();
          var pageText = extractStructuredTextFromContent(textContent);
          var meaningfulChars = pageText.replace(/\\s+/g, '').length;

          var vp1 = page.getViewport({ scale: 1.0 });
          var quickInspect = await inspectPageImageRegions(page, vp1);
          var hasImages = quickInspect.hasImages;
          var imageCount = quickInspect.imageCount;

          // Render page image whenever text is sparse OR embedded receipt images are detected (even with watermarks!)
          var isScannedCandidate =
            meaningfulChars < ${TEXT_DENSE_MIN_CHARS_PER_PAGE} ||
            (hasImages && meaningfulChars < 450) ||
            quickInspect.regions.length >= 2;

          var renderedImageBase64 = null;
          var regionPayloads = [];

          if (isScannedCandidate) {
            post({
              type: 'PROGRESS',
              jobId: jobId,
              stage: 'Preparing visual scan for page ' + p + ' of ' + pagesToProcess,
              currentPage: p,
              totalPages: totalPages
            });
            var renderRes = await renderPageAndRegions(page, msg.renderScale || 2.0, p);
            renderedImageBase64 = renderRes.pageBase64;
            regionPayloads = renderRes.regionPayloads || [];
            if (renderRes.imgInspection) {
              hasImages = renderRes.imgInspection.hasImages;
              imageCount = renderRes.imgInspection.imageCount;
            }
          }

          if (page.cleanup) {
            try { page.cleanup(); } catch (_) {}
          }

          pagesOut.push({
            pageNumber: p,
            status: 'ok',
            text: pageText,
            charCount: meaningfulChars,
            hasImages: hasImages,
            imageCount: imageCount,
            isScannedCandidate: isScannedCandidate,
            renderedImageBase64: renderedImageBase64,
            regions: regionPayloads
          });
        } catch (pageErr) {
          pagesOut.push({
            pageNumber: p,
            status: 'failed',
            error: (pageErr && pageErr.message) ? pageErr.message : 'Failed to inspect page ' + p,
            text: '',
            charCount: 0,
            hasImages: false,
            imageCount: 0,
            isScannedCandidate: false,
            renderedImageBase64: null,
            regions: []
          });
        }
      }

      post({
        type: 'RESULT',
        jobId: jobId,
        success: true,
        totalPages: totalPages,
        processedPages: pagesToProcess,
        truncatedByPageLimit: totalPages > pagesToProcess,
        pages: pagesOut
      });
    } catch (err) {
      var name = (err && err.name) || '';
      var message = (err && err.message) || String(err || 'Failed to parse PDF');
      var code = 'CORRUPTED_PDF';
      if (name === 'PasswordException' || message.toLowerCase().indexOf('password') !== -1) {
        code = 'PASSWORD_PROTECTED_PDF';
        message = 'This PDF is password-protected. Please unlock it before uploading.';
      } else if (message.toLowerCase().indexOf('invalid pdf') !== -1) {
        code = 'CORRUPTED_PDF';
        message = 'This PDF appears corrupted or unreadable.';
      }
      post({
        type: 'RESULT',
        jobId: jobId,
        success: false,
        errorCode: code,
        errorMessage: message
      });
    } finally {
      if (pdfDoc && pdfDoc.destroy) {
        try { await pdfDoc.destroy(); } catch (_) {}
      }
    }
  }

  function handleIncomingMessage(event) {
    try {
      var data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (data && data.type === 'PROCESS_PDF') {
        processJob(data);
      }
    } catch (e) {
      post({ type: 'ERROR', errorMessage: String(e) });
    }
  }

  window.addEventListener('message', handleIncomingMessage);
  document.addEventListener('message', handleIncomingMessage);

  setTimeout(function() {
    post({
      type: 'READY',
      pdfjsLoaded: Boolean(window.pdfjsLib)
    });
  }, 150);
})();
</script>
</body>
</html>`,
      []
    );

    const dispatchJobToWebView = useCallback((job: PendingJob) => {
      if (!webViewRef.current) return;
      const payload = JSON.stringify({
        type: 'PROCESS_PDF',
        jobId: job.jobId,
        base64: job.base64,
        maxPages: job.maxPages,
        renderScale: job.renderScale,
      });
      webViewRef.current.injectJavaScript(
        `(function(){ window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(payload)} })); })(); true;`
      );
    }, []);

    useEffect(() => {
      if (webViewReady && queuedDispatchRef.current.length > 0) {
        const queued = [...queuedDispatchRef.current];
        queuedDispatchRef.current = [];
        for (const jobId of queued) {
          const job = pendingJobsRef.current.get(jobId);
          if (job) {
            dispatchJobToWebView(job);
          }
        }
      }
    }, [webViewReady, dispatchJobToWebView]);

    useEffect(() => {
      const jobsMap = pendingJobsRef.current;
      return () => {
        for (const [, job] of jobsMap.entries()) {
          clearTimeout(job.timer);
          job.reject(new Error('PDF processor unmounted before finishing.'));
        }
        jobsMap.clear();
      };
    }, []);

    const handleMessage = useCallback(async (event: WebViewMessageEvent) => {
      let msg: any = null;
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'READY') {
        if (msg.pdfjsLoaded) {
          setWebViewReady(true);
          setLoadFailed(false);
        } else {
          setLoadFailed(true);
          for (const [jobId, job] of pendingJobsRef.current.entries()) {
            clearTimeout(job.timer);
            pendingJobsRef.current.delete(jobId);
            job.resolve({
              success: false,
              totalPages: 0,
              processedPages: 0,
              truncatedByPageLimit: false,
              pdfType: 'empty',
              combinedText: '',
              pages: [],
              tempImageUris: [],
              errorCode: 'UNREADABLE_PDF',
              errorMessage: 'PDF.js library did not load in WebView; using fallback extraction.',
            });
          }
        }
        return;
      }

      const jobId = msg.jobId as string | undefined;
      if (!jobId) return;
      const job = pendingJobsRef.current.get(jobId);
      if (!job) return;

      if (msg.type === 'PROGRESS') {
        job.onProgress?.({
          stage: msg.stage || 'Reading PDF',
          currentPage: msg.currentPage,
          totalPages: msg.totalPages,
        });
        return;
      }

      if (msg.type === 'RESULT') {
        clearTimeout(job.timer);
        pendingJobsRef.current.delete(jobId);

        if (!msg.success) {
          job.resolve({
            success: false,
            totalPages: Number(msg.totalPages || 0),
            processedPages: 0,
            truncatedByPageLimit: false,
            pdfType: 'empty',
            combinedText: '',
            pages: [],
            tempImageUris: [],
            errorCode: msg.errorCode || 'CORRUPTED_PDF',
            errorMessage: msg.errorMessage || 'Failed to parse PDF document.',
          });
          return;
        }

        const rawPages: any[] = Array.isArray(msg.pages) ? msg.pages : [];
        const tempImageUris: string[] = [];
        const tempDir = `${FileSystem.cacheDirectory || ''}pdf_ocr_pages/`;
        if (rawPages.some((p) => Boolean(p.renderedImageBase64))) {
          try {
            const dirInfo = await FileSystem.getInfoAsync(tempDir);
            if (!dirInfo.exists) {
              await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true });
            }
          } catch {}
        }

        const processedPagesOut: ProcessedPdfPageOutput[] = [];
        const failedPages: Array<{ pageNumber: number; error: string }> = [];

        for (const p of rawPages) {
          if (p.status === 'failed' && p.error) {
            failedPages.push({ pageNumber: p.pageNumber, error: p.error });
          }
          let tempUri: string | null = null;
          if (p.renderedImageBase64) {
            try {
              const target = `${tempDir}${jobId}_page_${p.pageNumber}.jpg`;
              await FileSystem.writeAsStringAsync(target, p.renderedImageBase64, {
                encoding: FileSystem.EncodingType.Base64,
              });
              tempUri = target;
              tempImageUris.push(target);
            } catch {
              tempUri = null;
            }
          }

          processedPagesOut.push({
            pageNumber: p.pageNumber,
            status: p.status === 'failed' ? 'failed' : 'ok',
            error: p.error || null,
            text: p.text || '',
            charCount: p.charCount || 0,
            hasImages: Boolean(p.hasImages),
            imageCount: Number(p.imageCount || 0),
            isScannedCandidate: Boolean(p.isScannedCandidate),
            renderedImageBase64: p.renderedImageBase64 || null,
            renderedImageMimeType: p.renderedImageBase64 ? 'image/jpeg' : undefined,
            tempImageUri: tempUri,
            regions: Array.isArray(p.regions) ? p.regions : [],
          });
        }

        const pdfType = classifyPdfPages(processedPagesOut);
        const combinedText = processedPagesOut
          .filter((p) => p.text && p.text.trim().length > 0)
          .map((p) => `--- PAGE ${p.pageNumber} ---\n${p.text.trim()}`)
          .join('\n\n');

        job.resolve({
          success: true,
          totalPages: Number(msg.totalPages || processedPagesOut.length),
          processedPages: processedPagesOut.length,
          truncatedByPageLimit: Boolean(msg.truncatedByPageLimit),
          pdfType,
          combinedText,
          pages: processedPagesOut,
          tempImageUris,
          failedPages,
        });
      }
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        processPdf(base64: string, options?: PdfProcessorOptions): Promise<PdfWebViewProcessResult> {
          if (loadFailed) {
            return Promise.resolve({
              success: false,
              totalPages: 0,
              processedPages: 0,
              truncatedByPageLimit: false,
              pdfType: 'empty',
              combinedText: '',
              pages: [],
              tempImageUris: [],
              errorCode: 'UNREADABLE_PDF',
              errorMessage: 'PDF.js engine failed to initialize; falling back to direct PDF processing.',
            });
          }

          const jobId = `pdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const maxPages = options?.maxPages ?? DEFAULT_MAX_PDF_PAGES;
          const renderScale = options?.renderScale ?? 2.0;

          return new Promise<PdfWebViewProcessResult>((resolve, reject) => {
            const timer = setTimeout(() => {
              pendingJobsRef.current.delete(jobId);
              resolve({
                success: false,
                totalPages: 0,
                processedPages: 0,
                truncatedByPageLimit: false,
                pdfType: 'empty',
                combinedText: '',
                pages: [],
                tempImageUris: [],
                errorCode: 'UNREADABLE_PDF',
                errorMessage: 'PDF engine timed out; falling back to direct PDF processing.',
              });
            }, 60000);

            const job: PendingJob = {
              jobId,
              base64,
              maxPages,
              renderScale,
              onProgress: options?.onProgress,
              resolve,
              reject,
              timer,
            };

            pendingJobsRef.current.set(jobId, job);

            if (webViewReady) {
              dispatchJobToWebView(job);
            } else {
              queuedDispatchRef.current.push(jobId);
            }
          });
        },
      }),
      [dispatchJobToWebView, loadFailed, webViewReady]
    );

    return (
      <View style={styles.hiddenContainer} pointerEvents="none">
        <WebView
          ref={webViewRef}
          source={{ html: processorHtml }}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          allowFileAccess
          onMessage={handleMessage}
          onError={() => setLoadFailed(true)}
          style={styles.hiddenWebView}
        />
      </View>
    );
  }
);

const styles = StyleSheet.create({
  hiddenContainer: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    left: -9999,
    top: -9999,
    overflow: 'hidden',
  },
  hiddenWebView: {
    width: 1,
    height: 1,
    opacity: 0,
  },
});

export default PdfProcessorWebView;
