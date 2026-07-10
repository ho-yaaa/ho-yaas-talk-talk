export function mergeInterimTranscript(previous: string, next: string): string {
  const cleanNext = next.trim();
  if (!cleanNext) return previous;
  if (!previous.trim()) return cleanNext;
  if (cleanNext.startsWith(previous.trim())) return cleanNext;
  if (previous.trim().endsWith(cleanNext)) return previous.trim();
  return cleanNext.length >= previous.trim().length ? cleanNext : previous.trim();
}

export function shouldTranslateInterim(text: string, lastText: string): boolean {
  const normalized = text.trim();
  if (normalized.length < 2) return false;
  if (normalized === lastText.trim()) return false;
  if (Math.abs(normalized.length - lastText.trim().length) < 2 && normalized.length < 8) return false;
  return true;
}
