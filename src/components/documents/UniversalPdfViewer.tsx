/**
 * KEEPR DIGITAL OWNERSHIP VAULT: UniversalPdfViewer Component
 *
 * Enterprise PDF reader supporting:
 * - Authentic PDF.js canvas rendering WITHOUT CSS max-width clamp (crisp DPR-scaled zooming up to 400%)
 * - True Fit-to-Width vs Fit-to-Page toggle + floating Zoom Out (-), Zoom In (+), Reset
 * - Smooth vertical multi-page scroll & zoomed horizontal/vertical panning + two-finger pinch zoom
 * - Original PDF binary download via originalDownloadService (NEVER exports canvas PNGs!)
 * - Direct integration with Document OCR extraction & Android BackHandler
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Modal,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { MaterialIcons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import {
  readUriBytesAndBase64Safely,
} from '../../services/pdfFileAccessService';
import {
  downloadOriginalFile,
} from '../../services/originalDownloadService';
import type { StorageBucket } from '../../services/storageService';
import { SereneColors } from '../../constants/theme';

export interface UniversalPdfViewerProps {
  visible: boolean;
  pdfUri: string;
  storagePath?: string | null;
  bucket?: StorageBucket | null;
  fileName?: string | null;
  title?: string;
  onClose: () => void;
  onScanOcr?: () => void;
}

function buildPdfShellHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      background-color: #0b1120;
      width: 100%;
      height: 100%;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    #scroller {
      width: 100%;
      height: 100%;
      overflow: auto;
      -webkit-overflow-scrolling: touch;
      touch-action: pan-x pan-y;
      padding: 12px 8px 36px 8px;
    }
    #pdf-pages {
      display: flex;
      flex-direction: column;
      align-items: center;
      min-width: 100%;
      gap: 14px;
    }
    .page-frame {
      background: #ffffff;
      border-radius: 4px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.55);
      overflow: hidden;
      flex-shrink: 0;
    }
    .page-frame canvas {
      display: block;
    }
    #status {
      color: #cbd5e1;
      text-align: center;
      padding: 48px 18px;
      font-size: 14px;
    }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <script>
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  </script>
</head>
<body>
  <div id="scroller">
    <div id="status">Loading document...</div>
    <div id="pdf-pages"></div>
  </div>
  <script>
    var pdfDoc = null;
    var base64Buffer = [];
    var currentZoom = 1.0;
    var currentFitMode = 'width';
    var page1BaseWidth = 612;
    var page1BaseHeight = 792;
    var renderEpoch = 0;

    function postMsg(obj) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(obj));
      }
    }

    window.resetPdfPayload = function() {
      base64Buffer = [];
    };

    window.pushPdfBase64Chunk = function(chunk) {
      if (chunk) base64Buffer.push(chunk);
    };

    function computeEffectiveScale(zoomFactor, fitMode) {
      var scroller = document.getElementById('scroller');
      var vw = Math.max(280, (scroller ? scroller.clientWidth : window.innerWidth) - 20);
      var vh = Math.max(320, (scroller ? scroller.clientHeight : window.innerHeight) - 36);
      var widthFit = vw / Math.max(1, page1BaseWidth);
      var pageFit = Math.min(widthFit, vh / Math.max(1, page1BaseHeight));
      var baseScale = fitMode === 'page' ? pageFit : widthFit;
      return Math.max(0.25, Math.min(6.0, baseScale * zoomFactor));
    }

    async function renderAllPages(zoomFactor, fitMode) {
      if (!pdfDoc) return;
      var epoch = ++renderEpoch;
      var container = document.getElementById('pdf-pages');
      container.innerHTML = '';

      var effectiveScale = computeEffectiveScale(zoomFactor, fitMode);
      var dpr = Math.min(2.5, window.devicePixelRatio || 1.5);
      // Keep zoomed canvas crisp without exceeding Android GPU texture limits
      var backingScale = Math.min(3.5, Math.max(1.25, dpr * Math.min(1.8, Math.max(1, zoomFactor * 0.85))));

      for (var p = 1; p <= pdfDoc.numPages; p++) {
        if (epoch !== renderEpoch) return;
        var page = await pdfDoc.getPage(p);
        var viewport = page.getViewport({ scale: effectiveScale });

        var frame = document.createElement('div');
        frame.className = 'page-frame';
        frame.id = 'pdf-page-' + p;
        frame.style.width = Math.round(viewport.width) + 'px';
        frame.style.height = Math.round(viewport.height) + 'px';

        var canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width * backingScale);
        canvas.height = Math.round(viewport.height * backingScale);
        canvas.style.width = Math.round(viewport.width) + 'px';
        canvas.style.height = Math.round(viewport.height) + 'px';

        frame.appendChild(canvas);
        container.appendChild(frame);

        var ctx = canvas.getContext('2d');
        ctx.setTransform(backingScale, 0, 0, backingScale, 0, 0);
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
      }

      postMsg({
        type: 'PDF_RENDERED',
        totalPages: pdfDoc.numPages,
        zoom: zoomFactor,
        fitMode: fitMode
      });
    }

    window.commitPdfBase64AndRender = async function(initialFitMode) {
      try {
        currentFitMode = initialFitMode || 'width';
        currentZoom = 1.0;
        var rawB64 = base64Buffer.join('');
        base64Buffer = [];
        var binaryStr = atob(rawB64);
        var bytes = new Uint8Array(binaryStr.length);
        for (var i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        pdfDoc = await window.pdfjsLib.getDocument({ data: bytes }).promise;
        var firstPage = await pdfDoc.getPage(1);
        var vp1 = firstPage.getViewport({ scale: 1.0 });
        page1BaseWidth = vp1.width;
        page1BaseHeight = vp1.height;

        document.getElementById('status').style.display = 'none';
        postMsg({ type: 'PDF_LOADED', totalPages: pdfDoc.numPages });
        await renderAllPages(currentZoom, currentFitMode);
      } catch (err) {
        var msg = (err && err.message) ? err.message : 'PDF rendering error';
        document.getElementById('status').innerText = 'Could not render PDF: ' + msg;
        postMsg({ type: 'PDF_ERROR', message: msg });
      }
    };

    window.setViewerScale = function(nextZoom, nextFitMode) {
      currentZoom = Math.max(0.5, Math.min(4.0, nextZoom || 1.0));
      if (nextFitMode) currentFitMode = nextFitMode;
      renderAllPages(currentZoom, currentFitMode);
    };

    window.scrollToPage = function(pageNum) {
      var el = document.getElementById('pdf-page-' + pageNum);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    // Track two-finger pinch zoom inside viewport cleanly
    (function setupPinch() {
      var scroller = document.getElementById('scroller');
      var pinchStartDist = 0;
      var pinchStartZoom = 1.0;
      var pinchTimer = null;

      scroller.addEventListener('touchstart', function(e) {
        if (e.touches && e.touches.length === 2) {
          var dx = e.touches[0].clientX - e.touches[1].clientX;
          var dy = e.touches[0].clientY - e.touches[1].clientY;
          pinchStartDist = Math.hypot(dx, dy);
          pinchStartZoom = currentZoom;
        }
      }, { passive: true });

      scroller.addEventListener('touchmove', function(e) {
        if (e.touches && e.touches.length === 2 && pinchStartDist > 10) {
          var dx = e.touches[0].clientX - e.touches[1].clientX;
          var dy = e.touches[0].clientY - e.touches[1].clientY;
          var dist = Math.hypot(dx, dy);
          var candidate = Math.max(0.5, Math.min(4.0, pinchStartZoom * (dist / pinchStartDist)));
          currentZoom = Math.round(candidate * 100) / 100;
          if (pinchTimer) clearTimeout(pinchTimer);
          pinchTimer = setTimeout(function() {
            renderAllPages(currentZoom, currentFitMode);
            postMsg({ type: 'PDF_ZOOM_SYNC', zoom: currentZoom });
          }, 120);
        }
      }, { passive: true });
    })();
  </script>
</body>
</html>`;
}

export const UniversalPdfViewer: React.FC<UniversalPdfViewerProps> = ({
  visible,
  pdfUri,
  storagePath,
  bucket,
  fileName,
  title = 'PDF Document',
  onClose,
  onScanOcr,
}) => {
  const webViewRef = useRef<WebView | null>(null);
  const shellHtml = useRef(buildPdfShellHtml()).current;

  const [isLoading, setIsLoading] = useState(true);
  const [webReady, setWebReady] = useState(false);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomScale, setZoomScale] = useState(1.0);
  const [fitMode, setFitMode] = useState<'width' | 'page'>('width');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadStatusMsg, setDownloadStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setWebReady(false);
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  useEffect(() => {
    if (!visible || !pdfUri) return;

    let active = true;
    setIsLoading(true);
    setErrorMsg(null);
    setPdfBase64(null);
    setCurrentPage(1);
    setZoomScale(1.0);
    setFitMode('width');
    setDownloadStatusMsg(null);

    const loadPdfBytes = async () => {
      try {
        if (pdfUri.startsWith('data:application/pdf;base64,')) {
          if (active) setPdfBase64(pdfUri.split(',')[1]);
          return;
        }

        const safeRead = await readUriBytesAndBase64Safely(pdfUri, {
          mimeType: 'application/pdf',
          validateAsPdf: true,
          fileName: fileName || title,
        });

        if (safeRead.success && safeRead.base64) {
          if (active) setPdfBase64(safeRead.base64);
        } else {
          throw new Error(safeRead.errorMessage || 'Could not read authentic PDF document bytes.');
        }
      } catch (err: any) {
        if (active) {
          setErrorMsg(err?.message || 'Unable to load PDF file.');
          setIsLoading(false);
        }
      }
    };

    loadPdfBytes();
    return () => {
      active = false;
    };
  }, [visible, pdfUri, fileName, title]);

  // Stream base64 into loaded WebView cleanly without giant template string duplication
  useEffect(() => {
    if (!visible || !webReady || !pdfBase64 || !webViewRef.current) return;

    const CHUNK_SIZE = 256 * 1024;
    webViewRef.current.injectJavaScript('window.resetPdfPayload(); true;');
    for (let i = 0; i < pdfBase64.length; i += CHUNK_SIZE) {
      const slice = pdfBase64.slice(i, i + CHUNK_SIZE);
      webViewRef.current.injectJavaScript(`window.pushPdfBase64Chunk(${JSON.stringify(slice)}); true;`);
    }
    webViewRef.current.injectJavaScript(
      `window.commitPdfBase64AndRender(${JSON.stringify(fitMode)}); true;`
    );
  }, [visible, webReady, pdfBase64]);

  const applyZoomOrFit = (nextZoom: number, nextFitMode: 'width' | 'page') => {
    const clampedZoom = Math.max(0.5, Math.min(4.0, Math.round(nextZoom * 100) / 100));
    setZoomScale(clampedZoom);
    setFitMode(nextFitMode);
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(
        `window.setViewerScale(${clampedZoom}, ${JSON.stringify(nextFitMode)}); true;`
      );
    }
  };

  const handlePrevPage = () => {
    const next = Math.max(1, currentPage - 1);
    setCurrentPage(next);
    webViewRef.current?.injectJavaScript(`window.scrollToPage(${next}); true;`);
  };

  const handleNextPage = () => {
    const next = Math.min(totalPages, currentPage + 1);
    setCurrentPage(next);
    webViewRef.current?.injectJavaScript(`window.scrollToPage(${next}); true;`);
  };

  /**
   * Downloads ONLY the authentic original `.pdf` bytes from vault/storage.
   * NEVER captures or downloads rendered page canvas PNGs.
   */
  const handleDownloadOriginalPdf = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    setDownloadStatusMsg('Preparing original PDF...');

    try {
      const result = await downloadOriginalFile({
        uri: pdfUri,
        storagePath,
        bucket,
        fileName: fileName || title,
        title,
        mimeType: 'application/pdf',
        isPdf: true,
        onProgress: (p) => setDownloadStatusMsg(p.message),
      });

      if (result.cancelled) {
        setDownloadStatusMsg(null);
        return;
      }

      if (!result.success) {
        // Explicit fallback prompt if Sharing.shareAsync desired when Android SAF had a limitation
        if (await Sharing.isAvailableAsync() && pdfUri.startsWith('file:')) {
          Alert.alert(
            'PDF Download Failed',
            result.error || 'Could not save PDF directly to folder.',
            [
              { text: 'Close', style: 'cancel' },
              {
                text: 'Share / Save via Sheet',
                onPress: () => {
                  Sharing.shareAsync(pdfUri, {
                    mimeType: 'application/pdf',
                    dialogTitle: `Save Original PDF: ${title}`,
                    UTI: 'com.adobe.pdf',
                  }).catch(() => {});
                },
              },
            ]
          );
        } else {
          Alert.alert('PDF Download Failed', result.error || 'Could not download original PDF.');
        }
        return;
      }

      const sizeKb = result.byteSize ? `${(result.byteSize / 1024).toFixed(1)} KB` : '';
      const shortHash = result.sha256 ? result.sha256.slice(0, 10) : '';
      Alert.alert(
        'Original PDF Downloaded',
        `Saved authentic PDF "${result.fileName}"${sizeKb ? ` (${sizeKb})` : ''}${shortHash ? `\nVerified SHA-256: ${shortHash}…` : ''}`
      );
    } catch (err: any) {
      Alert.alert('Download Notice', err?.message || 'Could not download original PDF.');
    } finally {
      setIsDownloading(false);
      setDownloadStatusMsg(null);
    }
  };

  const handleMessage = (event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'PDF_LOADED') {
        setTotalPages(msg.totalPages || 1);
      } else if (msg.type === 'PDF_RENDERED') {
        setTotalPages(msg.totalPages || 1);
        setIsLoading(false);
      } else if (msg.type === 'PDF_ZOOM_SYNC' && typeof msg.zoom === 'number') {
        setZoomScale(msg.zoom);
      } else if (msg.type === 'PDF_ERROR') {
        setErrorMsg(msg.message || 'Failed to parse PDF document.');
        setIsLoading(false);
      }
    } catch {}
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <StatusBar barStyle="light-content" backgroundColor="#0B1120" />
      <View style={styles.container}>
        {/* Top Toolbar */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.iconBtn}
            activeOpacity={0.7}
            accessibilityLabel="Close PDF reader"
          >
            <MaterialIcons name="close" size={22} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={styles.titleBlock}>
            <Text style={styles.titleText} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.subtitleText}>
              {errorMsg
                ? 'Load Issue'
                : `${totalPages} ${totalPages === 1 ? 'Page' : 'Pages'} · ${Math.round(zoomScale * 100)}% · PDF`}
            </Text>
          </View>

          <View style={styles.headerActions}>
            {onScanOcr && (
              <TouchableOpacity
                onPress={onScanOcr}
                style={styles.actionPill}
                activeOpacity={0.8}
              >
                <MaterialIcons name="document-scanner" size={16} color="#FFFFFF" />
                <Text style={styles.actionPillText}>OCR</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={handleDownloadOriginalPdf}
              style={[styles.iconBtn, styles.downloadBtn]}
              activeOpacity={0.75}
              disabled={isDownloading}
              accessibilityLabel="Download original PDF"
            >
              {isDownloading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <MaterialIcons name="download" size={20} color="#FFFFFF" />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {downloadStatusMsg && (
          <View style={styles.statusStrip}>
            <ActivityIndicator size="small" color="#93C5FD" />
            <Text style={styles.statusStripText}>{downloadStatusMsg}</Text>
          </View>
        )}

        {/* PDF Canvas Viewport */}
        <View style={styles.viewerArea}>
          {errorMsg ? (
            <View style={styles.errorBox}>
              <MaterialIcons name="error-outline" size={44} color="#F87171" />
              <Text style={styles.errorTitle}>PDF Preview Unavailable</Text>
              <Text style={styles.errorDesc}>{errorMsg}</Text>
              <TouchableOpacity
                onPress={handleDownloadOriginalPdf}
                style={styles.errorDownloadBtn}
              >
                <MaterialIcons name="download" size={18} color="#FFFFFF" />
                <Text style={styles.errorDownloadBtnText}>Download Original PDF</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <WebView
                ref={webViewRef}
                originWhitelist={['*']}
                source={{ html: shellHtml }}
                style={styles.webview}
                onLoadEnd={() => setWebReady(true)}
                onMessage={handleMessage}
                javaScriptEnabled
                domStorageEnabled
                allowFileAccess
                allowFileAccessFromFileURLs
                allowUniversalAccessFromFileURLs
                mixedContentMode="always"
              />
              {isLoading && (
                <View style={styles.loadingOverlay} pointerEvents="none">
                  <ActivityIndicator size="large" color="#3B82F6" />
                  <Text style={styles.loadingLabel}>Rendering high-DPI PDF pages...</Text>
                </View>
              )}
            </>
          )}
        </View>

        {/* Bottom Floating Control Strip */}
        <View style={styles.bottomControls}>
          {/* Page Controls */}
          <View style={styles.controlGroup}>
            <TouchableOpacity
              onPress={handlePrevPage}
              disabled={currentPage <= 1}
              style={[styles.navBtn, currentPage <= 1 && styles.navBtnDisabled]}
            >
              <MaterialIcons name="chevron-left" size={22} color="#FFFFFF" />
            </TouchableOpacity>

            <Text style={styles.pageText}>
              {currentPage} / {totalPages}
            </Text>

            <TouchableOpacity
              onPress={handleNextPage}
              disabled={currentPage >= totalPages}
              style={[styles.navBtn, currentPage >= totalPages && styles.navBtnDisabled]}
            >
              <MaterialIcons name="chevron-right" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          {/* Fit Mode Toggle */}
          <TouchableOpacity
            onPress={() => {
              const nextFit = fitMode === 'width' ? 'page' : 'width';
              applyZoomOrFit(1.0, nextFit);
            }}
            style={styles.fitModeBtn}
            activeOpacity={0.8}
          >
            <MaterialIcons
              name={fitMode === 'width' ? 'fit-screen' : 'fullscreen-exit'}
              size={16}
              color="#93C5FD"
            />
            <Text style={styles.fitModeText}>
              {fitMode === 'width' ? 'Fit Width' : 'Fit Page'}
            </Text>
          </TouchableOpacity>

          {/* Floating Zoom Controls */}
          <View style={styles.controlGroup}>
            <TouchableOpacity
              onPress={() => applyZoomOrFit(zoomScale - 0.35, fitMode)}
              disabled={zoomScale <= 0.55}
              style={[styles.navBtn, zoomScale <= 0.55 && styles.navBtnDisabled]}
              accessibilityLabel="Zoom out PDF"
            >
              <MaterialIcons name="remove" size={20} color="#FFFFFF" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => applyZoomOrFit(1.0, fitMode)}
              style={styles.zoomResetBtn}
              accessibilityLabel="Reset PDF zoom"
            >
              <Text style={styles.zoomText}>{Math.round(zoomScale * 100)}%</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => applyZoomOrFit(zoomScale + 0.35, fitMode)}
              disabled={zoomScale >= 3.95}
              style={[styles.navBtn, zoomScale >= 3.95 && styles.navBtnDisabled]}
              accessibilityLabel="Zoom in PDF"
            >
              <MaterialIcons name="add" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1120',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 52 : 34,
    paddingHorizontal: 14,
    paddingBottom: 10,
    backgroundColor: '#1E293B',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadBtn: {
    backgroundColor: '#2563EB',
  },
  titleBlock: {
    flex: 1,
    paddingHorizontal: 10,
  },
  titleText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  subtitleText: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: SereneColors.primary,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 18,
  },
  actionPillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  statusStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#172554',
    paddingVertical: 6,
  },
  statusStripText: {
    color: '#DBEAFE',
    fontSize: 12,
    fontWeight: '600',
  },
  viewerArea: {
    flex: 1,
    position: 'relative',
  },
  webview: {
    flex: 1,
    backgroundColor: '#0B1120',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(11, 17, 32, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingLabel: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '600',
  },
  errorBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  errorTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  errorDesc: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
  errorDownloadBtn: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#2563EB',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
  },
  errorDownloadBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  bottomControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    backgroundColor: '#1E293B',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    gap: 6,
  },
  controlGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  navBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnDisabled: {
    opacity: 0.35,
  },
  pageText: {
    color: '#F1F5F9',
    fontSize: 12,
    fontWeight: '700',
    minWidth: 38,
    textAlign: 'center',
  },
  fitModeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(59, 130, 246, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(147, 197, 253, 0.3)',
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 14,
  },
  fitModeText: {
    color: '#BFDBFE',
    fontSize: 11,
    fontWeight: '700',
  },
  zoomResetBtn: {
    paddingHorizontal: 6,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomText: {
    color: '#F1F5F9',
    fontSize: 12,
    fontWeight: '700',
    minWidth: 40,
    textAlign: 'center',
  },
});
