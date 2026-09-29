// Consistent { success, data, error } response envelope for every endpoint,
// as specified in the FRS API conventions (Section 29).

export function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data, error: null });
}

export function created(res, data) {
  return ok(res, data, 201);
}

export function fail(res, status, message, details = null) {
  return res.status(status).json({
    success: false,
    data: null,
    error: { message, details },
  });
}
