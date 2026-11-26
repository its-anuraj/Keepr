import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Platform,
  BackHandler,
  Dimensions,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SereneColors } from '../../constants/theme';

export interface UniversalPdfViewerProps {
  visible: boolean;
  pdfUri: string;
  title: string;
  onClose: () => void;
  onScanOcr?: () => void;
}

export const UniversalPdfViewer: React.FC<UniversalPdfViewerProps> = ({
  visible,
  pdfUri,
  title,
  onClose,
  onScanOcr,
}) => {
  const insets = useSafeAreaInsets();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [isDownloading, setIsDownloading] = useState(false);
  const webViewRef = useRef<WebView>(null);

  // Android Back Button
  useEffect(() => {
    if (!visible) return;
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => backHandler.remove();
  }, [visible, onClose]);

  // Read local PDF or fetch remote signed URL to Base64 for guaranteed offline & cross-platform rendering
  useEffect(() => {
    if (!visible || !pdfUri) {
      setPdfBase64(null);
      setIsLoading(true);
      setLoadError(null);
      return;
    }

    let isMounted = true;

    async function loadPdfData() {
      setIsLoading(true);
      setLoadError(null);
      try {
        let b64: string;
        if (pdfUri.startsWith('http://') || pdfUri.startsWith('https://')) {
          const tempFile = `${FileSystem.cacheDirectory}temp_pdf_viewer_${Date.now()}.pdf`;
          const downloadRes = await FileSystem.downloadAsync(pdfUri, tempFile);
          if (downloadRes.status !== 200) {
            throw new Error(`Failed to load PDF (HTTP ${downloadRes.status})`);
          }
          b64 = await FileSystem.readAsStringAsync(tempFile, {
            encoding: FileSystem.EncodingType.Base64,
          });
          FileSystem.deleteAsync(tempFile, { idempotent: true }).catch(() => {});
        } else {
          b64 = await FileSystem.readAsStringAsync(pdfUri, {
            encoding: FileSystem.EncodingType.Base64,
          });
        }

        if (isMounted) {
          setPdfBase64(b64);
          setIsLoading(false);
        }
      } catch (err: any) {
        console.warn('[UniversalPdfViewer] Load error:', err);
        if (isMounted) {
          setLoadError(err?.message || 'Could not load PDF document.');
          setIsLoading(false);
        }
      }
    }

    loadPdfData();

    return () => {
      isMounted = false;
    };
  }, [visible, pdfUri]);

  // Handle messages from embedded PDF.js
  const handleMessage = useCallback((event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'PAGE_INFO') {
        setCurrentPage(data.page || 1);
        setTotalPages(data.totalPages || 1);
      } else if (data.type === 'LOAD_SUCCESS') {
        setTotalPages(data.totalPages || 1);
        setCurrentPage(1);
        setIsLoading(false);
      } else if (data.type === 'LOAD_ERROR') {
        setLoadError(data.error || 'Failed to parse PDF document.');
        setIsLoading(false);
      }
    } catch {
    }
  }, []);

  const sendWebviewCommand = (action: string, payload?: any) => {
    if (webViewRef.current) {
      const code = `if (window.handlePdfAction) { window.handlePdfAction('${action}', ${JSON.stringify(payload || {})}); } true;`;
      webViewRef.current.injectJavaScript(code);
    }
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      sendWebviewCommand('PREV_PAGE');
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      sendWebviewCommand('NEXT_PAGE');
    }
  };

  const handleZoomIn = () => {
    const next = Math.min(zoomLevel + 0.25, 3.0);
    setZoomLevel(next);
    sendWebviewCommand('SET_ZOOM', { scale: next });
  };

  const handleZoomOut = () => {
    const next = Math.max(zoomLevel - 0.25, 0.75);
    setZoomLevel(next);
    sendWebviewCommand('SET_ZOOM', { scale: next });
  };

  const handleFitWidth = () => {
    setZoomLevel(1.0);
    sendWebviewCommand('FIT_WIDTH');
  };

  // Download / Save to Device
  const handleDownload = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      let targetFileUri = pdfUri;
      if (pdfUri.startsWith('http://') || pdfUri.startsWith('https://')) {
        const cleanName = `${(title || 'document').replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
        const localDest = `${FileSystem.documentDirectory}${cleanName}`;
        const dl = await FileSystem.downloadAsync(pdfUri, localDest);
        targetFileUri = dl.uri;
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(targetFileUri, {
          mimeType: 'application/pdf',
          dialogTitle: `Download / Save ${title}`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert('Saved', 'Document is saved in your local app storage.');
      }
    } catch (err: any) {
      Alert.alert('Download Error', err?.message || 'Could not download PDF.');
    } finally {
      setIsDownloading(false);
    }
  };

  // Generate self-contained offline PDF.js HTML renderer
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #121212; color: #fff; font-family: -apple-system, Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; min-height: 100vh; overflow-x: auto; padding: 12px 0 60px 0; }
    #canvas-container { display: flex; justify-content: center; width: 100%; }
    canvas { max-width: 96%; height: auto; box-shadow: 0 4px 16px rgba(0,0,0,0.6); border-radius: 4px; background: #fff; margin-bottom: 16px; }
    #loading { color: #888; font-size: 14px; margin-top: 40px; }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
</head>
<body>
  <div id="loading">Rendering document...</div>
  <div id="canvas-container">
    <canvas id="pdf-canvas"></canvas>
  </div>

  <script>
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    let pdfDoc = null;
    let pageNum = 1;
    let pageRendering = false;
    let pageNumPending = null;
    let scale = 1.0;
    const canvas = document.getElementById('pdf-canvas');
    const ctx = canvas.getContext('2d');

    function renderPage(num) {
      pageRendering = true;
      pdfDoc.getPage(num).then(function(page) {
        const viewport = page.getViewport({ scale: scale * 1.5 });
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
          canvasContext: ctx,
          viewport: viewport
        };
        const renderTask = page.render(renderContext);

        renderTask.promise.then(function() {
          pageRendering = false;
          document.getElementById('loading').style.display = 'none';
          if (pageNumPending !== null) {
            renderPage(pageNumPending);
            pageNumPending = null;
          }
        });
      });

      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'PAGE_INFO',
          page: num,
          totalPages: pdfDoc.numPages
        }));
      }
    }

    function queueRenderPage(num) {
      if (pageRendering) {
        pageNumPending = num;
      } else {
        renderPage(num);
      }
    }

    window.handlePdfAction = function(action, payload) {
      if (!pdfDoc) return;
      if (action === 'PREV_PAGE') {
        if (pageNum <= 1) return;
        pageNum--;
        queueRenderPage(pageNum);
      } else if (action === 'NEXT_PAGE') {
        if (pageNum >= pdfDoc.numPages) return;
        pageNum++;
        queueRenderPage(pageNum);
      } else if (action === 'SET_ZOOM') {
        scale = payload.scale || 1.0;
        queueRenderPage(pageNum);
      } else if (action === 'FIT_WIDTH') {
        scale = 1.0;
        queueRenderPage(pageNum);
      }
    };

    try {
      const rawB64 = "${pdfBase64 || ''}";
      if (!rawB64) {
        throw new Error("No PDF content provided");
      }
      const rawData = atob(rawB64);
      const uint8Array = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; i++) {
        uint8Array[i] = rawData.charCodeAt(i);
      }

      pdfjsLib.getDocument({ data: uint8Array }).promise.then(function(doc) {
        pdfDoc = doc;
        document.getElementById('loading').style.display = 'none';
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'LOAD_SUCCESS',
            totalPages: doc.numPages
          }));
        }
        renderPage(pageNum);
      }).catch(function(err) {
        document.getElementById('loading').innerText = "Failed to render PDF: " + err.message;
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'LOAD_ERROR',
            error: err.message
          }));
        }
      });
    } catch (e) {
      document.getElementById('loading').innerText = "Load error: " + e.message;
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'LOAD_ERROR',
          error: e.message
        }));
      }
    }
  </script>
</body>
</html>
  `;

  return (
    <Modal visible={visible} transparent={false} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: Math.max(insets.top, 16) }]}>
        {/* Header Bar */}
        <View style={styles.header}>
          <View style={styles.titleContainer}>
            <View style={styles.pdfBadge}>
              <MaterialIcons name="picture-as-pdf" size={14} color="#EF4444" />
              <Text style={styles.pdfBadgeText}>PDF</Text>
            </View>
            <Text style={styles.titleText} numberOfLines={1}>
              {title}
            </Text>
          </View>

          <View style={styles.headerActions}>
            {onScanOcr && (
              <TouchableOpacity
                style={styles.headerButton}
                onPress={onScanOcr}
                activeOpacity={0.7}
                accessibilityLabel="Scan with OCR"
              >
                <MaterialIcons name="document-scanner" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.headerButton}
              onPress={handleDownload}
              disabled={isDownloading}
              activeOpacity={0.7}
              accessibilityLabel="Download PDF"
            >
              {isDownloading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <MaterialIcons name="file-download" size={20} color="#FFFFFF" />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.headerButton, styles.closeButton]}
              onPress={onClose}
              activeOpacity={0.7}
              accessibilityLabel="Close PDF"
            >
              <MaterialIcons name="close" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>

        {/* PDF Webview Viewer or Loading/Error State */}
        <View style={styles.body}>
          {loadError ? (
            <View style={styles.centerBox}>
              <MaterialIcons name="error-outline" size={44} color="#EF4444" />
              <Text style={styles.errorTitle}>Could Not Open PDF</Text>
              <Text style={styles.errorSubtitle}>{loadError}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={handleDownload}>
                <MaterialIcons name="share" size={16} color="#FFFFFF" />
                <Text style={styles.retryButtonText}>Open in External Viewer</Text>
              </TouchableOpacity>
            </View>
          ) : isLoading || !pdfBase64 ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color={SereneColors.primary} />
              <Text style={styles.loadingText}>Loading PDF pages...</Text>
            </View>
          ) : (
            <WebView
              ref={webViewRef}
              originWhitelist={['*']}
              source={{ html: htmlContent }}
              onMessage={handleMessage}
              style={styles.webview}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              startInLoadingState={false}
              scalesPageToFit={true}
              bounces={false}
            />
          )}
        </View>

        {/* Bottom Pagination & Zoom Controller */}
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {/* Zoom Controls */}
          <View style={styles.controlGroup}>
            <TouchableOpacity style={styles.iconButton} onPress={handleZoomOut} activeOpacity={0.7}>
              <MaterialIcons name="zoom-out" size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.fitWidthButton} onPress={handleFitWidth} activeOpacity={0.7}>
              <Text style={styles.fitWidthText}>{Math.round(zoomLevel * 100)}%</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconButton} onPress={handleZoomIn} activeOpacity={0.7}>
              <MaterialIcons name="zoom-in" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          {/* Page Indicator & Navigator */}
          <View style={styles.controlGroup}>
            <TouchableOpacity
              style={[styles.iconButton, currentPage <= 1 && styles.buttonDisabled]}
              onPress={handlePrevPage}
              disabled={currentPage <= 1}
              activeOpacity={0.7}
            >
              <MaterialIcons name="chevron-left" size={22} color={currentPage <= 1 ? '#666' : '#FFF'} />
            </TouchableOpacity>

            <View style={styles.pageBadge}>
              <Text style={styles.pageText}>
                {currentPage} / {totalPages}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.iconButton, currentPage >= totalPages && styles.buttonDisabled]}
              onPress={handleNextPage}
              disabled={currentPage >= totalPages}
              activeOpacity={0.7}
            >
              <MaterialIcons name="chevron-right" size={22} color={currentPage >= totalPages ? '#666' : '#FFF'} />
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
    backgroundColor: '#0F172A',
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  titleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginRight: 12,
  },
  pdfBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#374151',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 3,
  },
  pdfBadgeText: {
    color: '#F87171',
    fontSize: 10,
    fontWeight: 'bold',
  },
  titleText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    backgroundColor: '#334155',
  },
  body: {
    flex: 1,
    backgroundColor: '#121212',
  },
  webview: {
    flex: 1,
    backgroundColor: '#121212',
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  loadingText: {
    color: '#94A3B8',
    fontSize: 13,
  },
  errorTitle: {
    color: '#EF4444',
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorSubtitle: {
    color: '#94A3B8',
    fontSize: 12,
    textAlign: 'center',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: SereneColors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#0F172A',
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  controlGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 6,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  fitWidthButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#1E293B',
  },
  fitWidthText: {
    color: '#94A3B8',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontWeight: '600',
  },
  pageBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#1E293B',
  },
  pageText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
});
