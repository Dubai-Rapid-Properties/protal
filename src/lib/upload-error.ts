/**
 * What to tell staff when a photo upload request itself fails (the server answered with an error
 * instead of a result). A page left open across a portal update can no longer reach the server's
 * upload; anything else shows the browser's own message so it can be reported.
 */
export function uploadErrorMessage(fileName: string, err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  if (/server action|failed to find/i.test(message))
    return `${fileName} was not uploaded: the portal was updated. Refresh the page and try again.`;
  return `${fileName} was not uploaded${message ? `: ${message}` : "."}`;
}
