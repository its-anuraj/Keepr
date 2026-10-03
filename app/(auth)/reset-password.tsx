
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { KeeprLogo } from '../../src/components/ui/KeeprLogo';
import { SereneColors } from '../../src/constants/theme';
import { useAuthStore } from '../../src/store/authStore';
import { supabase, isSupabaseConfigured } from '../../src/lib/supabase';

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ error?: string; error_description?: string }>();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isLinkInvalidOrExpired, setIsLinkInvalidOrExpired] = useState(false);
  const [invalidMessage, setInvalidMessage] = useState<string>(
    'This password reset link is invalid, has already been used, or has expired. Please request a new one.'
  );

  const isRecoveryMode = useAuthStore((s) => s.isRecoveryMode);
  const session = useAuthStore((s) => s.session);
  const updatePassword = useAuthStore((s) => s.updatePassword);
  const clearRecoveryMode = useAuthStore((s) => s.clearRecoveryMode);

  useEffect(() => {
    async function verifyRecoveryEligibility() {
      if (params.error) {
        console.warn(`[ResetPassword] Error query param detected: ${params.error}`);
        setIsLinkInvalidOrExpired(true);
        if (params.error_description) {
          setInvalidMessage(decodeURIComponent(params.error_description.replace(/\+/g, ' ')));
        }
        setIsCheckingSession(false);
        return;
      }

      if (isRecoveryMode && session) {
        setIsCheckingSession(false);
        return;
      }

      if (isSupabaseConfigured) {
        try {
          const { data } = await supabase.auth.getSession();
          if (data?.session) {
            setIsCheckingSession(false);
            return;
          }
        } catch (err) {
          console.warn('[ResetPassword] Session check failed:', err);
        }
      } else {
        setIsCheckingSession(false);
        return;
      }

      // 4. No recovery session found — prevent unauthorized reset form
      console.warn('[ResetPassword] No recovery session or active token found');
      setIsLinkInvalidOrExpired(true);
      setIsCheckingSession(false);
    }

    verifyRecoveryEligibility();
  }, [params.error, params.error_description, isRecoveryMode, session]);

  const handleUpdatePassword = async () => {
    if (isSubmitting) return;
    setFormError(null);

    if (!newPassword) {
      setFormError('Please enter your new password.');
      return;
    }

    if (newPassword.length < 6) {
      setFormError('Password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setFormError('Passwords do not match. Please verify both fields.');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await updatePassword(newPassword);

      if (res.success) {
        setIsSuccess(true);
      } else {
        setFormError(res.error || 'Failed to update password. Please try again.');
      }
    } catch (err: any) {
      setFormError(err?.message || 'An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFinishAndSignIn = () => {
    clearRecoveryMode();
    router.replace('/(auth)/login');
  };

  if (isCheckingSession) {
    return (
      <View className="flex-1 bg-serene-surface items-center justify-center">
        <ActivityIndicator size="large" color={SereneColors.primary} />
        <Text className="text-xs text-serene-on-surface-variant font-medium mt-3">
          Verifying security link...
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-serene-surface"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 24,
          flexGrow: 1,
          justifyContent: 'space-between',
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 20,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View>
          <View className="items-center mb-6 mt-4">
            <KeeprLogo size={52} />
            <Text className="text-[24px] font-bold text-serene-on-surface mt-3">
              {isSuccess
                ? 'Password updated'
                : isLinkInvalidOrExpired
                ? 'Reset link expired'
                : 'Create new password'}
            </Text>
            <Text className="text-[13px] text-serene-on-surface-variant text-center mt-1.5 max-w-[300px] leading-5">
              {isSuccess
                ? 'Your password has been changed successfully. You can now sign in with your new password.'
                : isLinkInvalidOrExpired
                ? invalidMessage
                : 'Enter your new password below. It must be at least 6 characters long.'}
            </Text>
          </View>

          {formError ? (
            <View className="flex-row items-center gap-2 bg-serene-error-container p-[10px] rounded-serene-md mb-4">
              <MaterialIcons name="error-outline" size={18} color={SereneColors.error} />
              <Text className="text-[12px] text-serene-error font-medium flex-1">{formError}</Text>
            </View>
          ) : null}

          {isSuccess ? (
            <View className="bg-serene-surface-container-lowest border border-serene-subtle-border rounded-serene-xl p-5 items-center gap-4 shadow-xs">
              <View className="w-14 h-14 rounded-full bg-emerald-50 items-center justify-center">
                <MaterialIcons name="check-circle" size={32} color="#059669" />
              </View>

              <View className="items-center">
                <Text className="text-sm font-semibold text-serene-on-surface text-center">
                  Account Secured
                </Text>
                <Text className="text-xs text-serene-on-surface-variant text-center mt-1 leading-4">
                  Your new password is now active. Please sign in to continue into your Keepr vault.
                </Text>
              </View>

              <TouchableOpacity
                className="w-full bg-serene-primary rounded-serene-lg h-12 items-center justify-center mt-2 shadow-xs"
                onPress={handleFinishAndSignIn}
                activeOpacity={0.8}
              >
                <Text className="text-white text-[14px] font-semibold">Continue to Sign In</Text>
              </TouchableOpacity>
            </View>
          ) : isLinkInvalidOrExpired ? (
            <View className="bg-serene-surface-container-lowest border border-serene-subtle-border rounded-serene-xl p-5 items-center gap-4 shadow-xs">
              <View className="w-14 h-14 rounded-full bg-amber-50 items-center justify-center">
                <MaterialIcons name="link-off" size={30} color="#D97706" />
              </View>

              <View className="items-center">
                <Text className="text-sm font-semibold text-serene-on-surface text-center">
                  Link No Longer Valid
                </Text>
                <Text className="text-xs text-serene-on-surface-variant text-center mt-1 leading-4">
                  Password reset links are time-limited and can only be used once for security.
                </Text>
              </View>

              <TouchableOpacity
                className="w-full bg-serene-primary rounded-serene-lg h-12 items-center justify-center mt-2 shadow-xs"
                onPress={() => {
                  clearRecoveryMode();
                  router.replace('/(auth)/forgot-password');
                }}
                activeOpacity={0.8}
              >
                <Text className="text-white text-[14px] font-semibold">Request New Link</Text>
              </TouchableOpacity>

              <TouchableOpacity
                className="py-1"
                onPress={() => {
                  clearRecoveryMode();
                  router.replace('/(auth)/login');
                }}
                activeOpacity={0.7}
              >
                <Text className="text-xs font-semibold text-serene-primary">Back to Sign In</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View className="gap-4">
              <View className="gap-[6px]">
                <Text className="text-[12px] font-semibold text-serene-on-surface">New Password</Text>
                <View className="flex-row items-center bg-serene-surface-container-lowest border border-serene-subtle-border rounded-serene-lg h-12 px-3">
                  <MaterialIcons
                    name="lock-outline"
                    size={20}
                    color={SereneColors.outline}
                    style={{ marginRight: 8 }}
                  />
                  <TextInput
                    className="flex-1 text-[14px] text-serene-on-surface"
                    placeholder="Enter a new password"
                    placeholderTextColor={SereneColors.outline}
                    value={newPassword}
                    onChangeText={(t) => {
                      setNewPassword(t);
                      setFormError(null);
                    }}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    editable={!isSubmitting}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(!showPassword)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialIcons
                      name={showPassword ? 'visibility-off' : 'visibility'}
                      size={20}
                      color={SereneColors.outline}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              <View className="gap-[6px]">
                <Text className="text-[12px] font-semibold text-serene-on-surface">Confirm Password</Text>
                <View className="flex-row items-center bg-serene-surface-container-lowest border border-serene-subtle-border rounded-serene-lg h-12 px-3">
                  <MaterialIcons
                    name="lock-outline"
                    size={20}
                    color={SereneColors.outline}
                    style={{ marginRight: 8 }}
                  />
                  <TextInput
                    className="flex-1 text-[14px] text-serene-on-surface"
                    placeholder="Re-enter your new password"
                    placeholderTextColor={SereneColors.outline}
                    value={confirmPassword}
                    onChangeText={(t) => {
                      setConfirmPassword(t);
                      setFormError(null);
                    }}
                    secureTextEntry={!showConfirmPassword}
                    autoCapitalize="none"
                    editable={!isSubmitting}
                  />
                  <TouchableOpacity
                    onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialIcons
                      name={showConfirmPassword ? 'visibility-off' : 'visibility'}
                      size={20}
                      color={SereneColors.outline}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              <View className="bg-serene-surface-container-low/70 rounded-serene-md p-3 gap-1.5 border border-serene-hairline-border">
                <View className="flex-row items-center gap-1.5">
                  <MaterialIcons
                    name={newPassword.length >= 6 ? 'check-circle' : 'radio-button-unchecked'}
                    size={14}
                    color={newPassword.length >= 6 ? '#059669' : SereneColors.outline}
                  />
                  <Text
                    className={`text-[11px] ${
                      newPassword.length >= 6 ? 'text-emerald-700 font-medium' : 'text-serene-on-surface-variant'
                    }`}
                  >
                    Minimum 6 characters
                  </Text>
                </View>

                <View className="flex-row items-center gap-1.5">
                  <MaterialIcons
                    name={
                      confirmPassword && newPassword === confirmPassword
                        ? 'check-circle'
                        : 'radio-button-unchecked'
                    }
                    size={14}
                    color={
                      confirmPassword && newPassword === confirmPassword
                        ? '#059669'
                        : SereneColors.outline
                    }
                  />
                  <Text
                    className={`text-[11px] ${
                      confirmPassword && newPassword === confirmPassword
                        ? 'text-emerald-700 font-medium'
                        : 'text-serene-on-surface-variant'
                    }`}
                  >
                    Passwords match
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                className={`rounded-serene-lg h-12 items-center justify-center mt-2 shadow-xs ${
                  isSubmitting ? 'bg-serene-primary/70' : 'bg-serene-primary'
                }`}
                onPress={handleUpdatePassword}
                disabled={isSubmitting}
                activeOpacity={0.8}
              >
                {isSubmitting ? (
                  <View className="flex-row items-center gap-2">
                    <ActivityIndicator size="small" color="#FFFFFF" />
                    <Text className="text-white text-[14px] font-semibold">Updating Password...</Text>
                  </View>
                ) : (
                  <Text className="text-white text-[14px] font-semibold">Update Password</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View className="flex-row justify-center items-center gap-1 mt-6">
          <Text className="text-[13px] text-serene-on-surface-variant">Need help?</Text>
          <TouchableOpacity
            onPress={() => {
              clearRecoveryMode();
              router.replace('/(auth)/login');
            }}
          >
            <Text className="text-[13px] font-semibold text-serene-primary">Back to Sign In</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
