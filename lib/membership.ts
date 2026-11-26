/**
 * Membership settings: plans, prices and which payment provider is switched on.
 *
 * Nothing here charges anyone until MEMBERSHIP_PROVIDER is set in Vercel:
 *   (not set) / "preview"  – the Join page works up to the payment step, then says payments aren't on yet.
 *   "livelaps"             – the Join button sends people to LiveLaps (LIVELAPS_MEMBERSHIP_URL).
 *   "stripe"               – Stripe Checkout (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET).
 *   "square"               – Square payment links (SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID,
 *                            SQUARE_WEBHOOK_SIGNATURE_KEY).
 * Stripe and Square also need PAYMENTS_TOKEN (see importer/memberships.sql).
 * LiveLaps memberships keep working either way: the membership CSV import still updates riders.
 */

import { env } from "@/lib/env";
export type MembershipPlan = {
  id: string;
  name: string;
  description: string;
  /** Price in cents. null = not decided yet; checkout stays off for that plan. */
  priceCents: number | null;
};

// Placeholder plans: set the real names and prices when the board decides them.
export const MEMBERSHIP_PLANS: MembershipPlan[] = [
  {
    id: "adult",
    name: "Adult membership",
    description: "Riders 17 and over. Needed to be ranked in the adult standings and for year-end awards.",
    priceCents: null,
  },
  {
    id: "junior",
    name: "Junior membership",
    description: "Riders 16 and under. Counts for the junior series (and 16 & Under in the adult series).",
    priceCents: null,
  },
];

export type MembershipProvider = "preview" | "livelaps" | "stripe" | "square";

export function membershipProvider(): MembershipProvider {
  const value = (env("MEMBERSHIP_PROVIDER") ?? "").toLowerCase();
  return value === "livelaps" || value === "stripe" || value === "square" ? value : "preview";
}

export function formatPrice(cents: number | null) {
  return cents == null ? "Price to be announced" : `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

/** Memberships run to Dec 31 of the year they're bought for. */
export function membershipExpires(year: number) {
  return `${year}-12-31`;
}
