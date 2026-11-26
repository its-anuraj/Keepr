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

export interface ProcessedPdfPageOutput extends PdfPageTextInfo {
  renderedImageBase64?: string | null;
  renderedImageMimeType?: 'image/jpeg';
  tempImageUri?: string | null;
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
 * Hidden offscreen WebView powered by PDF.js that inspects page count, extracts reading-order
 * searchable text per page, detects Text vs Scanned vs Mixed PDFs, and renders ONLY scanned/sparse
 * pages to controlled-size temporary JPEG buffers for OCR/multimodal scanning.
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

    // Sort top-to-bottom (descending Y), then left-to-right (ascending X) within a 4pt row band
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

  async function inspectHasImages(page) {
    try {
      var opList = await page.getOperatorList();
      if (!opList || !Array.isArray(opList.fnArray)) return false;
      var OPS = window.pdfjsLib && window.pdfjsLib.OPS;
      if (!OPS) return false;
      for (var i = 0; i < opList.fnArray.length; i++) {
        var fn = opList.fnArray[i];
        if (
          fn === OPS.paintImageXObject ||
          fn === OPS.paintInlineImageXObject ||
          fn === OPS.paintImageMaskXObject ||
          fn === OPS.paintJpegXObject
        ) {
          return true;
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  async function renderPageToJpegBase64(page, targetScale) {
    var baseViewport = page.getViewport({ scale: 1.0 });
    var maxDim = Math.max(baseViewport.width || 1, baseViewport.height || 1);
    // Cap longest side around 1650px for crisp OCR without WebView OOM
    var effectiveScale = targetScale || 1.8;
    if (maxDim * effectiveScale > 1650) {
      effectiveScale = Math.max(1.0, 1650 / maxDim);
    }
    var viewport = page.getViewport({ scale: effectiveScale });
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    var dataUrl = canvas.toDataURL('image/jpeg', 0.86);
    canvas.width = 1;
    canvas.height = 1;
    return dataUrl.replace(/^data:image\\/jpeg;base64,/, '');
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

        var page = await pdfDoc.getPage(p);
        var textContent = await page.getTextContent();
        var pageText = extractStructuredTextFromContent(textContent);
        var meaningfulChars = pageText.replace(/\\s+/g, '').length;
        var hasImages = await inspectHasImages(page);
        var isScannedCandidate = meaningfulChars < ${TEXT_DENSE_MIN_CHARS_PER_PAGE} || (hasImages && meaningfulChars < 90);

        var renderedImageBase64 = null;
        if (isScannedCandidate) {
          post({
            type: 'PROGRESS',
            jobId: jobId,
            stage: 'Scanning PDF page ' + p + ' of ' + pagesToProcess,
            currentPage: p,
            totalPages: totalPages
          });
          renderedImageBase64 = await renderPageToJpegBase64(page, msg.renderScale || 1.8);
        }

        if (page.cleanup) {
          try { page.cleanup(); } catch (_) {}
        }

        pagesOut.push({
          pageNumber: p,
          text: pageText,
          charCount: meaningfulChars,
          hasImages: hasImages,
          isScannedCandidate: isScannedCandidate,
          renderedImageBase64: renderedImageBase64
        });
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

  // Notify React Native once scripts settle
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
      // Inject call via postMessage in WebView context for Android + iOS reliability
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
          // Fail pending jobs cleanly with UNREADABLE_PDF so caller triggers native fallback
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

        const rawPages: Array<{
          pageNumber: number;
          text: string;
          charCount: number;
          hasImages: boolean;
          isScannedCandidate: boolean;
          renderedImageBase64?: string | null;
        }> = Array.isArray(msg.pages) ? msg.pages : [];

        const tempImageUris: string[] = [];
        const tempDir = `${FileSystem.cacheDirectory || ''}pdf_ocr_pages/`;
        if (rawPages.some((p) => Boolean(p.renderedImageBase64))) {
          try {
            const dirInfo = await FileSystem.getInfoAsync(tempDir);
            if (!dirInfo.exists) {
              await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true });
            }
          } catch {
            // Ignore mkdir errors; write will still attempt or skip temp file
          }
        }

        const processedPagesOut: ProcessedPdfPageOutput[] = [];
        for (const p of rawPages) {
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
            text: p.text || '',
            charCount: p.charCount || 0,
            hasImages: Boolean(p.hasImages),
            isScannedCandidate: Boolean(p.isScannedCandidate),
            renderedImageBase64: p.renderedImageBase64 || null,
            renderedImageMimeType: p.renderedImageBase64 ? 'image/jpeg' : undefined,
            tempImageUri: tempUri,
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
          const renderScale = options?.renderScale ?? 1.8;

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
            }, 35000);

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
