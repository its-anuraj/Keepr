/**
 * KEEPR DIGITAL OWNERSHIP VAULT: Non-Destructive Image Enhancement Studio
 *
 * Guarantees:
 * - Original image is NEVER modified, overwritten, or re-compressed.
 * - Enhancements execute non-destructively (readability contrast + unsharp mask, high-contrast B&W
 *   document scan, rotation, or margin trim) and save to a separate `_enhanced` copy.
 * - Provides interactive Original vs Enhanced toggle and side-by-side comparison before saving.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { readUriBytesAndBase64Safely } from '../../services/pdfFileAccessService';
import {
  inspectMediaAsset,
  saveSeparateEnhancedImage,
  SeparateEnhancementResult,
} from '../../services/imagePipelineService';
import { MediaQualityMetadata } from '../../utils/imageMetadata';

export type EnhancementPreset = 'readability' | 'high_contrast_doc';

export interface ImageEnhancementModalProps {
  visible: boolean;
  sourceUri: string;
  fileName?: string | null;
  onClose: () => void;
  onSavedEnhanced: (result: SeparateEnhancementResult) => void;
}

const ENHANCER_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
  </style>
</head>
<body>
<script>
  var cachedImg = null;
  var lastDataUrl = null;

  function loadSourceImage(dataUrl) {
    return new Promise(function(resolve, reject) {
      if (cachedImg && lastDataUrl === dataUrl) {
        resolve(cachedImg);
        return;
      }
      var img = new Image();
      img.onload = function() {
        cachedImg = img;
        lastDataUrl = dataUrl;
        resolve(img);
      };
      img.onerror = function() {
        reject(new Error('Could not decode source image on enhancement canvas.'));
      };
      img.src = dataUrl;
    });
  }

  function clampByte(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v | 0;
  }

  window.runKeeprEnhancement = async function(payload) {
    try {
      var img = await loadSourceImage(payload.dataUrl);
      var rot = ((payload.rotation || 0) % 360 + 360) % 360;
      var trim = Boolean(payload.trimMargins);
      var mode = payload.preset || 'readability';

      // Respect original sharpness while avoiding WebView OOM on giant 24MP camera sensors
      var maxDim = 2200;
      var srcW = img.naturalWidth || img.width;
      var srcH = img.naturalHeight || img.height;

      var sx = trim ? Math.round(srcW * 0.06) : 0;
      var sy = trim ? Math.round(srcH * 0.06) : 0;
      var sw = trim ? Math.round(srcW * 0.88) : srcW;
      var sh = trim ? Math.round(srcH * 0.88) : srcH;

      var scale = Math.min(1, maxDim / Math.max(sw, sh));
      var dw = Math.max(1, Math.round(sw * scale));
      var dh = Math.max(1, Math.round(sh * scale));

      var outW = (rot === 90 || rot === 270) ? dh : dw;
      var outH = (rot === 90 || rot === 270) ? dw : dh;

      var canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });

      ctx.save();
      ctx.translate(outW / 2, outH / 2);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.drawImage(img, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();

      var imageData = ctx.getImageData(0, 0, outW, outH);
      var data = imageData.data;
      var len = data.length;

      // Pixel-level readability enhancements (deterministic mathematical curves ONLY - never alters characters)
      if (mode === 'high_contrast_doc') {
        // Compute adaptive histogram stretch + crisp document scan look
        var minLum = 255, maxLum = 0;
        var stride = Math.max(4, Math.floor(len / 40000) * 4);
        for (var k = 0; k < len; k += stride) {
          var lum0 = 0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2];
          if (lum0 < minLum) minLum = lum0;
          if (lum0 > maxLum) maxLum = lum0;
        }
        var range = Math.max(24, maxLum - minLum);
        for (var i = 0; i < len; i += 4) {
          var lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          var norm = ((lum - minLum) / range) * 255;
          // Mild S-curve boosting ink blackness and paper whiteness while keeping faint ink intact
          var enhanced = norm > 188
            ? 255
            : norm < 78
            ? clampByte(norm * 0.55)
            : clampByte(((norm - 128) * 1.38) + 138);
          data[i] = enhanced;
          data[i + 1] = enhanced;
          data[i + 2] = enhanced;
        }
      } else {
        // Readability preset: natural contrast & brightness boost + subtle sharpening pass
        var factor = 1.24;
        for (var j = 0; j < len; j += 4) {
          data[j] = clampByte((data[j] - 128) * factor + 134);
          data[j + 1] = clampByte((data[j + 1] - 128) * factor + 134);
          data[j + 2] = clampByte((data[j + 2] - 128) * factor + 134);
        }
      }

      // Unsharp-mask edge crispening (lightweight 5-tap Laplacian sharpening for sharp invoice text)
      var copy = new Uint8ClampedArray(data);
      var rowBytes = outW * 4;
      var sharpAmount = mode === 'high_contrast_doc' ? 0.35 : 0.28;
      for (var y = 1; y < outH - 1; y++) {
        var rowOffset = y * rowBytes;
        for (var x = 1; x < outW - 1; x++) {
          var idx = rowOffset + x * 4;
          for (var c = 0; c < 3; c++) {
            var center = copy[idx + c];
            var blur =
              (copy[idx - 4 + c] +
                copy[idx + 4 + c] +
                copy[idx - rowBytes + c] +
                copy[idx + rowBytes + c]) *
              0.25;
            data[idx + c] = clampByte(center + (center - blur) * sharpAmount);
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);
      var outMime = payload.preferPng ? 'image/png' : 'image/jpeg';
      var outDataUrl = canvas.toDataURL(outMime, 0.94);

      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'ENHANCED_OK',
        requestId: payload.requestId,
        dataUrl: outDataUrl,
        width: outW,
        height: outH
      }));
    } catch (err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'ENHANCED_ERR',
        requestId: payload.requestId,
        error: err && err.message ? err.message : 'Enhancement failed.'
      }));
    }
  };
</script>
</body>
</html>`;

export const ImageEnhancementModal: React.FC<ImageEnhancementModalProps> = ({
  visible,
  sourceUri,
  fileName,
  onClose,
  onSavedEnhanced,
}) => {
  const webViewRef = useRef<WebView | null>(null);
  const requestIdRef = useRef(0);

  const [preset, setPreset] = useState<EnhancementPreset>('readability');
  const [rotation, setRotation] = useState<number>(0);
  const [trimMargins, setTrimMargins] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'enhanced' | 'original' | 'split'>('split');

  const [webReady, setWebReady] = useState(false);
  const [sourceDataUrl, setSourceDataUrl] = useState<string | null>(null);
  const [originalMeta, setOriginalMeta] = useState<MediaQualityMetadata | null>(null);

  const [enhancedDataUrl, setEnhancedDataUrl] = useState<string | null>(null);
  const [enhancedDims, setEnhancedDims] = useState<{ width: number; height: number } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load original bytes safely once on modal open
  useEffect(() => {
    let active = true;
    if (!visible || !sourceUri) return;

    setErrorMsg(null);
    setEnhancedDataUrl(null);
    setRotation(0);
    setTrimMargins(false);
    setPreset('readability');
    setViewMode('split');

    (async () => {
      try {
        setIsProcessing(true);
        const meta = await inspectMediaAsset(sourceUri, { fileName });
        if (active && meta) {
          setOriginalMeta(meta);
        }

        if (sourceUri.startsWith('data:')) {
          if (active) setSourceDataUrl(sourceUri);
          return;
        }

        const safe = await readUriBytesAndBase64Safely(sourceUri, { fileName });
        if (safe.success && safe.base64) {
          const mime = meta?.mimeType || safe.mimeType || 'image/jpeg';
          if (active) {
            setSourceDataUrl(`data:${mime};base64,${safe.base64}`);
          }
        } else {
          // Remote HTTPS image: re-orient locally via manipulateAsync temp cache read if needed
          const manip = await manipulateAsync(sourceUri, [], {
            format: SaveFormat.JPEG,
            base64: true,
            compress: 1,
          }).catch(() => null);
          if (manip?.base64 && active) {
            setSourceDataUrl(`data:image/jpeg;base64,${manip.base64}`);
          } else if (active) {
            setErrorMsg('Unable to read original image pixels for local enhancement.');
            setIsProcessing(false);
          }
        }
      } catch (err: any) {
        if (active) {
          setErrorMsg(err?.message || 'Failed to prepare image.');
          setIsProcessing(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [visible, sourceUri, fileName]);

  // Trigger enhancement pass when webview & source payload or controls update
  useEffect(() => {
    if (!visible || !webReady || !sourceDataUrl || !webViewRef.current) return;

    const reqId = ++requestIdRef.current;
    setIsProcessing(true);
    setErrorMsg(null);

    const preferPng = originalMeta?.format === 'png';
    const payload = JSON.stringify({
      requestId: reqId,
      dataUrl: sourceDataUrl,
      preset,
      rotation,
      trimMargins,
      preferPng,
    });

    webViewRef.current.injectJavaScript(
      `window.runKeeprEnhancement(${payload}); true;`
    );
  }, [visible, webReady, sourceDataUrl, preset, rotation, trimMargins, originalMeta?.format]);

  const handleWebMessage = (event: any) => {
    try {
      const msg = JSON.parse(event?.nativeEvent?.data || '{}');
      if (msg.requestId !== requestIdRef.current) return;

      if (msg.type === 'ENHANCED_OK' && msg.dataUrl) {
        setEnhancedDataUrl(msg.dataUrl);
        setEnhancedDims({ width: msg.width, height: msg.height });
        setIsProcessing(false);
      } else if (msg.type === 'ENHANCED_ERR') {
        setErrorMsg(msg.error || 'Could not apply image enhancement.');
        setIsProcessing(false);
      }
    } catch {
      setIsProcessing(false);
    }
  };

  const handleSaveSeparateCopy = async () => {
    if (!enhancedDataUrl || isSaving) return;
    setIsSaving(true);
    try {
      const saved = await saveSeparateEnhancedImage({
        originalUri: sourceUri,
        originalFileName: fileName,
        enhancedBase64: enhancedDataUrl,
        preset,
      });
      if (!saved.success) {
        Alert.alert('Enhancement Save Failed', saved.error || 'Could not save enhanced file.');
        return;
      }
      onSavedEnhanced(saved);
      onClose();
    } catch (err: any) {
      Alert.alert('Enhancement Failed', err?.message || 'Could not save separate enhanced image.');
    } finally {
      setIsSaving(false);
    }
  };

  const isLowResSource = useMemo(() => {
    if (!originalMeta || !originalMeta.width || !originalMeta.height) return false;
    return originalMeta.qualityTier === 'low';
  }, [originalMeta]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <StatusBar barStyle="light-content" backgroundColor="#05080F" />
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.iconBtn} activeOpacity={0.75}>
            <MaterialIcons name="close" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>Enhance Image Copy</Text>
            <Text style={styles.headerSub}>Original stays untouched · Saved separately</Text>
          </View>
          <TouchableOpacity
            onPress={handleSaveSeparateCopy}
            disabled={!enhancedDataUrl || isProcessing || isSaving}
            style={[
              styles.saveBtn,
              (!enhancedDataUrl || isProcessing || isSaving) && styles.saveBtnDisabled,
            ]}
            activeOpacity={0.85}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <MaterialIcons name="check" size={16} color="#FFFFFF" />
                <Text style={styles.saveBtnText}>Save Copy</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Resolution warning banner when original is low-res */}
        {isLowResSource && originalMeta && (
          <View style={styles.warnBanner}>
            <MaterialIcons name="info-outline" size={16} color="#FCD34D" />
            <Text style={styles.warnBannerText}>
              Source is {originalMeta.width}×{originalMeta.height}px. Enhancement boosts readability without fabricating text.
            </Text>
          </View>
        )}

        {/* Comparison Mode Tabs */}
        <View style={styles.modeTabs}>
          {(['split', 'enhanced', 'original'] as const).map((m) => (
            <TouchableOpacity
              key={m}
              onPress={() => setViewMode(m)}
              style={[styles.modeTab, viewMode === m && styles.modeTabActive]}
            >
              <Text style={[styles.modeTabText, viewMode === m && styles.modeTabTextActive]}>
                {m === 'split' ? 'Side-by-Side' : m === 'enhanced' ? 'Enhanced' : 'Original'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Preview Stage */}
        <View style={styles.previewStage}>
          {viewMode === 'split' ? (
            <View style={styles.splitRow}>
              <View style={styles.splitPane}>
                <Text style={styles.paneBadge}>ORIGINAL (UNTOUCHED)</Text>
                <Image
                  source={{ uri: sourceUri }}
                  style={styles.previewImage}
                  resizeMode="contain"
                />
              </View>
              <View style={styles.splitDivider} />
              <View style={styles.splitPane}>
                <Text style={[styles.paneBadge, styles.paneBadgeEnhanced]}>ENHANCED COPY</Text>
                {enhancedDataUrl ? (
                  <Image
                    source={{ uri: enhancedDataUrl }}
                    style={styles.previewImage}
                    resizeMode="contain"
                  />
                ) : null}
              </View>
            </View>
          ) : (
            <View style={styles.singlePane}>
              <Text
                style={[
                  styles.paneBadge,
                  viewMode === 'enhanced' && styles.paneBadgeEnhanced,
                ]}
              >
                {viewMode === 'enhanced'
                  ? `ENHANCED COPY${enhancedDims ? ` (${enhancedDims.width}×${enhancedDims.height})` : ''}`
                  : `ORIGINAL (${originalMeta?.width || '?'}×${originalMeta?.height || '?'})`}
              </Text>
              <Image
                source={{ uri: viewMode === 'enhanced' && enhancedDataUrl ? enhancedDataUrl : sourceUri }}
                style={styles.previewImage}
                resizeMode="contain"
              />
            </View>
          )}

          {isProcessing && (
            <View style={styles.processingOverlay}>
              <ActivityIndicator size="large" color="#60A5FA" />
              <Text style={styles.processingText}>Enhancing contrast & text sharpness...</Text>
            </View>
          )}

          {errorMsg && (
            <View style={styles.errorBanner}>
              <MaterialIcons name="error-outline" size={18} color="#FCA5A5" />
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          )}
        </View>

        {/* Bottom Controls */}
        <View style={styles.controlsBar}>
          <Text style={styles.sectionLabel}>Enhancement Mode (Original Safe)</Text>
          <View style={styles.chipRow}>
            <TouchableOpacity
              onPress={() => setPreset('readability')}
              style={[styles.chip, preset === 'readability' && styles.chipActive]}
            >
              <MaterialIcons
                name="auto-fix-high"
                size={16}
                color={preset === 'readability' ? '#FFFFFF' : '#CBD5E1'}
              />
              <Text style={[styles.chipText, preset === 'readability' && styles.chipTextActive]}>
                Clear Text Boost
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setPreset('high_contrast_doc')}
              style={[styles.chip, preset === 'high_contrast_doc' && styles.chipActive]}
            >
              <MaterialIcons
                name="contrast"
                size={16}
                color={preset === 'high_contrast_doc' ? '#FFFFFF' : '#CBD5E1'}
              />
              <Text
                style={[styles.chipText, preset === 'high_contrast_doc' && styles.chipTextActive]}
              >
                Doc Scan B&W
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setRotation((r) => (r + 90) % 360)}
              style={[styles.chip, rotation !== 0 && styles.chipActive]}
            >
              <MaterialIcons
                name="rotate-right"
                size={16}
                color={rotation !== 0 ? '#FFFFFF' : '#CBD5E1'}
              />
              <Text style={[styles.chipText, rotation !== 0 && styles.chipTextActive]}>
                Rotate {rotation ? `${rotation}°` : '90°'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setTrimMargins((t) => !t)}
              style={[styles.chip, trimMargins && styles.chipActive]}
            >
              <MaterialIcons
                name="crop"
                size={16}
                color={trimMargins ? '#FFFFFF' : '#CBD5E1'}
              />
              <Text style={[styles.chipText, trimMargins && styles.chipTextActive]}>
                Trim Edges
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Hidden Offscreen Canvas Engine */}
        <View style={styles.hiddenWebViewWrap} pointerEvents="none">
          <WebView
            ref={webViewRef}
            source={{ html: ENHANCER_HTML }}
            onLoadEnd={() => setWebReady(true)}
            onMessage={handleWebMessage}
            javaScriptEnabled
            originWhitelist={['*']}
          />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05080F',
    paddingTop: Platform.OS === 'ios' ? 48 : 28,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 10,
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
  headerTitleWrap: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  headerSub: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#2563EB',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  saveBtnDisabled: {
    backgroundColor: '#334155',
    opacity: 0.7,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  warnBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.16)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(245, 158, 11, 0.25)',
  },
  warnBannerText: {
    color: '#FDE68A',
    fontSize: 11,
    flex: 1,
  },
  modeTabs: {
    flexDirection: 'row',
    margin: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 3,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 9,
  },
  modeTabActive: {
    backgroundColor: '#1E293B',
  },
  modeTabText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  modeTabTextActive: {
    color: '#FFFFFF',
  },
  previewStage: {
    flex: 1,
    position: 'relative',
    paddingHorizontal: 8,
  },
  splitRow: {
    flex: 1,
    flexDirection: 'row',
  },
  splitPane: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  splitDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginVertical: 16,
  },
  singlePane: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  paneBadge: {
    position: 'absolute',
    top: 8,
    alignSelf: 'center',
    zIndex: 5,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    color: '#CBD5E1',
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: 'hidden',
  },
  paneBadgeEnhanced: {
    backgroundColor: 'rgba(37, 99, 235, 0.9)',
    color: '#FFFFFF',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  processingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(5, 8, 15, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  processingText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '600',
  },
  errorBanner: {
    position: 'absolute',
    bottom: 12,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(127, 29, 29, 0.9)',
    padding: 10,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    color: '#FECACA',
    fontSize: 12,
    flex: 1,
  },
  controlsBar: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 32 : 20,
    backgroundColor: '#0F172A',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    gap: 10,
  },
  sectionLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  chipActive: {
    backgroundColor: '#2563EB',
    borderColor: '#60A5FA',
  },
  chipText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  hiddenWebViewWrap: {
    width: 1,
    height: 1,
    opacity: 0,
    position: 'absolute',
    left: -9999,
  },
});
