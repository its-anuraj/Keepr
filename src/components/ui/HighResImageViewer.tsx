/**
 * KEEPR DIGITAL OWNERSHIP VAULT: HighResImageViewer Component
 *
 * Enterprise-grade full-screen image viewer using UI-thread Reanimated transforms
 * coordinated with an incremental multi-touch state machine:
 * - True focal-point two-finger pinch-to-zoom & pinch-out (no center lock)
 * - Smooth incremental 2D panning (left/right/up/down/diagonal) across all 4 corners
 * - Seamless pinch -> single-finger pan handoff without losing drag offset
 * - Tap-2-release focal double-tap zoom (never overwritten by finger micro-jitter)
 * - Unified state shared across Pinch, Double-Tap, Plus (+), Minus (-), and Reset/Fit controls
 * - Original image preservation, Original vs Enhanced toggle, and Android SAF/Share download
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Image,
  PanResponder,
  Dimensions,
  ActivityIndicator,
  StyleSheet,
  Platform,
  StatusBar,
  Alert,
} from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
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
  const [dimensionsByUri, setDimensionsByUri] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.76,
  });

  // Track optional enhanced copy per image index WITHOUT touching original
  const [enhancedOverrides, setEnhancedOverrides] = useState<
    Record<number, { uri: string; fileName: string }>
  >({});
  const [activeVariant, setActiveVariant] = useState<'original' | 'enhanced'>('original');
  const [enhanceModalVisible, setEnhanceModalVisible] = useState(false);

  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadStatusMsg, setDownloadStatusMsg] = useState<string | null>(null);

  const stageRef = useRef<View | null>(null);

  // Reanimated shared values (single UI-thread source of truth for transforms)
  const scaleSV = useSharedValue(1);
  const panXSV = useSharedValue(0);
  const panYSV = useSharedValue(0);

  const animatedWrapperStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: panXSV.value },
      { translateY: panYSV.value },
      { scale: scaleSV.value },
    ],
  }));

  const stateRef = useRef({
    scale: 1,
    panX: 0,
    panY: 0,
    mode: 'idle' as 'idle' | 'single' | 'pinch',
    startTouchCount: 0,
    touchMoved: false,
    touchStartX: 0,
    touchStartY: 0,
    lastDragX: 0,
    lastDragY: 0,
    lastPinchDist: 0,
    lastPinchMidX: SCREEN_WIDTH / 2,
    lastPinchMidY: SCREEN_HEIGHT * 0.38,
    lastTapTime: 0,
    lastTapX: 0,
    lastTapY: 0,
    viewportWinX: 0,
    viewportWinY: 0,
    lastZoomUiSyncTime: 0,
  });

  const currentImage = images[currentIndex] || images[0];
  const currentEnhancedUri =
    enhancedOverrides[currentIndex]?.uri || currentImage?.enhancedUri || null;
  const activeDisplayUri =
    activeVariant === 'enhanced' && currentEnhancedUri
      ? currentEnhancedUri
      : currentImage?.uri || '';

  const currentDims = activeDisplayUri ? dimensionsByUri[activeDisplayUri] : undefined;
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

  const errorActiveRef = useRef(false);
  errorActiveRef.current = Boolean(errorMap[currentIndex]);

  const measureStageWindow = useCallback(() => {
    try {
      stageRef.current?.measureInWindow((wx, wy, width, height) => {
        if (Number.isFinite(wx)) stateRef.current.viewportWinX = wx;
        if (Number.isFinite(wy)) stateRef.current.viewportWinY = wy;
        if (width > 0 && height > 0) {
          setViewportSize((prev) =>
            prev.width === width && prev.height === height ? prev : { width, height }
          );
        }
      });
    } catch {}
  }, []);

  const syncZoomPercentThrottled = useCallback((scaleVal: number, force = false) => {
    const now = Date.now();
    if (force || now - stateRef.current.lastZoomUiSyncTime >= 45) {
      stateRef.current.lastZoomUiSyncTime = now;
      setZoomPercent(Math.round(scaleVal * 100));
    }
  }, []);

  const applyTransformValues = useCallback(
    (nextScale: number, nextX: number, nextY: number, animated = true) => {
      const clampedScale = Math.max(1, Math.min(effectiveMaxZoomRef.current, nextScale));
      const vp = viewportSizeRef.current;
      const dims = currentDimsRef.current;
      const clamped =
        clampedScale <= 1.001
          ? { x: 0, y: 0 }
          : clampPanOffset(
              nextX,
              nextY,
              clampedScale,
              vp.width,
              vp.height,
              dims?.width,
              dims?.height
            );

      cancelAnimation(scaleSV);
      cancelAnimation(panXSV);
      cancelAnimation(panYSV);

      stateRef.current.scale = clampedScale;
      stateRef.current.panX = clamped.x;
      stateRef.current.panY = clamped.y;
      setZoomPercent(Math.round(clampedScale * 100));

      if (animated) {
        scaleSV.value = withTiming(clampedScale, { duration: 190 });
        panXSV.value = withTiming(clamped.x, { duration: 190 });
        panYSV.value = withTiming(clamped.y, { duration: 190 });
      } else {
        scaleSV.value = clampedScale;
        panXSV.value = clamped.x;
        panYSV.value = clamped.y;
      }
    },
    [panXSV, panYSV, scaleSV]
  );

  const resetZoom = useCallback(
    (animated = true) => {
      applyTransformValues(1, 0, 0, animated);
    },
    [applyTransformValues]
  );

  const zoomByStep = useCallback(
    (delta: number) => {
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
    },
    [applyTransformValues]
  );

  const handleGoToIndex = useCallback(
    (nextIdx: number) => {
      if (nextIdx < 0 || nextIdx >= imagesLengthRef.current) return;
      setCurrentIndex(nextIdx);
      setActiveVariant('original');
      resetZoom(false);
    },
    [resetZoom]
  );

  // Reset state safely whenever viewer opens or closes
  useEffect(() => {
    if (visible) {
      const safeIdx = Math.max(0, Math.min(initialIndex, Math.max(0, images.length - 1)));
      setCurrentIndex(safeIdx);
      setActiveVariant('original');
      setDownloadStatusMsg(null);
      resetZoom(false);
      const t = setTimeout(measureStageWindow, 60);
      return () => clearTimeout(t);
    } else {
      stateRef.current.mode = 'idle';
      stateRef.current.lastTapTime = 0;
      resetZoom(false);
    }
  }, [visible, initialIndex, images.length, resetZoom, measureStageWindow]);

  // Measure real original image pixel dimensions for aspect-aware panning & adaptive max zoom
  useEffect(() => {
    if (!visible || !activeDisplayUri) return;
    if (dimensionsByUri[activeDisplayUri]) return;
    Image.getSize(
      activeDisplayUri,
      (width, height) => {
        if (width > 0 && height > 0) {
          setDimensionsByUri((prev) => ({
            ...prev,
            [activeDisplayUri]: { width, height },
          }));
        }
      },
      () => {}
    );
  }, [visible, activeDisplayUri, dimensionsByUri]);

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
      onStartShouldSetPanResponder: () => !errorActiveRef.current,
      onMoveShouldSetPanResponder: () => !errorActiveRef.current,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,

      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        const s = stateRef.current;

        // Cancel any active spring/timing animation and commit exact visual values before dragging
        cancelAnimation(scaleSV);
        cancelAnimation(panXSV);
        cancelAnimation(panYSV);
        measureStageWindow();

        s.touchMoved = false;
        s.startTouchCount = touches.length;

        if (touches.length >= 2) {
          const t0 = touches[0];
          const t1 = touches[1];
          const dx = t0.pageX - t1.pageX;
          const dy = t0.pageY - t1.pageY;
          s.mode = 'pinch';
          s.touchMoved = true;
          s.lastPinchDist = Math.max(4, Math.hypot(dx, dy));
          s.lastPinchMidX = (t0.pageX + t1.pageX) / 2 - s.viewportWinX;
          s.lastPinchMidY = (t0.pageY + t1.pageY) / 2 - s.viewportWinY;
        } else if (touches.length === 1) {
          s.mode = 'single';
          s.touchStartX = touches[0].pageX;
          s.touchStartY = touches[0].pageY;
          s.lastDragX = touches[0].pageX;
          s.lastDragY = touches[0].pageY;
        }
      },

      onPanResponderMove: (evt) => {
        const touches = evt.nativeEvent.touches;
        const s = stateRef.current;
        const vp = viewportSizeRef.current;
        const dims = currentDimsRef.current;

        if (touches.length >= 2) {
          const t0 = touches[0];
          const t1 = touches[1];
          const dx = t0.pageX - t1.pageX;
          const dy = t0.pageY - t1.pageY;
          const dist = Math.max(4, Math.hypot(dx, dy));
          const midX = (t0.pageX + t1.pageX) / 2 - s.viewportWinX;
          const midY = (t0.pageY + t1.pageY) / 2 - s.viewportWinY;

          s.touchMoved = true;

          // Transition cleanly into pinch mode on the frame the 2nd finger touches down (zero jump)
          if (s.mode !== 'pinch' || s.lastPinchDist <= 0) {
            s.mode = 'pinch';
            s.lastPinchDist = dist;
            s.lastPinchMidX = midX;
            s.lastPinchMidY = midY;
            return;
          }

          const stepRatio = dist / s.lastPinchDist;
          const nextScale = Math.max(1, Math.min(effectiveMaxZoomRef.current, s.scale * stepRatio));

          const focalPan = computeFocalZoomPan({
            currentScale: s.scale,
            nextScale,
            currentPanX: s.panX,
            currentPanY: s.panY,
            focalX: s.lastPinchMidX,
            focalY: s.lastPinchMidY,
            containerWidth: vp.width,
            containerHeight: vp.height,
            imageWidth: dims?.width,
            imageHeight: dims?.height,
          });

          const midShiftX = midX - s.lastPinchMidX;
          const midShiftY = midY - s.lastPinchMidY;

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
          s.lastPinchDist = dist;
          s.lastPinchMidX = midX;
          s.lastPinchMidY = midY;

          scaleSV.value = nextScale;
          panXSV.value = clamped.x;
          panYSV.value = clamped.y;
          syncZoomPercentThrottled(nextScale);
        } else if (touches.length === 1) {
          const curX = touches[0].pageX;
          const curY = touches[0].pageY;

          // Seamless handoff when lifting 1 finger during a pinch: keep zooming/panning smoothly!
          if (s.mode === 'pinch') {
            s.mode = 'single';
            s.touchMoved = true;
            s.lastDragX = curX;
            s.lastDragY = curY;
            return;
          }

          if (Math.hypot(curX - s.touchStartX, curY - s.touchStartY) > 6) {
            s.touchMoved = true;
          }

          const stepDx = curX - s.lastDragX;
          const stepDy = curY - s.lastDragY;
          s.lastDragX = curX;
          s.lastDragY = curY;

          if (s.scale > 1.01) {
            const clamped = clampPanOffset(
              s.panX + stepDx,
              s.panY + stepDy,
              s.scale,
              vp.width,
              vp.height,
              dims?.width,
              dims?.height
            );
            s.panX = clamped.x;
            s.panY = clamped.y;
            panXSV.value = clamped.x;
            panYSV.value = clamped.y;
          }
        }
      },

      onPanResponderRelease: (_evt, gestureState) => {
        const s = stateRef.current;
        const vp = viewportSizeRef.current;
        const dims = currentDimsRef.current;

        // Clean up snap-to-1x when zoomed slightly above 1.0
        if (s.mode === 'pinch') {
          s.mode = 'idle';
          if (s.scale < 1.04) {
            applyTransformValues(1, 0, 0, true);
          } else {
            syncZoomPercentThrottled(s.scale, true);
          }
          return;
        }

        // Handle clean double-tap ON RELEASE so no subsequent move overwrites the focal offset
        if (!s.touchMoved && s.startTouchCount === 1) {
          const now = Date.now();
          const tapX = gestureState.x0 || s.touchStartX;
          const tapY = gestureState.y0 || s.touchStartY;
          const distFromLast = Math.hypot(tapX - s.lastTapX, tapY - s.lastTapY);

          if (now - s.lastTapTime < 310 && distFromLast < 40) {
            if (typeof __DEV__ !== 'undefined' && __DEV__) {
              console.log('[HighResImageViewer] Double-tap triggered');
            }
            const localX = Math.max(0, Math.min(vp.width, tapX - s.viewportWinX));
            const localY = Math.max(0, Math.min(vp.height, tapY - s.viewportWinY));

            if (s.scale > 1.15) {
              applyTransformValues(1, 0, 0, true);
            } else {
              const targetScale = Math.min(effectiveMaxZoomRef.current, 2.5);
              const focalPan = computeFocalZoomPan({
                currentScale: s.scale,
                nextScale: targetScale,
                currentPanX: s.panX,
                currentPanY: s.panY,
                focalX: localX,
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
          s.mode = 'idle';
          return;
        }

        // Gallery horizontal swipe ONLY at 1x fit-to-screen zoom
        if (
          s.scale <= 1.03 &&
          s.startTouchCount === 1 &&
          imagesLengthRef.current > 1 &&
          Math.abs(gestureState.dx) > 65 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.35
        ) {
          if (gestureState.dx < 0 && currentIndexRef.current < imagesLengthRef.current - 1) {
            handleGoToIndex(currentIndexRef.current + 1);
          } else if (gestureState.dx > 0 && currentIndexRef.current > 0) {
            handleGoToIndex(currentIndexRef.current - 1);
          }
        }

        s.mode = 'idle';
        syncZoomPercentThrottled(s.scale, true);
      },

      onPanResponderTerminate: () => {
        stateRef.current.mode = 'idle';
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

        {/* Non-Destructive Original vs Enhanced Copy Switcher */}
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
          ref={stageRef}
          collapsable={false}
          style={styles.stageContainer}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            if (width > 0 && height > 0) {
              setViewportSize({ width, height });
            }
            measureStageWindow();
          }}
          {...panResponder.panHandlers}
        >
          {isLoading && (
            <View style={styles.loadingOverlay} pointerEvents="none">
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
            <Animated.View style={[styles.animatedWrapper, animatedWrapperStyle]}>
              <Image
                source={{ uri: activeDisplayUri }}
                style={{ width: viewportSize.width, height: viewportSize.height }}
                resizeMode="contain"
                onLoadStart={() =>
                  setLoadingMap((prev) => ({ ...prev, [currentIndex]: true }))
                }
                onLoad={(e) => {
                  const src = e?.nativeEvent?.source;
                  if (src?.width && src?.height && activeDisplayUri) {
                    setDimensionsByUri((prev) => ({
                      ...prev,
                      [activeDisplayUri]: { width: src.width, height: src.height },
                    }));
                  }
                }}
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
            Pinch, double-tap, or tap + / − to zoom · Drag in any direction
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
