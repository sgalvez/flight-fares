import { z } from "zod";
import type { FlightOffer, RadarPreferences } from "./domain.js";
import { assessDeals } from "./deals.js";
import { buildTripPairs } from "./trips.js";

const publicUrlHosts = [
  "latamairlines.com",
  "skyairline.com",
  "jetsmart.com",
  "google.com"
];

function publicPurchaseUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return undefined;
    const hostAllowed = publicUrlHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
    return hostAllowed ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

const dashboardOfferSchema = z.object({
  origin: z.enum(["SCL", "IQQ"]),
  destination: z.enum(["SCL", "IQQ"]),
  departureDate: z.string(),
  departureAt: z.string(),
  arrivalAt: z.string(),
  carrier: z.string(),
  flightNumber: z.string(),
  fareFamily: z.enum(["BASIC", "LIGHT", "FULL", "UNKNOWN"]),
  comparablePriceClp: z.number().int().nonnegative(),
  cabinBagIncluded: z.boolean().nullable(),
  verification: z.enum(["estimated", "verified", "stale"]),
  capturedAt: z.string(),
  tier: z.enum(["signal", "good", "exceptional"]),
  referenceClp: z.number().int().nonnegative().nullable(),
  percentBelowReference: z.number().nullable(),
  reason: z.string(),
  recommended: z.boolean(),
  purchaseUrl: z.string().url().optional()
});

const dashboardLegSchema = dashboardOfferSchema.pick({
  origin: true,
  destination: true,
  departureDate: true,
  departureAt: true,
  arrivalAt: true,
  carrier: true,
  flightNumber: true,
  comparablePriceClp: true,
  verification: true,
  capturedAt: true,
  purchaseUrl: true
});

export const dashboardSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  horizon: z.object({ start: z.string(), end: z.string(), days: z.number().int().positive() }),
  latestCapturedAt: z.string().nullable(),
  offers: z.array(dashboardOfferSchema),
  trips: z.array(z.object({
    nights: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    totalComparableClp: z.number().int().nonnegative(),
    allVerified: z.boolean(),
    outbound: dashboardLegSchema,
    inbound: dashboardLegSchema
  })).max(20)
});

export type DashboardSnapshot = z.infer<typeof dashboardSnapshotSchema>;

function publicLeg(offer: FlightOffer) {
  const purchaseUrl = publicPurchaseUrl(offer.purchaseUrl);
  return {
    origin: offer.origin,
    destination: offer.destination,
    departureDate: offer.departureDate,
    departureAt: offer.departureAt,
    arrivalAt: offer.arrivalAt,
    carrier: offer.carrier,
    flightNumber: offer.flightNumber,
    comparablePriceClp: offer.comparablePriceClp,
    verification: offer.verification,
    capturedAt: offer.capturedAt,
    ...(purchaseUrl ? { purchaseUrl } : {})
  };
}

export function buildDashboardSnapshot(input: {
  latest: FlightOffer[];
  history: FlightOffer[];
  preferences: RadarPreferences;
  generatedAt: Date;
  horizonStart: string;
  horizonEnd: string;
}): DashboardSnapshot {
  const deals = assessDeals(input.latest, input.history, input.preferences);
  const offers = deals.map((deal) => {
    const purchaseUrl = publicPurchaseUrl(deal.offer.purchaseUrl);
    return {
      origin: deal.offer.origin,
      destination: deal.offer.destination,
      departureDate: deal.offer.departureDate,
      departureAt: deal.offer.departureAt,
      arrivalAt: deal.offer.arrivalAt,
      carrier: deal.offer.carrier,
      flightNumber: deal.offer.flightNumber,
      fareFamily: deal.offer.fareFamily,
      comparablePriceClp: deal.offer.comparablePriceClp,
      cabinBagIncluded: deal.offer.baggage.cabinBagIncluded,
      verification: deal.offer.verification,
      capturedAt: deal.offer.capturedAt,
      tier: deal.tier,
      referenceClp: deal.medianClp,
      percentBelowReference: deal.percentBelowMedian,
      reason: deal.reason,
      recommended: deal.recommended,
      ...(purchaseUrl ? { purchaseUrl } : {})
    };
  }).sort((a, b) => a.departureDate.localeCompare(b.departureDate) || a.origin.localeCompare(b.origin));
  const trips = buildTripPairs(input.latest, input.preferences, input.generatedAt).slice(0, 20).map((trip) => ({
    nights: trip.nights,
    totalComparableClp: trip.totalComparableClp,
    allVerified: trip.allVerified,
    outbound: publicLeg(trip.outbound),
    inbound: publicLeg(trip.inbound)
  }));
  const latestCapturedAt = input.latest.map((offer) => offer.capturedAt).sort().at(-1) ?? null;

  return dashboardSnapshotSchema.parse({
    schemaVersion: 1,
    generatedAt: input.generatedAt.toISOString(),
    horizon: { start: input.horizonStart, end: input.horizonEnd, days: input.preferences.horizonDays },
    latestCapturedAt,
    offers,
    trips
  });
}
