import { api } from './client';
import { unwrap } from './unwrap';

export async function listUsersApi({ departmentId, page, pageSize } = {}) {
  const params = {};
  if (departmentId) params.departmentId = departmentId;
  if (page) params.page = page;
  if (pageSize) params.pageSize = pageSize;
  const res = await api.get('/users', { params });
  return unwrap(res);
}

export async function getEmployeeApi(id) {
  const res = await api.get(`/employees/${id}`);
  return unwrap(res);
}

export async function createEmployeeApi(body) {
  const res = await api.post('/users', body);
  return unwrap(res);
}

export async function setUserStatusApi(userId, status) {
  const res = await api.patch(`/users/${userId}/status`, { status });
  return unwrap(res);
}
