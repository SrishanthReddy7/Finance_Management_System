import { api } from './client';
import { unwrap } from './unwrap';

export async function listDepartmentsApi({ includeInactive } = {}) {
  const params = {};
  if (includeInactive != null) params.includeInactive = includeInactive;
  const res = await api.get('/departments', { params });
  return unwrap(res);
}
