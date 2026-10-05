import { api } from './client';
import { unwrap } from './unwrap';

export async function listInvoices({ status, clientId, page = 1, pageSize = 20 } = {}) {
  const params = { page, pageSize };
  if (status && status !== 'ALL') params.status = status;
  if (clientId) params.clientId = clientId;
  const res = await api.get('/invoices', { params });
  return unwrap(res);
}

export async function getInvoice(id) {
  const res = await api.get(`/invoices/${id}`);
  return unwrap(res);
}
