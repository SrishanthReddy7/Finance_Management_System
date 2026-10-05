import { ok } from "../../utils/apiResponse.js";
import * as notificationService from "./notification.service.js";

export async function listNotifications(req, res, next) {
  try {
    const result = await notificationService.getUserNotifications(req.user);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
}

export async function markAsRead(req, res, next) {
  try {
    const { id } = req.params;
    const result = await notificationService.markNotificationAsRead(req.user, id);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
}

export async function markAllAsRead(req, res, next) {
  try {
    const result = await notificationService.markNotificationAsRead(req.user, "ALL");
    return ok(res, result);
  } catch (err) {
    next(err);
  }
}
