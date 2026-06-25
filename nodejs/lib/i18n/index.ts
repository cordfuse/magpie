// Lightweight i18n for Magpie. No framework dependency.
//
// Design notes:
// - Strings are keyed (e.g. 'header.openChats'), with the English fallback
//   inlined at the call site as the second arg to t(). Missing keys render
//   the fallback, so partial translations don't break the UI and new strings
//   can ship without coordinating translation updates.
// - Locale resolution: per-request (server reads the magpie_locale cookie),
//   pinned for the page lifecycle. Switching locale persists the cookie and
//   forces a reload — no React context churn, no SSR hydration mismatch.
// - Operators can drop <configDir>/locales/<code>.json to override built-in
//   strings OR introduce an entirely new locale. Server merges those onto
//   the built-in maps at request time (no rebuild).

import en from './locales/en'
import es from './locales/es'
import fr from './locales/fr'
import de from './locales/de'

export type LocaleCode = string  // 'en', 'es', 'fr-CA', etc.
export type Translations = Record<string, string>

// Built-in locales. Operators add more via JSON files in <configDir>/locales/.
export const BUILT_IN_LOCALES: Record<LocaleCode, Translations> = {
  en, es, fr, de,
}

export interface LocaleInfo {
  code: LocaleCode
  label: string  // human-readable, in its own language ("Español", "Deutsch")
}

export const BUILT_IN_LOCALE_INFO: LocaleInfo[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
]

// Make a t() function bound to a specific translation map. Each component
// that needs translations imports its own t from the React context (see
// I18nProvider), but the same function shape is used everywhere.
export function makeT(translations: Translations): (key: string, fallback: string) => string {
  return (key, fallback) => translations[key] ?? fallback
}
