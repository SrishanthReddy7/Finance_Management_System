import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const STORAGE_KEYS = {
  ACCESS_TOKEN: 'finance_access_token',
  REFRESH_TOKEN: 'finance_refresh_token',
  SERVER_URL: 'finance_server_url',
  USER_DATA: 'finance_user_data',
};

import Constants from 'expo-constants';

// Default backend URL: automatically detects computer IP from Expo Go connection
export function getDefaultApiUrl() {
  // If running in Expo Go, hostUri contains the computer's LAN IP (e.g. 192.168.31.138:8081)
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.manifest2?.extra?.expoGo?.debuggerHost ||
    Constants.manifest?.debuggerHost;

  if (hostUri) {
    const ip = hostUri.split(':')[0];
    if (ip && ip !== 'localhost' && ip !== '127.0.0.1') {
      return `http://${ip}:5000/api/v1`;
    }
  }

  if (Platform.OS === 'android') {
    // Current LAN IP fallback or Android emulator 10.0.2.2 fallback
    return 'http://192.168.29.16:5000/api/v1';
  }
  // Physical device LAN default or localhost fallback
  return 'http://192.168.29.16:5000/api/v1';
}

export async function getActiveApiUrl() {
  const currentHost = getDefaultApiUrl();
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEYS.SERVER_URL);
    if (saved && saved.trim()) {
      const trimmed = saved.trim();
      // Check if saved is from an old subnet (e.g. 192.168.31.x while now on 192.168.29.x)
      const hostUri =
        Constants.expoConfig?.hostUri ||
        Constants.manifest2?.extra?.expoGo?.debuggerHost ||
        Constants.manifest?.debuggerHost;
      const detectedIp = hostUri ? hostUri.split(':')[0] : '192.168.29.16';

      if (detectedIp && detectedIp !== 'localhost' && detectedIp !== '127.0.0.1') {
        if (trimmed.includes('192.168.') && !trimmed.includes(detectedIp)) {
          const autoUpdated = `http://${detectedIp}:5000/api/v1`;
          await AsyncStorage.setItem(STORAGE_KEYS.SERVER_URL, autoUpdated);
          return autoUpdated;
        }
      }
      return trimmed;
    }
  } catch (err) {
    console.warn('Failed to read saved server URL from storage:', err);
  }
  return currentHost;
}

export async function setActiveApiUrl(url) {
  if (!url || !url.trim()) {
    await AsyncStorage.removeItem(STORAGE_KEYS.SERVER_URL);
  } else {
    let clean = url.trim();
    if (clean.endsWith('/')) {
      clean = clean.slice(0, -1);
    }
    if (!clean.endsWith('/api/v1') && !clean.includes('/api/')) {
      clean = `${clean}/api/v1`;
    }
    await AsyncStorage.setItem(STORAGE_KEYS.SERVER_URL, clean);
  }
}
