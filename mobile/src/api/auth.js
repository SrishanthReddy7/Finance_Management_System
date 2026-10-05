import { api } from './client';
import { unwrap } from './unwrap';

export async function loginApi(email, password, otp) {
  const payload = { email, password };
  if (otp) payload.otp = otp;
  const res = await api.post('/auth/login', payload);
  return unwrap(res);
}

export async function verifyOtpApi(email, otp) {
  const res = await api.post('/auth/verify-otp', { email, otp });
  return unwrap(res);
}

export async function resendOtpApi(email) {
  const res = await api.post('/auth/resend-otp', { email });
  return unwrap(res);
}

export async function forgotPasswordApi(email) {
  const res = await api.post('/auth/forgot-password', { email });
  return unwrap(res);
}

export async function resetPasswordApi(email, otp, newPassword) {
  const res = await api.post('/auth/reset-password', { email, otp, newPassword });
  return unwrap(res);
}

export async function getMeApi() {
  const res = await api.get('/auth/me');
  return unwrap(res);
}

export async function refreshApi(refreshToken) {
  const res = await api.post('/auth/refresh', { refreshToken });
  return unwrap(res);
}
