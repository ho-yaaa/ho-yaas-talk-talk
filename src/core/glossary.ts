import type { GlossaryTerm } from '../types';

export function applyGlossary(text: string, glossary: GlossaryTerm[]): string {
  return glossary.reduce((current, term) => {
    if (!term.source.trim()) return current;
    return current.replaceAll(term.source, term.target);
  }, text);
}

export function compactGlossaryForPrompt(glossary: GlossaryTerm[]): string {
  return glossary
    .filter((term) => term.source.trim() && term.target.trim())
    .slice(0, 30)
    .map((term) => `${term.source}=>${term.target}`)
    .join(', ');
}
