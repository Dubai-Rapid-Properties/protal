/**
 * Telling "this session is not valid" from "the database could not answer right now".
 *
 * Only the first should send someone to the sign-in screen. Treating every failed lookup as
 * "signed out" meant a network blip, a slow answer or a 5xx from Supabase logged people out
 * mid-work, and the 30-second alarm polls made that many chances an hour.
 */
type ErrorLike = { code?: string | null; message?: string | null; name?: string | null; status?: number | null } | null | undefined;

/**
 * The access token was refused: PostgREST answers PGRST301-303 (and HTTP 401) for a token that is
 * missing, invalid or expired.
 */
export function isAuthFailure(error: ErrorLike, httpStatus?: number | null): boolean {
  if (!error) return false;
  if (/^PGRST30[123]$/.test(error.code ?? "")) return true;
  if (httpStatus === 401 || error.status === 401) return true;
  return /jwt (is )?(expired|invalid)|invalid jwt|jwt.*expired/i.test(error.message ?? "");
}

/** The request did not get a proper answer: no network, a timeout, or the server failed (5xx). */
export function isTransientFailure(error: ErrorLike, httpStatus?: number | null): boolean {
  if (!error) return false;
  const status = httpStatus ?? error.status ?? null;
  if (status !== null && (status === 0 || status >= 500 || status === 429)) return true;
  if (error.name === "AuthRetryableFetchError") return true;
  return /fetch failed|failed to fetch|network|timed? ?out|timeout|econn|enotfound|eai_again|socket|unexpected token/i.test(
    error.message ?? ""
  );
}
