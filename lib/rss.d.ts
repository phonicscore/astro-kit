/** One post (or guide) in a feed. */
export interface RssItem {
  title: string;
  /** The page, absolute or site-relative; also the item's guid. Must equal the page's canonical URL. */
  link: string;
  /** When it was first published. */
  pubDate: string | Date;
  /** One or two sentences, plain text (the page's meta description). */
  description?: string;
  /** RSS wants an e-mail address here; leave it out rather than invent one. */
  author?: string;
  categories?: string[];
}

export interface RssOptions {
  /** The feed's name, e.g. "Sawti blog". */
  title: string;
  description: string;
  /** The site's origin, e.g. "https://sawti.app"; relative links resolve against it. */
  site: string;
  /** The page that lists the posts, e.g. "/blog/". */
  link: string;
  /** The feed's own address, e.g. "/blog/rss.xml". */
  self: string;
  /** BCP 47 code of the feed's language, e.g. "en", "de", "ar". */
  language?: string;
  /** In any order; the feed lists them newest first. */
  items: RssItem[];
}

/** An RSS 2.0 feed as text, newest item first. */
export function rss(options: RssOptions): string;

/** `rss()` as the Response of an Astro endpoint (`export const GET = () => rssResponse({...})`). */
export function rssResponse(options: RssOptions): Response;
