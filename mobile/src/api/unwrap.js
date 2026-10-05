// Backend returns standard response envelopes: { success, data, error }
export function unwrap(res) {
  if (res && res.data && typeof res.data.data !== 'undefined') {
    return res.data.data;
  }
  return res.data;
}

export function unwrapError(err, fallback = 'Something went wrong. Please check your network and try again.') {
  const errorObj = err.response?.data?.error;
  if (errorObj?.details && Array.isArray(errorObj.details) && errorObj.details.length > 0) {
    const issues = errorObj.details
      .map((d) => `${d.path?.join('.') || 'field'}: ${d.message}`)
      .join('\n');
    return `${errorObj.message || 'Validation failed'}:\n${issues}`;
  }
  if (errorObj?.message) {
    return errorObj.message;
  }
  if (err.response?.data?.message) {
    return err.response.data.message;
  }
  if (err.message === 'Network Error') {
    return 'Unable to connect to server. Please check your API URL in Settings.';
  }
  return err.message || fallback;
}
