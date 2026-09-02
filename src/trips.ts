import type { FlightOffer, RadarPreferences, TripPair } from "./domain.js";
import { daysBetween } from "./date-utils.js";

function bestByDate(offers: FlightOffer[], origin: string, destination: string): Map<string, FlightOffer> {
  const result = new Map<string, FlightOffer>();
  for (const offer of offers) {
    if (offer.origin !== origin || offer.destination !== destination) continue;
    const current = result.get(offer.departureDate);
    if (!current || offer.comparablePriceClp < current.comparablePriceClp) result.set(offer.departureDate, offer);
  }
  return result;
}

export function buildTripPairs(offers: FlightOffer[], preferences: RadarPreferences, now = new Date()): TripPair[] {
  const output: TripPair[] = [];
  for (const route of preferences.routes) {
    const outbound = bestByDate(offers, route.origin, route.destination);
    const inbound = bestByDate(offers, route.destination, route.origin);
    for (const first of outbound.values()) {
      for (const nights of preferences.stayNights) {
        const second = [...inbound.values()].find((offer) => daysBetween(first.departureDate, offer.departureDate) === nights);
        if (!second) continue;
        const fresh = [first, second].every((offer) => now.getTime() - new Date(offer.capturedAt).getTime() <= 86_400_000);
        output.push({
          key: `trip:${first.origin}-${first.destination}:${first.departureDate}:${second.departureDate}`,
          outbound: first,
          inbound: second,
          nights,
          totalComparableClp: first.comparablePriceClp + second.comparablePriceClp,
          allVerified: fresh && first.verification === "verified" && second.verification === "verified"
        });
      }
    }
  }
  return output.sort((a, b) => a.totalComparableClp - b.totalComparableClp);
}
