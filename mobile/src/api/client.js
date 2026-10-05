import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS, getActiveApiUrl } from '../config/env';

export const api = axios.create({
  timeout: 15000,
});

let onUnauthorizedCallback = null;

export function setUnauthorizedHandler(callback) {
  onUnauthorizedCallback = callback;
}

api.interceptors.request.use(
  async (config) => {
    if (!config.baseURL) {
      config.baseURL = await getActiveApiUrl();
    }

    const token = await AsyncStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

const AUTH_ENDPOINTS = [
  '/auth/login',
  '/auth/verify-otp',
  '/auth/resend-otp',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/refresh',
];

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const isAuthEndpoint = AUTH_ENDPOINTS.some((path) => err.config?.url?.includes(path));
    if (err.response?.status === 401 && !isAuthEndpoint) {
      if (typeof onUnauthorizedCallback === 'function') {
        onUnauthorizedCallback();
      }
    }
    return Promise.reject(err);
  }
);

export async function testConnection(testUrl) {
  try {
    let clean = testUrl.trim();
    if (clean.endsWith('/')) clean = clean.slice(0, -1);
    
    let healthUrl = clean.replace(/\/api\/v1\/?$/, '') + '/health';
    const res = await axios.get(healthUrl, { timeout: 5000 });
    return { ok: true, data: res.data };
  } catch (err) {
    try {
      const res2 = await axios.get(testUrl, { timeout: 5000 });
      return { ok: true, data: res2.data };
    } catch {
      return { ok: false, error: err.message || 'Connection failed' };
    }
  }
}
