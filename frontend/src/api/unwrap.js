// Every backend response is { success, data, error }. `unwrap` pulls the
// payload out of a resolved axios response; `unwrapError` pulls a
// human-readable message out of a rejected one.
export function unwrap(res) {
  return res.data.data
}

export function unwrapError(err, fallback = 'Something went wrong. Please try again.') {
  return err.response?.data?.error?.message || fallback
}
