import { api } from './client';
import { unwrap } from './unwrap';

export async function listNotifications() {
  const res = await api.get('/notifications');
  return unwrap(res);
}

export async function markNotificationRead(id) {
  const res = await api.patch(`/notifications/${id}/read`);
  return unwrap(res);
}

export async function markAllNotificationsRead() {
  const res = await api.post('/notifications/mark-all-read');
  return unwrap(res);
}
