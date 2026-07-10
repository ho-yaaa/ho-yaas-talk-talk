export class TranslationDedupe {
  private lastKey = '';

  shouldEmit(source: string, translated: string): boolean {
    const key = `${source.trim()}::${translated.trim()}`;
    if (!source.trim() || !translated.trim() || key === this.lastKey) return false;
    this.lastKey = key;
    return true;
  }
}
