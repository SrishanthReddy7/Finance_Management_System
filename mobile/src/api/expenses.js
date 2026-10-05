import { Platform } from 'react-native';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './client';
import { unwrap } from './unwrap';
import { STORAGE_KEYS, getActiveApiUrl } from '../config/env';

export async function listCategories() {
  const res = await api.get('/expenses/categories');
  return unwrap(res);
}

export async function listClaims({ status, projectId, page = 1, pageSize = 20 } = {}) {
  const params = { page, pageSize };
  if (status && status !== 'ALL') params.status = status;
  if (projectId) params.projectId = projectId;
  const res = await api.get('/expenses', { params });
  return unwrap(res);
}

export async function getClaim(id) {
  const res = await api.get(`/expenses/${id}`);
  return unwrap(res);
}

export async function createClaim(payload) {
  const res = await api.post('/expenses', payload);
  return unwrap(res);
}

export async function updateClaim(id, payload) {
  const res = await api.patch(`/expenses/${id}`, payload);
  return unwrap(res);
}

export async function submitClaim(id) {
  const res = await api.post(`/expenses/${id}/submit`);
  return unwrap(res);
}

export async function cancelClaim(id, comment) {
  const res = await api.patch(`/expenses/${id}/cancel`, comment ? { comment } : {});
  return unwrap(res);
}

export async function uploadReceipt(claimId, fileUri, fileName = 'receipt.jpg', mimeType = 'image/jpeg') {
  const baseUrl = await getActiveApiUrl();
  const token = await AsyncStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);

  const cleanFileName = fileName || 'receipt.jpg';
  const cleanMime = (mimeType && mimeType.includes('/')) ? mimeType : 'image/jpeg';
  const uploadUrl = `${baseUrl}/expenses/${claimId}/receipts`;

  // 1. Try native LegacyFileSystem.uploadAsync (native background-capable streaming on iOS / Android)
  if (Platform.OS !== 'web' && typeof LegacyFileSystem?.uploadAsync === 'function') {
    try {
      const uploadType = LegacyFileSystem.FileSystemUploadType?.MULTIPART ?? 1;
      const res = await LegacyFileSystem.uploadAsync(uploadUrl, fileUri, {
        httpMethod: 'POST',
        uploadType,
        fieldName: 'receipt',
        mimeType: cleanMime,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      const json = res.body ? JSON.parse(res.body) : {};
      if (res.status >= 200 && res.status < 300) {
        return json?.data || json;
      }
      throw new Error(json?.error?.message || json?.message || `Upload failed with status ${res.status}`);
    } catch (fsErr) {
      console.warn('Native uploadAsync failed, falling back to fetch/FormData:', fsErr?.message || fsErr);
    }
  }

  // 2. Fetch with FormData (standard React Native streaming upload)
  try {
    const formData = new FormData();
    formData.append('receipt', {
      uri: fileUri,
      name: cleanFileName,
      type: cleanMime,
    });

    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        // Important: Do not set Content-Type header so the boundary is automatically generated
      },
      body: formData,
    });

    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      return json?.data || json;
    }
    throw new Error(json?.error?.message || json?.message || `Upload failed with status ${res.status}`);
  } catch (fetchErr) {
    console.warn('Fetch upload failed, falling back to XHR:', fetchErr?.message || fetchErr);
  }

  // 3. Fallback: standard XMLHttpRequest
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${baseUrl}/expenses/${claimId}/receipts`);
    xhr.setRequestHeader('Accept', 'application/json');
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(json?.data || json);
        } else {
          reject(new Error(json?.error?.message || json?.message || `Upload failed: ${xhr.status}`));
        }
      } catch {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.responseText);
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('Network error during receipt upload'));
    xhr.ontimeout = () => reject(new Error('Receipt upload timed out'));

    const formData = new FormData();
    formData.append('receipt', {
      uri: fileUri,
      name: cleanFileName,
      type: cleanMime,
    });
    xhr.send(formData);
  });
}

export async function managerReview(id, decision, comment) {
  const norm = decision === 'APPROVED' ? 'APPROVE' : (decision === 'REJECTED' ? 'REJECT' : decision);
  const res = await api.patch(`/expenses/${id}/manager-review`, { decision: norm, comment });
  return unwrap(res);
}

export async function financeReview(id, decision, comment) {
  const norm = decision === 'APPROVED' ? 'APPROVE' : (decision === 'REJECTED' ? 'REJECT' : decision);
  const res = await api.patch(`/expenses/${id}/finance-review`, { decision: norm, comment });
  return unwrap(res);
}

export async function processReimbursement(id, { method = 'BANK_TRANSFER', referenceNo } = {}) {
  const res = await api.post(`/expenses/${id}/reimbursement`, {
    method,
    ...(referenceNo ? { referenceNo } : {}),
  });
  return unwrap(res);
}
