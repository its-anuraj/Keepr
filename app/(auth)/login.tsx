
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

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { signIn, isLoading } = useAuthStore();

  const handleSignIn = async () => {
    setFormError(null);
    if (!email.trim()) {
      setFormError('Please enter your email address.');
      return;
    }
    if (!password.trim()) {
      setFormError('Please enter your password.');
      return;
    }

    const res = await signIn(email, password);
    if (res.success) {
      router.replace('/(tabs)');
    } else {
      setFormError(res.error || 'Failed to sign in. Please verify your credentials.');
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
            accessibilityLabel="Back"
          >
            <MaterialIcons name="arrow-back" size={24} color={SereneColors.onSurface} />
          </TouchableOpacity>

          <View className="items-center mb-6">
            <KeeprLogo size={52} />
            <Text className="text-[24px] font-bold text-serene-on-surface mt-3">Sign In to Vault</Text>
            <Text className="text-[13px] text-serene-on-surface-variant text-center mt-1 max-w-[280px]">
              Access your verified ownership records and asset warranties.
            </Text>
          </View>

          {formError ? (
            <View className="flex-row items-center gap-2 bg-serene-error-container p-[10px] rounded-serene-md mb-4">
              <MaterialIcons name="error-outline" size={18} color={SereneColors.error} />
              <Text className="text-[12px] text-serene-error font-medium flex-1">{formError}</Text>
            </View>
          ) : null}

          <View className="gap-4">
            <View className="gap-[6px]">
              <Text className="text-[12px] font-semibold text-serene-on-surface">Email Address</Text>
              <View className="flex-row items-center bg-serene-surface-container-lowest border border-serene-subtle-border rounded-serene-lg h-12 px-3">
                <MaterialIcons
                  name="mail-outline"
                  size={20}
                  color={SereneColors.outline}
                  className="mr-2"
                />
                <TextInput
                  className="flex-1 text-[14px] text-serene-on-surface"
                  placeholder="you@example.com"
                  placeholderTextColor={SereneColors.outline}
                  value={email}
                  onChangeText={(t) => {
                    setEmail(t);
                    setFormError(null);
                  }}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                />
              </View>
            </View>

            <View className="gap-[6px]">
              <View className="flex-row justify-between items-center">
                <Text className="text-[12px] font-semibold text-serene-on-surface">Password</Text>
                <TouchableOpacity
                  onPress={() => router.push('/(auth)/forgot-password')}
                  accessibilityLabel="Forgot password"
                >
                  <Text className="text-[11px] font-semibold text-serene-primary">Forgot password?</Text>
                </TouchableOpacity>
              </View>
              <View className="flex-row items-center bg-serene-surface-container-lowest border border-serene-subtle-border rounded-serene-lg h-12 px-3">
                <MaterialIcons
                  name="lock-outline"
                  size={20}
                  color={SereneColors.outline}
                  className="mr-2"
                />
                <TextInput
                  className="flex-1 text-[14px] text-serene-on-surface"
                  placeholder="Enter your password"
                  placeholderTextColor={SereneColors.outline}
                  value={password}
                  onChangeText={(t) => {
                    setPassword(t);
                    setFormError(null);
                  }}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  className="p-1"
                >
                  <MaterialIcons
                    name={showPassword ? 'visibility-off' : 'visibility'}
                    size={20}
                    color={SereneColors.outline}
                  />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              className={`flex-row items-center justify-center gap-2 bg-serene-primary h-12 rounded-serene-lg mt-2 shadow-sm ${
                isLoading ? 'opacity-60' : ''
              }`}
              activeOpacity={0.88}
              onPress={handleSignIn}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <Text className="text-[14px] font-semibold text-white">Sign In</Text>
                  <MaterialIcons name="login" size={18} color="#FFFFFF" />
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View className="flex-row items-center justify-center gap-[6px] py-4">
          <Text className="text-[13px] text-serene-on-surface-variant">Don't have a vault yet?</Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/signup')}>
            <Text className="text-[13px] font-bold text-serene-primary">Create Account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
