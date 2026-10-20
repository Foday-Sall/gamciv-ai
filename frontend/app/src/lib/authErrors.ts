/**
 * friendlyAuthError — one map from raw auth failures to plain sentences.
 *
 * Supabase GoTrue surfaces errors as AuthApiError objects with a `code`,
 * `status` and human-hostile `message` ("Invalid login credentials",
 * "over_email_send_rate_limit", "Failed to fetch"). Every auth catch block
 * in this app routes through here so a person always sees what happened
 * and what to do next — never jargon, never blame.
 */
const NETWORK_MESSAGE =
  'We could not reach the server. Check your internet connection and try again.'
const SERVER_DOWN_MESSAGE =
  'Our server is having a moment. Please try again in a minute.'
const RATE_LIMIT_MESSAGE =
  'Too many attempts. Please wait a few minutes and try again.'
const FALLBACK_MESSAGE = 'Something went wrong. Please try again.'

/** True for connection failures: fetch threw, DNS failed, or it timed out. */
function isNetworkError(err: { name?: string; message?: string; code?: string }): boolean {
  if (err.name === 'AuthRetryableFetchError' || err.name === 'FetchError') return true
  const msg = (err.message ?? '').toLowerCase()
  return (
    msg.includes('failed to fetch') ||
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('load failed') ||
    msg.includes('connection') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    err.code === 'ENOTFOUND' ||
    err.code === 'ECONNREFUSED'
  )
}

/** A GoTrue/HTTP status code carried on the error object, if any. */
function errorStatus(err: { status?: number; statusCode?: number }): number | undefined {
  return err.status ?? err.statusCode
}

/** The message is safe to show as-is: present, short, not a stack fragment. */
function isReadable(message: string): boolean {
  return (
    message.trim().length > 0 &&
    message.length <= 140 &&
    !/^(error|typeerror|http \d)/i.test(message.trim())
  )
}

/**
 * Map an auth failure (error object, {status,message} pair, or plain
 * message string) to a friendly sentence. Specific GoTrue errors win over
 * status codes; network failures always say "check your connection".
 */
export function friendlyAuthError(err: unknown): string {
  if (typeof err === 'string') return friendlyAuthError({ message: err })

  const e = (err ?? {}) as {
    name?: string
    message?: string
    code?: string
    status?: number
    statusCode?: number
  }
  const message = e.message ?? ''
  const m = message.toLowerCase()
  const code = (e.code ?? '').toLowerCase()
  const status = errorStatus(e)

  // 1. Connection failures first — never surface "Failed to fetch".
  if (isNetworkError(e)) return NETWORK_MESSAGE

  // 2. Known GoTrue error codes and messages, most specific first.
  if (
    code === 'invalid_credentials' ||
    m.includes('invalid login credentials')
  ) {
    return 'Wrong email or password. Try again or reset your password.'
  }
  if (code === 'email_not_confirmed' || m.includes('email not confirmed')) {
    return 'Please verify your email first — we sent you a code.'
  }
  if (
    code === 'user_already_registered' ||
    m.includes('user already registered') ||
    m.includes('already been registered')
  ) {
    return 'An account with this email already exists. Try logging in instead.'
  }
  if (
    code === 'over_email_send_rate_limit' ||
    code.includes('rate_limit') ||
    m.includes('email rate limit exceeded') ||
    m.includes('rate limit') ||
    m.includes('too many')
  ) {
    return RATE_LIMIT_MESSAGE
  }
  if (
    code === 'weak_password' ||
    m.includes('password should be at least') ||
    (m.includes('password') && (m.includes('short') || m.includes('weak') || m.includes('least')))
  ) {
    return 'Your password needs at least 6 characters.'
  }
  if (
    m.includes('unable to parse token') ||
    m.includes('invalid token') ||
    m.includes('token has expired') ||
    m.includes('email link is invalid or has expired') ||
    code === 'otp_expired'
  ) {
    return 'That link or code is no longer valid. Request a new one.'
  }
  if (m.includes('unable to validate email') || m.includes('invalid email')) {
    return 'That email address does not look right. Check it and try again.'
  }
  if (m.includes('signup requires a valid password')) {
    return 'Enter a password of at least 6 characters.'
  }

  // 3. Status codes we can read off the error.
  if (status === 429) return 'Too many requests. Please wait a bit and try again.'
  if (status === 500 || status === 502 || status === 503) return SERVER_DOWN_MESSAGE

  // 4. A readable server message passes through; everything else is the
  //    fallback so no jargon or stack text reaches the form.
  return isReadable(message) ? message : FALLBACK_MESSAGE
}
