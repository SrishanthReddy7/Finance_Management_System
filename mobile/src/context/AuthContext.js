import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS, getActiveApiUrl, setActiveApiUrl, getDefaultApiUrl } from '../config/env';
import {
  loginApi,
  verifyOtpApi,
  resendOtpApi,
  forgotPasswordApi,
  resetPasswordApi,
  getMeApi,
} from '../api/auth';
import { unwrapError } from '../api/unwrap';
import { setUnauthorizedHandler, testConnection } from '../api/client';

const AuthContext = createContext(null);

function normalizeUser(meResponse) {
  if (!meResponse) return null;
  return {
    ...meResponse,
    roleName: meResponse.role?.name || meResponse.roleType || 'User',
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [serverUrl, setServerUrlState] = useState(getDefaultApiUrl());

  useEffect(() => {
    setUnauthorizedHandler(() => {
      logout();
    });
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const storedUrl = await getActiveApiUrl();
        setServerUrlState(storedUrl);

        const token = await AsyncStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
        if (token) {
          try {
            const meRes = await getMeApi();
            setUser(normalizeUser(meRes));
          } catch (err) {
            console.warn('Session expired or unreachable:', err.message);
            await AsyncStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
            await AsyncStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
            setUser(null);
          }
        }
      } catch (err) {
        console.warn('Init error:', err);
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, []);

  async function login(email, password, otp) {
    try {
      const loginRes = await loginApi(email, password, otp);

      // If backend requires OTP verification step
      if (loginRes.requiresOtp) {
        return {
          success: true,
          requiresOtp: true,
          email: loginRes.email,
          maskedEmail: loginRes.maskedEmail,
          otpPreview: loginRes.otpPreview,
          message: loginRes.message,
        };
      }

      // If login directly issued tokens
      const { accessToken, refreshToken } = loginRes;
      if (accessToken) {
        await AsyncStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, accessToken);
      }
      if (refreshToken) {
        await AsyncStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
      }

      const meRes = await getMeApi();
      const normalized = normalizeUser(meRes);
      setUser(normalized);
      return { success: true, user: normalized };
    } catch (err) {
      return {
        success: false,
        message: unwrapError(err, 'Invalid email or password.'),
      };
    }
  }

  async function verifyOtp(email, otp) {
    try {
      const res = await verifyOtpApi(email, otp);
      const { accessToken, refreshToken } = res;

      if (accessToken) {
        await AsyncStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, accessToken);
      }
      if (refreshToken) {
        await AsyncStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
      }

      const meRes = await getMeApi();
      const normalized = normalizeUser(meRes);
      setUser(normalized);
      return { success: true, user: normalized };
    } catch (err) {
      return {
        success: false,
        message: unwrapError(err, 'Invalid or expired OTP code.'),
      };
    }
  }

  async function resendOtp(email) {
    try {
      const res = await resendOtpApi(email);
      return { success: true, data: res };
    } catch (err) {
      return {
        success: false,
        message: unwrapError(err, 'Could not resend OTP code.'),
      };
    }
  }

  async function forgotPassword(email) {
    try {
      const res = await forgotPasswordApi(email);
      return { success: true, data: res };
    } catch (err) {
      return {
        success: false,
        message: unwrapError(err, 'Could not send reset code.'),
      };
    }
  }

  async function resetPassword(email, otp, newPassword) {
    try {
      const res = await resetPasswordApi(email, otp, newPassword);
      return { success: true, message: res.message || 'Password reset successfully!' };
    } catch (err) {
      return {
        success: false,
        message: unwrapError(err, 'Could not reset password.'),
      };
    }
  }

  async function logout() {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
      await AsyncStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
    } catch (err) {
      console.warn('Logout cleanup error:', err);
    }
    setUser(null);
  }

  async function changeServerUrl(newUrl) {
    await setActiveApiUrl(newUrl);
    const updated = await getActiveApiUrl();
    setServerUrlState(updated);
    return testConnection(updated);
  }

  function can(permissionCode) {
    if (!user) return false;
    if (user.roleType === 'SUPER_ADMIN') return true;
    return !!user.permissionCodes?.includes(permissionCode);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        serverUrl,
        login,
        verifyOtp,
        resendOtp,
        forgotPassword,
        resetPassword,
        logout,
        can,
        changeServerUrl,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
