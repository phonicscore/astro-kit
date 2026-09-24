/** Translator factory for a UI-string table; missing keys fall back to the default locale. */
export function createTranslator<K extends string>(
  ui: Record<string, Partial<Record<K, string>>>,
  defaultLocale: string
): (locale: string) => (key: K) => string;

/** The locale of a path: its first segment when that is a non-default locale, else the default. */
export function localeFromPath(
  pathname: string,
  locales: readonly string[],
  defaultLocale: string
): string;
