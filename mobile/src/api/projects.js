import { api } from './client';
import { unwrap } from './unwrap';

export async function listProjects(params = {}) {
  const res = await api.get('/projects', { params });
  return unwrap(res);
}

export async function listClients(params = {}) {
  const res = await api.get('/clients', { params });
  return unwrap(res);
}
