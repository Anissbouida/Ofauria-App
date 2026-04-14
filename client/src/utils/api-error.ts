/**
 * Extract the error message returned by the API from an Axios error.
 * Falls back to the provided default message if nothing is found.
 */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  const resp = (error as Record<string, unknown>)?.response as Record<string, unknown> | undefined;
  const data = resp?.data as Record<string, unknown> | undefined;
  const err = data?.error as Record<string, unknown> | undefined;
  return (err?.message as string) || fallback;
}
