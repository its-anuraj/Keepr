import * as SplashScreen from 'expo-splash-screen';

let isSplashHidden = false;

/**
 * Authoritative splash screen coordinator.
 * Ensures the native Android splash screen is hidden ONLY after the first real
 * application screen (Welcome for logged-out, Vault for logged-in) has completed
 * its initial layout and is ready for display.
 */
export async function hideSplashScreen(source: string = 'unknown'): Promise<void> {
  if (isSplashHidden) return;
  isSplashHidden = true;

  console.log(`[StartupAuth] first app layout ready (source: ${source})`);
  try {
    await SplashScreen.hideAsync();
    console.log('[StartupAuth] native splash hidden');
  } catch (err) {
    console.warn('[StartupAuth] SplashScreen.hideAsync non-fatal error:', err);
  }
}

export function isSplashScreenDismissed(): boolean {
  return isSplashHidden;
}
