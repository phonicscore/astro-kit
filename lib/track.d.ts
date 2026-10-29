/** A custom event for Usermaven's goals and funnels; does nothing without the `Analytics` loader. Never personal data. */
export function track(event: string, properties?: Record<string, string | number | boolean>): void;
