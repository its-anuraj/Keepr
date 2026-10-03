
import * as Linking from 'expo-linking';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';

export interface RecoveryLinkResult {
  isRecovery: boolean;
  isError: boolean;
  errorCode?: string;
  errorDescription?: string;
}

/**
 * Extracts key-value parameters from a URL fragment (#...) or query string (?...)
 */
function parseUrlParameters(paramString: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!paramString) return result;

  const pairs = paramString.replace(/^[#?]/, '').split('&');
  for (const pair of pairs) {
    if (!pair) continue;
    const [key, value] = pair.split('=');
    if (key) {
      result[decodeURIComponent(key)] = value ? decodeURIComponent(value.replace(/\+/g, ' ')) : '';
    }
  }
  return result;
}

/**
 * Parses an incoming Keepr deep link (keepr://...) to determine if it is a
 * Supabase password recovery link and initializes the recovery session.
 * Never logs access tokens, refresh tokens, or secrets.
 */
export async function handleIncomingAuthLink(rawUrl: string): Promise<RecoveryLinkResult> {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { isRecovery: false, isError: false };
  }

  try {
    const parsed = Linking.parse(rawUrl);
    const path = (parsed.path || '').toLowerCase();
    const hostname = (parsed.hostname || '').toLowerCase();
    const fullPath = `${hostname}/${path}`.replace(/^\/+|\/+$/g, '');

    const isResetPasswordPath =
      fullPath.includes('reset-password') ||
      path.includes('reset-password') ||
      hostname.includes('reset-password');

    // 1. Extract hash parameters (Supabase implicit grant tokens: #access_token=...&type=recovery)
    const hashIdx = rawUrl.indexOf('#');
    const hashParams = hashIdx !== -1 ? parseUrlParameters(rawUrl.substring(hashIdx + 1)) : {};

    const queryIdx = rawUrl.indexOf('?');
    const queryClean = queryIdx !== -1
      ? rawUrl.substring(queryIdx + 1, hashIdx !== -1 && hashIdx > queryIdx ? hashIdx : undefined)
      : '';
    const queryParams = queryIdx !== -1 ? parseUrlParameters(queryClean) : {};

    const allParams = { ...queryParams, ...hashParams };

    const type = allParams.type || queryParams.type || hashParams.type;
    const isRecoveryType = type === 'recovery' || isResetPasswordPath;

    const error = allParams.error || queryParams.error || hashParams.error;
    const errorCode = allParams.error_code || queryParams.error_code || hashParams.error_code;
    const errorDescription =
      allParams.error_description || queryParams.error_description || hashParams.error_description;

    if (error || errorCode) {
      console.warn(`[PasswordReset] Recovery deep link returned error: ${errorCode || error}`);
      useAuthStore.setState({ isRecoveryMode: true });
      return {
        isRecovery: true,
        isError: true,
        errorCode: errorCode || error,
        errorDescription: errorDescription || 'Your password reset link is invalid or has expired.',
      };
    }

    const accessToken = hashParams.access_token || queryParams.access_token;
    const refreshToken = hashParams.refresh_token || queryParams.refresh_token;

    if (accessToken && refreshToken) {
      console.log(`[PasswordReset] Received recovery tokens via deep link (path=${path || hostname}, type=${type})`);

      if (isSupabaseConfigured) {
        const { data, error: setSessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (setSessionError) {
          console.warn('[PasswordReset] Failed to establish session from tokens:', setSessionError.message);
          return {
            isRecovery: true,
            isError: true,
            errorCode: 'session_failed',
            errorDescription: setSessionError.message,
          };
        }

        console.log('[PasswordReset] Recovery session established successfully in Supabase client');
      }

      useAuthStore.setState({ isRecoveryMode: true });
      return { isRecovery: true, isError: false };
    }

    // 5. Case B: PKCE authorization code (?code=...)
    const code = queryParams.code || hashParams.code;
    if (code && isRecoveryType) {
      console.log(`[PasswordReset] Received PKCE authorization code for recovery (path=${path || hostname})`);

      if (isSupabaseConfigured) {
        const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          console.warn('[PasswordReset] Failed to exchange code for session:', exchangeError.message);
          return {
            isRecovery: true,
            isError: true,
            errorCode: 'code_exchange_failed',
            errorDescription: exchangeError.message,
          };
        }

        console.log('[PasswordReset] PKCE recovery session established successfully in Supabase client');
      }

      useAuthStore.setState({ isRecoveryMode: true });
      return { isRecovery: true, isError: false };
    }

    if (isResetPasswordPath) {
      console.log('[PasswordReset] Deep link directly targeted reset-password route');
      return { isRecovery: true, isError: false };
    }

    return { isRecovery: false, isError: false };
  } catch (err: any) {
    console.error('[PasswordReset] Error parsing incoming auth link:', err?.message);
    return { isRecovery: false, isError: false };
  }
}
