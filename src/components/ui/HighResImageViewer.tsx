import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  Image,
  TouchableOpacity,
  PanResponder,
  Animated,
  Dimensions,
  StatusBar,
  BackHandler,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface ImageViewerImage {
  uri: string;
  title?: string;
  subtitle?: string;
}

export interface HighResImageViewerProps {
  visible: boolean;
  images: (ImageViewerImage | string)[];
  initialIndex?: number;
  onClose: () => void;
  maxZoom?: number;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export const HighResImageViewer: React.FC<HighResImageViewerProps> = ({
  visible,
  images,
  initialIndex = 0,
  onClose,
  maxZoom = 6.0,
}) => {
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [zoomPercent, setZoomPercent] = useState(100);

  // Animated values for zoom & pan
  const scale = useRef(new Animated.Value(1)).current;
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  // Track raw values for gesture calculations
  const scaleValue = useRef(1);
  const panValue = useRef({ x: 0, y: 0 });

  // Multi-touch tracking
  const initialDistance = useRef<number | null>(null);
  const initialScale = useRef(1);
  const lastTapTime = useRef(0);

  // Normalize image inputs
  const normalizedImages: ImageViewerImage[] = images.map((img) =>
    typeof img === 'string' ? { uri: img } : img
  );

  const currentImage = normalizedImages[currentIndex] || null;

  // Reset transform state
  const resetTransform = useCallback(() => {
    scaleValue.current = 1;
    panValue.current = { x: 0, y: 0 };
    setZoomPercent(100);

    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        bounciness: 0,
      }),
      Animated.spring(pan, {
        toValue: { x: 0, y: 0 },
        useNativeDriver: true,
        bounciness: 0,
      }),
    ]).start();
  }, [scale, pan]);

  // Sync index when initialIndex changes or modal opens
  useEffect(() => {
    if (visible) {
      setCurrentIndex(Math.max(0, Math.min(initialIndex, normalizedImages.length - 1)));
      resetTransform();
      setIsLoading(true);
      setHasError(false);
    }
  }, [visible, initialIndex, normalizedImages.length, resetTransform]);

  // Android hardware back handler
  useEffect(() => {
    if (!visible) return;
    const backAction = () => {
      if (scaleValue.current > 1.05) {
        resetTransform();
        return true;
      }
      onClose();
      return true;
    };

    const handler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => handler.remove();
  }, [visible, onClose, resetTransform]);

  // Distance helper for pinch gesture
  const calcDistance = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Clamp pan translations within zoomed viewport bounds
  const clampPan = (newX: number, newY: number, currentScale: number) => {
    if (currentScale <= 1) return { x: 0, y: 0 };

    const maxPanX = (SCREEN_WIDTH * (currentScale - 1)) / 2;
    const maxPanY = (SCREEN_HEIGHT * (currentScale - 1)) / 2;

    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, newX)),
      y: Math.max(-maxPanY, Math.min(maxPanY, newY)),
    };
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return (
          gestureState.numberActiveTouches >= 2 ||
          scaleValue.current > 1.05 ||
          Math.abs(gestureState.dx) > 10 ||
          Math.abs(gestureState.dy) > 10
        );
      },

      onPanResponderGrant: (evt) => {
        // Double-tap detection
        const now = Date.now();
        if (evt.nativeEvent.touches.length === 1 && now - lastTapTime.current < 300) {
          // Double-tap triggered
          if (scaleValue.current > 1.1) {
            // Reset to 1x
            resetTransform();
          } else {
            // Zoom in to 2.5x
            const targetScale = 2.5;
            scaleValue.current = targetScale;
            setZoomPercent(Math.round(targetScale * 100));

            Animated.parallel([
              Animated.spring(scale, {
                toValue: targetScale,
                useNativeDriver: true,
                friction: 6,
              }),
              Animated.spring(pan, {
                toValue: { x: 0, y: 0 },
                useNativeDriver: true,
                friction: 6,
              }),
            ]).start();
          }
          lastTapTime.current = 0;
          return;
        }
        lastTapTime.current = now;

        // Multi-touch initialization
        if (evt.nativeEvent.touches.length >= 2) {
          const t0 = evt.nativeEvent.touches[0];
          const t1 = evt.nativeEvent.touches[1];
          initialDistance.current = calcDistance(t0.pageX, t0.pageY, t1.pageX, t1.pageY);
          initialScale.current = scaleValue.current;
        }
      },

      onPanResponderMove: (evt, gestureState) => {
        // 1. Pinch to zoom (2 fingers)
        if (evt.nativeEvent.touches.length >= 2) {
          const t0 = evt.nativeEvent.touches[0];
          const t1 = evt.nativeEvent.touches[1];
          const dist = calcDistance(t0.pageX, t0.pageY, t1.pageX, t1.pageY);

          if (initialDistance.current && initialDistance.current > 0) {
            const rawScale = (dist / initialDistance.current) * initialScale.current;
            const boundedScale = Math.max(0.85, Math.min(maxZoom * 1.25, rawScale));
            scaleValue.current = boundedScale;
            scale.setValue(boundedScale);
            setZoomPercent(Math.round(Math.min(maxZoom, boundedScale) * 100));
          }
          return;
        }

        // 2. Pan while zoomed (1 finger)
        if (scaleValue.current > 1.05) {
          const proposedX = panValue.current.x + gestureState.dx;
          const proposedY = panValue.current.y + gestureState.dy;
          const clamped = clampPan(proposedX, proposedY, scaleValue.current);

          pan.setValue(clamped);
          return;
        }

        // 3. Swipe down to dismiss (1 finger, scale === 1)
        if (gestureState.dy > 20 && Math.abs(gestureState.dx) < Math.abs(gestureState.dy)) {
          pan.setValue({ x: 0, y: gestureState.dy });
        }
      },

      onPanResponderRelease: (_, gestureState) => {
        initialDistance.current = null;

        // Settle scale
        if (scaleValue.current < 1) {
          resetTransform();
          return;
        }
        if (scaleValue.current > maxZoom) {
          scaleValue.current = maxZoom;
          Animated.spring(scale, {
            toValue: maxZoom,
            useNativeDriver: true,
          }).start();
        }

        // Settle pan
        if (scaleValue.current > 1.05) {
          const settledX = panValue.current.x + gestureState.dx;
          const settledY = panValue.current.y + gestureState.dy;
          const clamped = clampPan(settledX, settledY, scaleValue.current);
          panValue.current = clamped;

          Animated.spring(pan, {
            toValue: clamped,
            useNativeDriver: true,
            friction: 7,
          }).start();
          return;
        }

        // Swipe-down-to-dismiss trigger
        if (gestureState.dy > 120 && gestureState.vy > 0.4) {
          onClose();
          return;
        }

        // Horizontal swipe across gallery when at 1.0x zoom
        if (Math.abs(gestureState.dx) > 60 && Math.abs(gestureState.vx) > 0.3) {
          if (gestureState.dx < 0 && currentIndex < normalizedImages.length - 1) {
            // Next image
            setCurrentIndex((i) => i + 1);
            resetTransform();
            return;
          } else if (gestureState.dx > 0 && currentIndex > 0) {
            // Previous image
            setCurrentIndex((i) => i - 1);
            resetTransform();
            return;
          }
        }

        // Spring back if not dismissed
        Animated.spring(pan, {
          toValue: { x: 0, y: 0 },
          useNativeDriver: true,
        }).start();
      },
    })
  ).current;

  const handleNext = () => {
    if (currentIndex < normalizedImages.length - 1) {
      setCurrentIndex((i) => i + 1);
      resetTransform();
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
      resetTransform();
    }
  };

  if (!visible || !currentImage) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-black justify-between">
        <StatusBar barStyle="light-content" backgroundColor="#000000" />

        {/* Top Header Bar */}
        <View
          style={{ paddingTop: Math.max(insets.top, 16) }}
          className="px-4 pb-3 flex-row items-center justify-between z-20 bg-black/70"
        >
          <View className="flex-1 mr-3">
            <Text className="text-white text-base font-semibold" numberOfLines={1}>
              {currentImage.title || 'Image Preview'}
            </Text>
            {normalizedImages.length > 1 && (
              <Text className="text-white/60 text-xs mt-0.5 font-medium">
                {currentIndex + 1} of {normalizedImages.length}
                {currentImage.subtitle ? ` · ${currentImage.subtitle}` : ''}
              </Text>
            )}
          </View>

          <View className="flex-row items-center gap-2">
            {/* Zoom percentage pill */}
            {zoomPercent > 100 && (
              <TouchableOpacity
                onPress={resetTransform}
                className="bg-white/20 px-2.5 py-1 rounded-full border border-white/20"
                activeOpacity={0.7}
              >
                <Text className="text-white text-xs font-semibold">{zoomPercent}%</Text>
              </TouchableOpacity>
            )}

            {/* Close Button */}
            <TouchableOpacity
              onPress={onClose}
              className="w-10 h-10 rounded-full bg-white/20 items-center justify-center border border-white/10"
              activeOpacity={0.7}
              accessibilityLabel="Close image viewer"
            >
              <MaterialIcons name="close" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Interactive Viewport */}
        <View
          className="flex-1 items-center justify-center overflow-hidden"
          {...panResponder.panHandlers}
        >
          {isLoading && !hasError && (
            <View className="absolute z-10 items-center justify-center">
              <ActivityIndicator size="large" color="#FFFFFF" />
              <Text className="text-white/70 text-xs mt-2">Loading high-res image...</Text>
            </View>
          )}

          {hasError ? (
            <View className="items-center justify-center p-6 bg-white/5 rounded-2xl max-w-[280px]">
              <MaterialIcons name="broken-image" size={44} color="#EF4444" />
              <Text className="text-white font-semibold text-sm mt-3 text-center">
                Could not load image
              </Text>
              <Text className="text-white/60 text-xs mt-1 text-center">
                The file may be unavailable or deleted.
              </Text>
            </View>
          ) : (
            <Animated.View
              style={{
                width: SCREEN_WIDTH,
                height: SCREEN_HEIGHT * 0.75,
                transform: [
                  { scale },
                  { translateX: pan.x },
                  { translateY: pan.y },
                ],
              }}
              className="items-center justify-center"
            >
              <Image
                source={{ uri: currentImage.uri }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="contain"
                onLoadStart={() => setIsLoading(true)}
                onLoadEnd={() => setIsLoading(false)}
                onError={() => {
                  setIsLoading(false);
                  setHasError(true);
                }}
              />
            </Animated.View>
          )}

          {/* Left / Right Gallery Navigation Chevrons */}
          {normalizedImages.length > 1 && currentIndex > 0 && (
            <TouchableOpacity
              onPress={handlePrev}
              className="absolute left-3 w-10 h-10 rounded-full bg-black/50 items-center justify-center border border-white/20 z-10"
              activeOpacity={0.7}
              accessibilityLabel="Previous image"
            >
              <MaterialIcons name="chevron-left" size={28} color="#FFFFFF" />
            </TouchableOpacity>
          )}

          {normalizedImages.length > 1 && currentIndex < normalizedImages.length - 1 && (
            <TouchableOpacity
              onPress={handleNext}
              className="absolute right-3 w-10 h-10 rounded-full bg-black/50 items-center justify-center border border-white/20 z-10"
              activeOpacity={0.7}
              accessibilityLabel="Next image"
            >
              <MaterialIcons name="chevron-right" size={28} color="#FFFFFF" />
            </TouchableOpacity>
          )}
        </View>

        {/* Bottom Helper Bar */}
        <View
          style={{ paddingBottom: Math.max(insets.bottom, 20) }}
          className="px-4 pt-3 flex-row items-center justify-between z-20 bg-black/70"
        >
          {/* Quick Double-Tap / Pinch Guidance */}
          <Text className="text-white/50 text-[11px] font-medium">
            Pinch or double-tap to zoom · Drag to pan
          </Text>

          {/* Reset Zoom Button */}
          {zoomPercent > 100 && (
            <TouchableOpacity
              onPress={resetTransform}
              className="flex-row items-center gap-1 bg-white/20 px-3 py-1.5 rounded-full"
              activeOpacity={0.7}
            >
              <MaterialIcons name="zoom-out-map" size={14} color="#FFFFFF" />
              <Text className="text-white text-xs font-semibold">Reset</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
};
