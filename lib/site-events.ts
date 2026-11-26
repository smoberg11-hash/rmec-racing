/**
 * Non-race events shown on the home page calendar. Edit here; no database change needed.
 * An event with date null isn't shown until a date is set.
 */
export type SiteEvent = {
  id: string;
  name: string;
  /** YYYY-MM-DD, or null while the date isn't set. */
  date: string | null;
  location: string | null;
  href: string;
  linkText: string;
};

export const SITE_EVENTS: SiteEvent[] = [
  {
    id: "banquet-2026",
    name: "RMEC Awards Banquet",
    date: "2027-01-30",
    location: "136 S Main St, Longmont, CO 80501",
    href: "/banquet",
    linkText: "Banquet sign-up →",
  },
];
