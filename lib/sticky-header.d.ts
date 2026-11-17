/** The top of the part of the window the sticky header leaves free: its bottom edge while any of it shows, else 0. */
export function visibleTop(): number;
/** Keeps `--sticky-header-h` on <html> at the header's height while it sticks, 0px while it doesn't. Called by `StickyHeader`. */
export function watchStickyHeader(): void;
