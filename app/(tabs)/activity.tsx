
import { useEffect } from 'react';
import { router } from 'expo-router';

export default function ActivityRedirect() {
  useEffect(() => {
    router.replace('/(tabs)');
  }, []);

  return null;
}
