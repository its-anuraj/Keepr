import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
  Linking,
  Platform,
  StyleSheet,
} from 'react-native';
import { CameraView, useCameraPermissions, FlashMode } from 'expo-camera';
import { MaterialIcons } from '@expo/vector-icons';
import { SereneColors } from '../../constants/theme';

export interface DirectCameraScannerProps {
  onCapture: (photo: { uri: string; width?: number; height?: number }) => void;
  onClose: () => void;
  onOpenGallery: () => void;
  initialFacing?: 'back' | 'front';
  initialFlash?: 'off' | 'on' | 'auto';
}

export const DirectCameraScanner: React.FC<DirectCameraScannerProps> = ({
  onCapture,
  onClose,
  onOpenGallery,
  initialFacing = 'back',
  initialFlash = 'auto',
}) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<'back' | 'front'>(initialFacing);
  const [flash, setFlash] = useState<'off' | 'on' | 'auto'>(initialFlash);
  const [isCapturing, setIsCapturing] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);

  const cameraRef = useRef<CameraView>(null);
  const scanLineAnim = useRef(new Animated.Value(0)).current;

  // Continuous animated scanner beam
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, {
          toValue: 1,
          duration: 2200,
          useNativeDriver: true,
        }),
        Animated.timing(scanLineAnim, {
          toValue: 0,
          duration: 2200,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [scanLineAnim]);

  const handleToggleFacing = () => {
    setFacing((prev) => (prev === 'back' ? 'front' : 'back'));
  };

  const handleToggleFlash = () => {
    setFlash((prev) => {
      if (prev === 'auto') return 'on';
      if (prev === 'on') return 'off';
      return 'auto';
    });
  };

  const handleShutterPress = async () => {
    if (!cameraRef.current || isCapturing) return;

    try {
      setIsCapturing(true);
      const photo = await cameraRef.current.takePictureAsync({
        quality: 1.0,
        skipProcessing: true,
      });

      if (photo?.uri) {
        onCapture({
          uri: photo.uri,
          width: photo.width,
          height: photo.height,
        });
      }
    } catch (err) {
      console.warn('[DirectCameraScanner] Capture error:', err);
    } finally {
      setIsCapturing(false);
    }
  };

  const handleOpenSettings = async () => {
    try {
      await Linking.openSettings();
    } catch (err) {
      console.warn('[DirectCameraScanner] Could not open device settings:', err);
    }
  };

  // 1. Permission checking / loading state
  if (!permission) {
    return (
      <View className="flex-1 bg-black items-center justify-center p-6">
        <ActivityIndicator size="large" color={SereneColors.primary} />
        <Text className="text-white text-sm mt-3 font-medium">Starting camera...</Text>
      </View>
    );
  }

  // 2. Permission denied / ungranted recovery state
  if (!permission.granted) {
    const isPermanentlyDenied = !permission.canAskAgain;

    return (
      <View className="flex-1 bg-serene-background items-center justify-center p-6">
        <View className="w-16 h-16 rounded-full bg-serene-surface-container-high items-center justify-center mb-4">
          <MaterialIcons name="camera-alt" size={32} color={SereneColors.primary} />
        </View>

        <Text className="text-xl font-bold text-serene-on-surface text-center mb-2">
          Camera Access Needed
        </Text>
        <Text className="text-sm text-serene-on-surface-variant text-center mb-6 leading-5 px-4">
          Keepr uses your device camera to directly scan physical receipts, invoices, and documents.
        </Text>

        <View className="w-full max-w-xs gap-3">
          {isPermanentlyDenied ? (
            <TouchableOpacity
              className="w-full py-3.5 rounded-serene-lg bg-serene-primary items-center shadow-sm"
              onPress={handleOpenSettings}
              activeOpacity={0.88}
            >
              <Text className="text-sm font-bold text-white">Open Device Settings</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              className="w-full py-3.5 rounded-serene-lg bg-serene-primary items-center shadow-sm"
              onPress={requestPermission}
              activeOpacity={0.88}
            >
              <Text className="text-sm font-bold text-white">Enable Camera Access</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            className="w-full py-3.5 rounded-serene-lg bg-serene-surface-container-lowest border border-serene-subtle-border items-center"
            onPress={onOpenGallery}
            activeOpacity={0.88}
          >
            <View className="flex-row items-center gap-2">
              <MaterialIcons name="photo-library" size={18} color={SereneColors.primary} />
              <Text className="text-sm font-bold text-serene-primary">Choose from Gallery</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            className="w-full py-2.5 items-center mt-1"
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Text className="text-sm font-medium text-serene-on-surface-variant">Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const scanLineTranslate = scanLineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 360],
  });

  return (
    <View className="flex-1 bg-black">
      {/* Native live camera stream */}
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        flash={flash as FlashMode}
        onCameraReady={() => setCameraReady(true)}
      />

      {/* Camera UI Overlay */}
      <View className="flex-1 justify-between p-4 pt-12 pb-8">
        {/* Top Control Bar */}
        <View className="flex-row items-center justify-between">
          <TouchableOpacity
            className="w-11 h-11 rounded-full bg-black/45 items-center justify-center border border-white/20"
            onPress={onClose}
            activeOpacity={0.8}
            accessibilityLabel="Close scanner"
          >
            <MaterialIcons name="close" size={24} color="#FFFFFF" />
          </TouchableOpacity>

          <View className="bg-black/45 px-4 py-1.5 rounded-full border border-white/15">
            <Text className="text-white text-xs font-semibold tracking-wide">
              Receipt Scanner
            </Text>
          </View>

          <View className="flex-row items-center gap-2">
            <TouchableOpacity
              className="w-11 h-11 rounded-full bg-black/45 items-center justify-center border border-white/20"
              onPress={handleToggleFlash}
              activeOpacity={0.8}
              accessibilityLabel="Toggle Flash"
            >
              <MaterialIcons
                name={
                  flash === 'on'
                    ? 'flash-on'
                    : flash === 'auto'
                    ? 'flash-auto'
                    : 'flash-off'
                }
                size={20}
                color={flash !== 'off' ? '#FBBF24' : '#FFFFFF'}
              />
            </TouchableOpacity>

            <TouchableOpacity
              className="w-11 h-11 rounded-full bg-black/45 items-center justify-center border border-white/20"
              onPress={handleToggleFacing}
              activeOpacity={0.8}
              accessibilityLabel="Flip Camera"
            >
              <MaterialIcons name="flip-camera-ios" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Viewfinder Center with Document Framing Guides */}
        <View className="items-center justify-center px-4">
          <View className="w-full max-w-[320px] h-[400px] relative rounded-2xl overflow-hidden">
            {/* Viewfinder boundary mask */}
            <View className="absolute inset-0 border-2 border-white/40 rounded-2xl" />

            {/* Corner Alignment Reticles */}
            <View className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-serene-primary rounded-tl-xl" />
            <View className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-serene-primary rounded-tr-xl" />
            <View className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-serene-primary rounded-bl-xl" />
            <View className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-serene-primary rounded-br-xl" />

            {/* Moving Laser Beam */}
            <Animated.View
              className="absolute left-2 right-2 h-1 bg-[#38BDF8] shadow-md shadow-[#38BDF8]"
              style={{
                transform: [{ translateY: scanLineTranslate }],
              }}
            />

            {/* In-viewfinder Alignment Prompt */}
            <View className="absolute bottom-3 left-0 right-0 items-center">
              <View className="bg-black/60 px-3 py-1 rounded-full flex-row items-center gap-1.5 border border-white/10">
                <View className="w-2 h-2 rounded-full bg-emerald-400" />
                <Text className="text-white text-[11px] font-medium">
                  Center receipt · Hold steady
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Bottom Shutter & Controls Bar */}
        <View className="flex-row items-center justify-around px-4">
          {/* Gallery Fallback Option */}
          <TouchableOpacity
            className="w-14 h-14 rounded-full bg-black/50 items-center justify-center border border-white/25"
            onPress={onOpenGallery}
            activeOpacity={0.8}
            accessibilityLabel="Pick from gallery"
          >
            <MaterialIcons name="photo-library" size={24} color="#FFFFFF" />
          </TouchableOpacity>

          {/* Master Shutter Button */}
          <TouchableOpacity
            className="w-20 h-20 rounded-full border-4 border-white items-center justify-center p-1 bg-white/20"
            onPress={handleShutterPress}
            disabled={isCapturing}
            activeOpacity={0.85}
            accessibilityLabel="Capture Receipt Photo"
          >
            <View className="w-full h-full rounded-full bg-white items-center justify-center shadow-lg">
              {isCapturing ? (
                <ActivityIndicator size="small" color={SereneColors.primary} />
              ) : (
                <View className="w-14 h-14 rounded-full bg-serene-primary items-center justify-center">
                  <MaterialIcons name="camera-alt" size={28} color="#FFFFFF" />
                </View>
              )}
            </View>
          </TouchableOpacity>

          {/* Placeholder to balance shutter symmetry */}
          <View className="w-14 h-14" />
        </View>
      </View>
    </View>
  );
};
