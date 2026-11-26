/**
 * KEEPR DIGITAL OWNERSHIP VAULT: HighResImageViewer Component
 *
 * Enterprise-grade full-screen image viewer supporting:
 * - Focal-point-preserving pinch-to-zoom & smooth animated double-tap zoom
 * - True aspect-ratio-aware panning bounds clamped cleanly inside viewport edges
 * - Floating Minus (−), Plus (+), Fit/Reset, and adaptive zoom ceiling (4x–8x)
 * - Swipe pagination with preloading across multi-photo galleries
 * - Original image integrity preservation + direct Original Download (Android SAF / Share)
 * - Optional non-destructive Image Enhancement toggle & Original vs Enhanced switcher
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Image,
  Animated,
  PanResponder,
  Dimensions,
  ActivityIndicator,
  StyleSheet,
  Platform,
  StatusBar,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import {
  clampPanOffset,
  computeAdaptiveMaxZoom,
  computeFocalZoomPan,
} from '../../utils/imageMetadata';
import { downloadOriginalFile } from '../../services/originalDownloadService';
import type { StorageBucket } from '../../services/storageService';
import type { SeparateEnhancementResult } from '../../services/imagePipelineService';
import { ImageEnhancementModal } from './ImageEnhancementModal';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export interface ImageViewerImage {
  uri: string;
  title?: string;
  subtitle?: string;
  fileName?: string;
  storagePath?: string | null;
  bucket?: StorageBucket | null;
  mimeType?: string | null;
  enhancedUri?: string | null;
}

export interface HighResImageViewerProps {
  visible: boolean;
  images: ImageViewerImage[];
  initialIndex?: number;
  onClose: () => void;
  maxZoom?: number;
  enableDownload?: boolean;
  enableEnhance?: boolean;
  onDownload?: (image: ImageViewerImage, index: number) => Promise<void> | void;
  onEnhanceSaved?: (result: SeparateEnhancementResult, image: ImageViewerImage, index: number) => void;
}

export const HighResImageViewer: React.FC<HighResImageViewerProps> = ({
  visible,
  images,
  initialIndex = 0,
  onClose,
  maxZoom = 6.0,
  enableDownload = true,
  enableEnhance = true,
  onDownload,
  onEnhanceSaved,
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [loadingMap, setLoadingMap] = useState<Record<number, boolean>>({});
  const [errorMap, setErrorMap] = useState<Record<number, boolean>>({});
  const [dimensionsMap, setDimensionsMap] = useState<Record<number, { width: number; height: number }>>({});
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.76,
  });

  // Track optional enhanced copy per image index WITHOUT touching original
  const [enhancedOverrides, setEnhancedOverrides] = useState<Record<number, { uri: string; fileName: string }>>({});
  const [activeVariant, setActiveVariant] = useState<'original' | 'enhanced'>('original');
  const [enhanceModalVisible, setEnhanceModalVisible] = useState(false);

  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadStatusMsg, setDownloadStatusMsg] = useState<string | null>(null);

  const scaleAnim = useRef(new Animated.Value(1)).current;
  const panAnim = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  const stateRef = useRef({
    scale: 1,
    panX: 0,
    panY: 0,
    lastTapTime: 0,
    lastTapX: SCREEN_WIDTH / 2,
    lastTapY: SCREEN_HEIGHT / 2,
    isPinching: false,
    pinchStartDistance: 0,
    pinchStartScale: 1,
    pinchStartPanX: 0,
    pinchStartPanY: 0,
    pinchStartMidX: SCREEN_WIDTH / 2,
    pinchStartMidY: SCREEN_HEIGHT / 2,
    dragStartPanX: 0,
    dragStartPanY: 0,
    viewportOffsetY: 0,
  });

  const currentImage = images[currentIndex] || images[0];
  const currentEnhancedUri =
    enhancedOverrides[currentIndex]?.uri || currentImage?.enhancedUri || null;
  const activeDisplayUri =
    activeVariant === 'enhanced' && currentEnhancedUri
      ? currentEnhancedUri
      : currentImage?.uri || '';

  const currentDims = dimensionsMap[currentIndex];
  const effectiveMaxZoom = useMemo(() => {
    return computeAdaptiveMaxZoom(
      viewportSize.width,
      viewportSize.height,
      currentDims?.width,
      currentDims?.height,
      maxZoom
    );
  }, [viewportSize.width, viewportSize.height, currentDims?.width, currentDims?.height, maxZoom]);

  const effectiveMaxZoomRef = useRef(effectiveMaxZoom);
  effectiveMaxZoomRef.current = effectiveMaxZoom;

  const viewportSizeRef = useRef(viewportSize);
  viewportSizeRef.current = viewportSize;

  const currentDimsRef = useRef(currentDims);
  currentDimsRef.current = currentDims;

  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;

  const imagesLengthRef = useRef(images.length);
  imagesLengthRef.current = images.length;

  // Reset state on modal open
  useEffect(() => {
    if (visible) {
      const safeIdx = Math.max(0, Math.min(initialIndex, Math.max(0, images.length - 1)));
      setCurrentIndex(safeIdx);
      setActiveVariant('original');
      setDownloadStatusMsg(null);
      resetZoom(false);
    }
  }, [visible, initialIndex, images.length]);

  // Measure real original image pixel dimensions for aspect-aware panning & adaptive max zoom
  useEffect(() => {
    if (!visible || !activeDisplayUri) return;
    Image.getSize(
      activeDisplayUri,
      (width, height) => {
        if (width > 0 && height > 0) {
          setDimensionsMap((prev) => ({
            ...prev,
            [currentIndex]: { width, height },
          }));
        }
      },
      () => {}
    );
  }, [visible, activeDisplayUri, currentIndex]);

  const applyTransformValues = (nextScale: number, nextX: number, nextY: number, animated = true) => {
    const clampedScale = Math.max(1, Math.min(effectiveMaxZoomRef.current, nextScale));
    const vp = viewportSizeRef.current;
    const dims = currentDimsRef.current;
    const clamped =
      clampedScale <= 1.001
        ? { x: 0, y: 0 }
        : clampPanOffset(nextX, nextY, clampedScale, vp.width, vp.height, dims?.width, dims?.height);

    stateRef.current.scale = clampedScale;
    stateRef.current.panX = clamped.x;
    stateRef.current.panY = clamped.y;
    setZoomPercent(Math.round(clampedScale * 100));

    if (animated) {
      Animated.parallel([
        Animated.timing(scaleAnim, {
          toValue: clampedScale,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(panAnim, {
          toValue: clamped,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      scaleAnim.setValue(clampedScale);
      panAnim.setValue(clamped);
    }
  };

  const resetZoom = useCallback((animated = true) => {
    applyTransformValues(1, 0, 0, animated);
  }, []);

  const zoomByStep = useCallback((delta: number) => {
    const current = stateRef.current.scale;
    const target = Math.max(1, Math.min(effectiveMaxZoomRef.current, current + delta));
    const vp = viewportSizeRef.current;
    const dims = currentDimsRef.current;
    const nextPan = computeFocalZoomPan({
      currentScale: current,
      nextScale: target,
      currentPanX: stateRef.current.panX,
      currentPanY: stateRef.current.panY,
      focalX: vp.width / 2,
      focalY: vp.height / 2,
      containerWidth: vp.width,
      containerHeight: vp.height,
      imageWidth: dims?.width,
      imageHeight: dims?.height,
    });
    applyTransformValues(target, nextPan.x, nextPan.y, true);
  }, []);

  const handleGoToIndex = useCallback((nextIdx: number) => {
    if (nextIdx < 0 || nextIdx >= imagesLengthRef.current) return;
    setCurrentIndex(nextIdx);
    setActiveVariant('original');
    resetZoom(false);
  }, [resetZoom]);

  const handleDownloadOriginal = async () => {
    if (!currentImage || isDownloading) return;

    if (onDownload) {
      try {
        setIsDownloading(true);
        await onDownload(
          activeVariant === 'enhanced' && currentEnhancedUri
            ? { ...currentImage, uri: currentEnhancedUri, storagePath: null }
            : currentImage,
          currentIndex
        );
      } finally {
        setIsDownloading(false);
      }
      return;
    }

    const downloadingEnhanced = activeVariant === 'enhanced' && Boolean(currentEnhancedUri);
    const targetUri = downloadingEnhanced ? currentEnhancedUri! : currentImage.uri;
    const targetStoragePath = downloadingEnhanced ? null : currentImage.storagePath;

    setIsDownloading(true);
    setDownloadStatusMsg('Preparing file...');

    try {
      const res = await downloadOriginalFile({
        uri: targetUri,
        storagePath: targetStoragePath,
        bucket: currentImage.bucket,
        fileName:
          currentImage.fileName ||
          (downloadingEnhanced
            ? `${currentImage.title || 'Keepr_Image'}_enhanced`
            : currentImage.title),
        title: currentImage.title,
        mimeType: currentImage.mimeType,
        onProgress: (p) => {
          setDownloadStatusMsg(p.message);
        },
      });

      if (res.cancelled) {
        setDownloadStatusMsg(null);
        return;
      }

      if (!res.success) {
        Alert.alert('Download Failed', res.error || 'Could not download original image.');
        return;
      }

      const sizeKb = res.byteSize ? `${(res.byteSize / 1024).toFixed(1)} KB` : '';
      const shortHash = res.sha256 ? res.sha256.slice(0, 10) : '';
      Alert.alert(
        downloadingEnhanced ? 'Enhanced Copy Saved' : 'Original Downloaded',
        `Saved ${res.fileName}${sizeKb ? ` (${sizeKb})` : ''}${shortHash ? `\nVerified SHA-256: ${shortHash}…` : ''}`
      );
    } catch (err: any) {
      Alert.alert('Download Error', err?.message || 'Unexpected error downloading file.');
    } finally {
      setIsDownloading(false);
      setDownloadStatusMsg(null);
    }
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,

      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        const s = stateRef.current;

        if (touches.length === 2) {
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          s.isPinching = true;
          s.pinchStartDistance = Math.max(1, Math.hypot(dx, dy));
          s.pinchStartScale = s.scale;
          s.pinchStartPanX = s.panX;
          s.pinchStartPanY = s.panY;
          s.pinchStartMidX = (touches[0].pageX + touches[1].pageX) / 2;
          s.pinchStartMidY = (touches[0].pageY + touches[1].pageY) / 2 - s.viewportOffsetY;
        } else if (touches.length === 1) {
          s.isPinching = false;
          s.dragStartPanX = s.panX;
          s.dragStartPanY = s.panY;

          // Double-tap focal zoom detection
          const now = Date.now();
          const tapX = touches[0].pageX;
          const tapY = touches[0].pageY;
          const dist = Math.hypot(tapX - s.lastTapX, tapY - s.lastTapY);

          if (now - s.lastTapTime < 300 && dist < 32) {
            if (typeof __DEV__ !== 'undefined' && __DEV__) {
              console.log('[HighResImageViewer] Double-tap triggered');
            }
            const vp = viewportSizeRef.current;
            const dims = currentDimsRef.current;
            const localY = Math.max(0, Math.min(vp.height, tapY - s.viewportOffsetY));

            if (s.scale > 1.15) {
              applyTransformValues(1, 0, 0, true);
            } else {
              const targetScale = Math.min(effectiveMaxZoomRef.current, 2.5);
              const focalPan = computeFocalZoomPan({
                currentScale: 1,
                nextScale: targetScale,
                currentPanX: 0,
                currentPanY: 0,
                focalX: tapX,
                focalY: localY,
                containerWidth: vp.width,
                containerHeight: vp.height,
                imageWidth: dims?.width,
                imageHeight: dims?.height,
              });
              applyTransformValues(targetScale, focalPan.x, focalPan.y, true);
            }
            s.lastTapTime = 0;
          } else {
            s.lastTapTime = now;
            s.lastTapX = tapX;
            s.lastTapY = tapY;
          }
        }
      },

      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;
        const s = stateRef.current;
        const vp = viewportSizeRef.current;
        const dims = currentDimsRef.current;

        if (touches.length === 2) {
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          const distance = Math.max(1, Math.hypot(dx, dy));

          if (!s.isPinching || s.pinchStartDistance === 0) {
            s.isPinching = true;
            s.pinchStartDistance = distance;
            s.pinchStartScale = s.scale;
            s.pinchStartPanX = s.panX;
            s.pinchStartPanY = s.panY;
            s.pinchStartMidX = (touches[0].pageX + touches[1].pageX) / 2;
            s.pinchStartMidY = (touches[0].pageY + touches[1].pageY) / 2 - s.viewportOffsetY;
            return;
          }

          const rawScale = s.pinchStartScale * (distance / s.pinchStartDistance);
          const nextScale = Math.max(1, Math.min(effectiveMaxZoomRef.current, rawScale));

          const focalPan = computeFocalZoomPan({
            currentScale: s.pinchStartScale,
            nextScale,
            currentPanX: s.pinchStartPanX,
            currentPanY: s.pinchStartPanY,
            focalX: s.pinchStartMidX,
            focalY: s.pinchStartMidY,
            containerWidth: vp.width,
            containerHeight: vp.height,
            imageWidth: dims?.width,
            imageHeight: dims?.height,
          });

          const curMidX = (touches[0].pageX + touches[1].pageX) / 2;
          const curMidY = (touches[0].pageY + touches[1].pageY) / 2 - s.viewportOffsetY;
          const midShiftX = curMidX - s.pinchStartMidX;
          const midShiftY = curMidY - s.pinchStartMidY;

          const clamped = clampPanOffset(
            focalPan.x + midShiftX,
            focalPan.y + midShiftY,
            nextScale,
            vp.width,
            vp.height,
            dims?.width,
            dims?.height
          );

          s.scale = nextScale;
          s.panX = clamped.x;
          s.panY = clamped.y;

          scaleAnim.setValue(nextScale);
          panAnim.setValue(clamped);
          setZoomPercent(Math.round(nextScale * 100));
        } else if (touches.length === 1 && !s.isPinching && s.scale > 1.03) {
          const clamped = clampPanOffset(
            s.dragStartPanX + gestureState.dx,
            s.dragStartPanY + gestureState.dy,
            s.scale,
            vp.width,
            vp.height,
            dims?.width,
            dims?.height
          );
          s.panX = clamped.x;
          s.panY = clamped.y;
          panAnim.setValue(clamped);
        }
      },

      onPanResponderRelease: (_evt, gestureState) => {
        const s = stateRef.current;

        if (s.isPinching) {
          s.isPinching = false;
          s.dragStartPanX = s.panX;
          s.dragStartPanY = s.panY;
          if (s.scale < 1.05) {
            applyTransformValues(1, 0, 0, true);
          }
          return;
        }

        // Swipe between photos at 1x zoom
        if (s.scale <= 1.03 && imagesLengthRef.current > 1) {
          if (gestureState.dx < -60 && currentIndexRef.current < imagesLengthRef.current - 1) {
            handleGoToIndex(currentIndexRef.current + 1);
            return;
          }
          if (gestureState.dx > 60 && currentIndexRef.current > 0) {
            handleGoToIndex(currentIndexRef.current - 1);
            return;
          }
        }
      },
    })
  ).current;

  if (!visible || !currentImage) return null;

  const isLoading = loadingMap[currentIndex];
  const hasError = errorMap[currentIndex];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <StatusBar barStyle="light-content" backgroundColor="#05080F" />
      <View style={styles.container}>
        {/* Top Bar */}
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.iconButton}
            activeOpacity={0.7}
            accessibilityLabel="Close image viewer"
          >
            <MaterialIcons name="close" size={24} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={styles.titleContainer}>
            {currentImage.title ? (
              <Text style={styles.titleText} numberOfLines={1}>
                {currentImage.title}
              </Text>
            ) : null}
            <Text style={styles.subtitleText} numberOfLines={1}>
              {images.length > 1 ? `${currentIndex + 1} / ${images.length} · ` : ''}
              {currentDims ? `${currentDims.width}×${currentDims.height} · ` : ''}
              {activeVariant === 'enhanced' ? 'Enhanced Copy' : 'Original'} · {zoomPercent}%
            </Text>
          </View>

          <View style={styles.headerActions}>
            {enableEnhance && currentImage.uri && (
              <TouchableOpacity
                onPress={() => setEnhanceModalVisible(true)}
                style={styles.iconButton}
                activeOpacity={0.75}
                accessibilityLabel="Enhance image copy"
              >
                <MaterialIcons name="auto-fix-high" size={20} color="#93C5FD" />
              </TouchableOpacity>
            )}

            {enableDownload && (
              <TouchableOpacity
                onPress={handleDownloadOriginal}
                style={[styles.iconButton, styles.downloadIconButton]}
                activeOpacity={0.75}
                disabled={isDownloading}
                accessibilityLabel="Download original image"
              >
                {isDownloading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <MaterialIcons name="download" size={21} color="#FFFFFF" />
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Download Status Strip */}
        {downloadStatusMsg && (
          <View style={styles.statusStrip}>
            <ActivityIndicator size="small" color="#93C5FD" />
            <Text style={styles.statusStripText}>{downloadStatusMsg}</Text>
          </View>
        )}

        {/* Non-Destructive Original vs Enhanced Copy Switcher (when available) */}
        {currentEnhancedUri && (
          <View style={styles.variantBar}>
            <TouchableOpacity
              onPress={() => {
                setActiveVariant('original');
                resetZoom(false);
              }}
              style={[styles.variantPill, activeVariant === 'original' && styles.variantPillActive]}
            >
              <Text
                style={[
                  styles.variantText,
                  activeVariant === 'original' && styles.variantTextActive,
                ]}
              >
                Original (Untouched)
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setActiveVariant('enhanced');
                resetZoom(false);
              }}
              style={[styles.variantPill, activeVariant === 'enhanced' && styles.variantPillActive]}
            >
              <Text
                style={[
                  styles.variantText,
                  activeVariant === 'enhanced' && styles.variantTextActive,
                ]}
              >
                Enhanced Copy
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Interactive Image Stage */}
        <View
          style={styles.stageContainer}
          onLayout={(e) => {
            const { width, height, y } = e.nativeEvent.layout;
            if (width > 0 && height > 0) {
              setViewportSize({ width, height });
              stateRef.current.viewportOffsetY = y;
            }
          }}
          {...panResponder.panHandlers}
        >
          {isLoading && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#FFFFFF" />
              <Text style={styles.loadingText}>Loading full-resolution original...</Text>
            </View>
          )}

          {hasError ? (
            <View style={styles.errorContainer}>
              <MaterialIcons name="broken-image" size={48} color="#94A3B8" />
              <Text style={styles.errorText}>Unable to render high-resolution image</Text>
              <TouchableOpacity
                onPress={() => {
                  setErrorMap((prev) => ({ ...prev, [currentIndex]: false }));
                  setLoadingMap((prev) => ({ ...prev, [currentIndex]: true }));
                }}
                style={styles.retryBtn}
              >
                <Text style={styles.retryBtnText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Animated.View
              style={[
                styles.animatedWrapper,
                {
                  transform: [
                    { translateX: panAnim.x },
                    { translateY: panAnim.y },
                    { scale: scaleAnim },
                  ],
                },
              ]}
            >
              <Image
                source={{ uri: activeDisplayUri }}
                style={{ width: viewportSize.width, height: viewportSize.height }}
                resizeMode="contain"
                onLoadStart={() =>
                  setLoadingMap((prev) => ({ ...prev, [currentIndex]: true }))
                }
                onLoadEnd={() =>
                  setLoadingMap((prev) => ({ ...prev, [currentIndex]: false }))
                }
                onError={() => {
                  setLoadingMap((prev) => ({ ...prev, [currentIndex]: false }));
                  setErrorMap((prev) => ({ ...prev, [currentIndex]: true }));
                }}
              />
            </Animated.View>
          )}
        </View>

        {/* Bottom Floating Zoom & Gallery Controls */}
        <View style={styles.bottomBar}>
          <View style={styles.controlsPill}>
            {images.length > 1 && (
              <TouchableOpacity
                onPress={() => handleGoToIndex(currentIndex - 1)}
                disabled={currentIndex === 0}
                style={[styles.ctrlBtn, currentIndex === 0 && styles.ctrlBtnDisabled]}
                accessibilityLabel="Previous image"
              >
                <MaterialIcons name="chevron-left" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={() => zoomByStep(-0.75)}
              disabled={zoomPercent <= 101}
              style={[styles.ctrlBtn, zoomPercent <= 101 && styles.ctrlBtnDisabled]}
              accessibilityLabel="Zoom out"
            >
              <MaterialIcons name="remove" size={20} color="#FFFFFF" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => resetZoom(true)}
              style={styles.zoomReadoutBtn}
              accessibilityLabel="Reset zoom to fit screen"
            >
              <Text style={styles.zoomReadoutText}>
                {zoomPercent > 102 ? `${zoomPercent}% · Fit` : '100%'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => zoomByStep(0.75)}
              disabled={zoomPercent >= Math.round(effectiveMaxZoom * 100) - 2}
              style={[
                styles.ctrlBtn,
                zoomPercent >= Math.round(effectiveMaxZoom * 100) - 2 && styles.ctrlBtnDisabled,
              ]}
              accessibilityLabel="Zoom in"
            >
              <MaterialIcons name="add" size={20} color="#FFFFFF" />
            </TouchableOpacity>

            {images.length > 1 && (
              <TouchableOpacity
                onPress={() => handleGoToIndex(currentIndex + 1)}
                disabled={currentIndex >= images.length - 1}
                style={[
                  styles.ctrlBtn,
                  currentIndex >= images.length - 1 && styles.ctrlBtnDisabled,
                ]}
                accessibilityLabel="Next image"
              >
                <MaterialIcons name="chevron-right" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            )}
          </View>

          <Text style={styles.hintText}>
            Pinch, double-tap, or tap + / − to zoom · Drag to inspect details
          </Text>
        </View>
      </View>

      {/* Non-destructive Enhancement Studio */}
      {enableEnhance && currentImage?.uri ? (
        <ImageEnhancementModal
          visible={enhanceModalVisible}
          sourceUri={currentImage.uri}
          fileName={currentImage.fileName || currentImage.title}
          onClose={() => setEnhanceModalVisible(false)}
          onSavedEnhanced={(res) => {
            setEnhancedOverrides((prev) => ({
              ...prev,
              [currentIndex]: {
                uri: res.enhancedUri,
                fileName: res.enhancedFileName,
              },
            }));
            setActiveVariant('enhanced');
            resetZoom(false);
            onEnhanceSaved?.(res, currentImage, currentIndex);
            Alert.alert(
              'Enhanced Copy Saved Separately',
              'Your original file remains untouched. Switched preview to the separate enhanced copy — toggle anytime at the top.'
            );
          }}
        />
      ) : null}
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05080F',
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 52 : 34,
    paddingHorizontal: 14,
    paddingBottom: 10,
    backgroundColor: 'rgba(5, 8, 15, 0.85)',
    zIndex: 10,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadIconButton: {
    backgroundColor: 'rgba(37, 99, 235, 0.85)',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  titleContainer: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
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
  statusStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    paddingVertical: 6,
  },
  statusStripText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '600',
  },
  variantBar: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 3,
    marginBottom: 4,
    zIndex: 10,
  },
  variantPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
  },
  variantPillActive: {
    backgroundColor: '#2563EB',
  },
  variantText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  variantTextActive: {
    color: '#FFFFFF',
  },
  stageContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  animatedWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
    gap: 8,
  },
  loadingText: {
    color: '#CBD5E1',
    fontSize: 12,
  },
  errorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },
  errorText: {
    color: '#94A3B8',
    fontSize: 14,
    textAlign: 'center',
  },
  retryBtn: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'ios' ? 32 : 20,
    paddingTop: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(5, 8, 15, 0.85)',
    gap: 8,
    zIndex: 10,
  },
  controlsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.92)',
    borderRadius: 24,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    gap: 4,
  },
  ctrlBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  ctrlBtnDisabled: {
    opacity: 0.35,
  },
  zoomReadoutBtn: {
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomReadoutText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  hintText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'center',
  },
});
