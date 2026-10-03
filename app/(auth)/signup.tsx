
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

export default function SignupScreen() {
  const insets = useSafeAreaInsets();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { signUp, isLoading } = useAuthStore();

  const handleSignUp = async () => {
    setFormError(null);
    if (!fullName.trim()) {
      setFormError('Please enter your full name.');
      return;
    }
    if (!email.trim()) {
      setFormError('Please enter your email address.');
      return;
    }
    if (!password.trim() || password.length < 6) {
      setFormError('Password must be at least 6 characters long.');
      return;
    }

    const res = await signUp(email, password, fullName);
    if (res.success) {
      router.replace('/(tabs)');
    } else {
      setFormError(res.error || 'Failed to create account. Please try again.');
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

          <View className="items-center mb-5">
            <KeeprLogo size={52} />
            <Text className="text-[24px] font-bold text-serene-on-surface mt-3">Create Digital Vault</Text>
            <Text className="text-[13px] text-serene-on-surface-variant text-center mt-1 max-w-[280px]">
              Secure all your physical & digital assets in one encrypted space.
            </Text>
          </View>

          {formError ? (
            <View className="flex-row items-center gap-2 bg-serene-error-container p-[10px] rounded-serene-md mb-4">
              <MaterialIcons name="error-outline" size={18} color={SereneColors.error} />
              <Text className="text-[12px] text-serene-error font-medium flex-1">{formError}</Text>
            </View>
          ) : null}

          <View className="gap-[14px]">
            <View className="gap-[6px]">
              <Text className="text-[12px] font-semibold text-serene-on-surface">Full Name</Text>
              <View className="flex-row items-center bg-serene-surface-container-lowest border border-serene-subtle-border rounded-serene-lg h-12 px-3">
                <MaterialIcons
                  name="person-outline"
                  size={20}
                  color={SereneColors.outline}
                  className="mr-2"
                />
                <TextInput
                  className="flex-1 text-[14px] text-serene-on-surface"
                  placeholder="e.g. Anuraj Singh"
                  placeholderTextColor={SereneColors.outline}
                  value={fullName}
                  onChangeText={(t) => {
                    setFullName(t);
                    setFormError(null);
                  }}
                  autoCapitalize="words"
                />
              </View>
            </View>

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
              <Text className="text-[12px] font-semibold text-serene-on-surface">Master Vault Password</Text>
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
              onPress={handleSignUp}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <Text className="text-[14px] font-semibold text-white">Create Vault Account</Text>
                  <MaterialIcons name="shield" size={18} color="#FFFFFF" />
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View className="flex-row items-center justify-center gap-[6px] py-4">
          <Text className="text-[13px] text-serene-on-surface-variant">Already have an account?</Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/login')}>
            <Text className="text-[13px] font-bold text-serene-primary">Sign In</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
