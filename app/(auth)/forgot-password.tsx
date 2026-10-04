
import React, { useState } from 'react';
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
import { router } from 'expo-router';
import { KeeprLogo } from '../../src/components/ui/KeeprLogo';
import { SereneColors } from '../../src/constants/theme';
import { useAuthStore } from '../../src/store/authStore';

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const resetPasswordForEmail = useAuthStore((s) => s.resetPasswordForEmail);

  const handleSendResetLink = async () => {
    if (isSubmitting) return;

    setFormError(null);
    const cleanEmail = email.trim();

    if (!cleanEmail) {
      setFormError('Please enter your email address.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      setFormError('Please enter a valid email address.');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await resetPasswordForEmail(cleanEmail);

      if (res.success) {
        setIsSubmitted(true);
      } else {
        setFormError(res.error || 'Failed to send reset link. Please try again.');
      }
    } catch (err: any) {
      setFormError(err?.message || 'An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

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
          <TouchableOpacity
            className="w-10 h-10 items-center justify-center mb-2"
            onPress={() => router.back()}
            accessibilityLabel="Back to sign in"
          >
            <MaterialIcons name="arrow-back" size={24} color={SereneColors.onSurface} />
          </TouchableOpacity>

          <View className="items-center mb-6">
            <KeeprLogo size={52} />
            <Text className="text-[24px] font-bold text-serene-on-surface mt-3">
              {isSubmitted ? 'Check your email' : 'Forgot password?'}
            </Text>
            <Text className="text-[13px] text-serene-on-surface-variant text-center mt-1.5 max-w-[300px] leading-5">
              {isSubmitted
                ? 'Password reset instructions have been sent if an account exists for this email.'
                : "Enter the email address associated with your account and we'll send you a password reset link."}
            </Text>
          </View>

          {formError ? (
            <View className="flex-row items-center gap-2 bg-serene-error-container p-[10px] rounded-serene-md mb-4">
              <MaterialIcons name="error-outline" size={18} color={SereneColors.error} />
              <Text className="text-[12px] text-serene-error font-medium flex-1">{formError}</Text>
            </View>
          ) : null}

          {isSubmitted ? (
            <View className="bg-serene-surface-container-lowest border border-serene-subtle-border rounded-serene-xl p-5 items-center gap-4 shadow-xs">
              <View className="w-14 h-14 rounded-full bg-blue-50 items-center justify-center">
                <MaterialIcons name="mark-email-read" size={30} color={SereneColors.primary} />
              </View>

              <View className="items-center">
                <Text className="text-sm font-semibold text-serene-on-surface text-center">
                  Sent to {email.trim()}
                </Text>
                <Text className="text-xs text-serene-on-surface-variant text-center mt-1 leading-4">
                  Tap the secure link in the email to set a new password for your Keepr vault.
                </Text>
              </View>

              <TouchableOpacity
                className="w-full bg-serene-primary rounded-serene-lg h-12 items-center justify-center mt-2 shadow-xs"
                onPress={() => router.replace('/(auth)/login')}
                activeOpacity={0.8}
              >
                <Text className="text-white text-[14px] font-semibold">Back to Sign In</Text>
              </TouchableOpacity>

              <TouchableOpacity
                className="py-1"
                onPress={() => {
                  setIsSubmitted(false);
                  setFormError(null);
                }}
                activeOpacity={0.7}
              >
                <Text className="text-xs font-semibold text-serene-primary">
                  Didn't receive the email? Try again
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View className="gap-4">
              <View className="gap-[6px]">
                <Text className="text-[12px] font-semibold text-serene-on-surface">Email Address</Text>
                <View className="flex-row items-center bg-serene-surface-container-lowest border border-serene-subtle-border rounded-serene-lg h-12 px-3">
                  <MaterialIcons
                    name="mail-outline"
                    size={20}
                    color={SereneColors.outline}
                    style={{ marginRight: 8 }}
                  />
                  <TextInput
                    className="flex-1 text-[14px] text-serene-on-surface"
                    placeholder="Enter your email"
                    placeholderTextColor={SereneColors.outline}
                    value={email}
                    onChangeText={(t) => {
                      setEmail(t);
                      setFormError(null);
                    }}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoComplete="email"
                    editable={!isSubmitting}
                  />
                </View>
              </View>

              <TouchableOpacity
                className={`rounded-serene-lg h-12 items-center justify-center mt-2 shadow-xs ${
                  isSubmitting ? 'bg-serene-primary/70' : 'bg-serene-primary'
                }`}
                onPress={handleSendResetLink}
                disabled={isSubmitting}
                activeOpacity={0.8}
              >
                {isSubmitting ? (
                  <View className="flex-row items-center gap-2">
                    <ActivityIndicator size="small" color="#FFFFFF" />
                    <Text className="text-white text-[14px] font-semibold">Sending Reset Link...</Text>
                  </View>
                ) : (
                  <Text className="text-white text-[14px] font-semibold">Send Reset Link</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View className="flex-row justify-center items-center gap-1 mt-6">
          <Text className="text-[13px] text-serene-on-surface-variant">Remember your password?</Text>
          <TouchableOpacity onPress={() => router.replace('/(auth)/login')}>
            <Text className="text-[13px] font-semibold text-serene-primary">Sign in</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
