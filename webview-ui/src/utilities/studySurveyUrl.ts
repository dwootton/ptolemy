export function studySurveyUrl(base: string | undefined, params: Record<string, string>): string | undefined {
  if (!base) return undefined;
  try {
    const url = new URL(base);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  } catch {
    return undefined;
  }
}
