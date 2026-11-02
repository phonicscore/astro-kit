/** OSMD's options for light or dark mode, for its constructor or setOptions. */
export interface ScoreScheme {
  darkMode: boolean;
  defaultColorMusic?: string;
  pageBackgroundColor?: string;
}

/** OSMD's options for the page's current mode: in dark mode the site's ink (`--color-ink`) on its score ground (`--color-score`). */
export function scoreScheme(tokens?: { ink?: string; ground?: string }): ScoreScheme;

/** Runs the callback when the page switches between light and dark. */
export function onSchemeChange(callback: () => void): void;
