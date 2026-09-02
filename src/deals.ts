import type { DealAssessment, FlightOffer, RadarPreferences } from "./domain.js";
import { leadBucket } from "./date-utils.js";
import { offerIdentity } from "./pricing.js";

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[midpoint - 1]! + sorted[midpoint]!) / 2)
    : sorted[midpoint]!;
}

export function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

export function assessDeals(
  latest: FlightOffer[],
  history: FlightOffer[],
  preferences: RadarPreferences
): DealAssessment[] {
  const horizonByRoute = new Map<string, number[]>();
  for (const offer of latest) {
    const key = `${offer.origin}-${offer.destination}`;
    const values = horizonByRoute.get(key) ?? [];
    values.push(offer.comparablePriceClp);
    horizonByRoute.set(key, values);
  }

  const byDate = new Map<string, FlightOffer[]>();
  for (const offer of latest) {
    const key = `${offer.origin}-${offer.destination}:${offer.departureDate}`;
    const values = byDate.get(key) ?? [];
    values.push(offer);
    byDate.set(key, values);
  }

  const results: DealAssessment[] = [];
  for (const [dateKey, candidates] of byDate) {
    const cheapest = [...candidates].sort((a, b) => a.comparablePriceClp - b.comparablePriceClp)[0]!;
    const latam = candidates.filter((offer) => offer.carrier === "LA")
      .sort((a, b) => a.comparablePriceClp - b.comparablePriceClp)[0];
    const chosen = latam && latam.comparablePriceClp <= cheapest.comparablePriceClp * (1 + preferences.latamTolerancePercent / 100)
      ? latam
      : cheapest;

    const matchingHistory = history.filter((offer) =>
      offer.origin === chosen.origin &&
      offer.destination === chosen.destination &&
      offer.carrier === chosen.carrier &&
      new Date(offer.departureAt).getUTCDay() === new Date(chosen.departureAt).getUTCDay() &&
      leadBucket(offer.departureDate, offer.capturedAt) === leadBucket(chosen.departureDate, chosen.capturedAt)
    );
    const historicalMedian = median(matchingHistory.map((offer) => offer.comparablePriceClp));
    const observationCount = matchingHistory.length;
    const routePrices = horizonByRoute.get(`${chosen.origin}-${chosen.destination}`) ?? [];
    const bootstrapP20 = percentile(routePrices, 0.2);
    const reference = observationCount >= 21 ? historicalMedian : bootstrapP20;
    const percentBelow = reference && reference > 0
      ? Math.round(((reference - chosen.comparablePriceClp) / reference) * 1000) / 10
      : null;
    const tier = percentBelow !== null && percentBelow >= 25
      ? "exceptional"
      : percentBelow !== null && percentBelow >= 15
        ? "good"
        : "signal";
    const competitorSavings = latam && chosen.carrier !== "LA"
      ? Math.round(((latam.comparablePriceClp - chosen.comparablePriceClp) / latam.comparablePriceClp) * 100)
      : 0;
    const previous = history.filter((offer) =>
      offer.origin === chosen.origin && offer.destination === chosen.destination &&
      offer.departureDate === chosen.departureDate && offer.carrier === chosen.carrier &&
      offer.capturedAt < chosen.capturedAt
    ).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
    const dropClp = previous ? previous.comparablePriceClp - chosen.comparablePriceClp : 0;
    const dropPercent = previous && previous.comparablePriceClp > 0 ? (dropClp / previous.comparablePriceClp) * 100 : 0;
    const materialDrop = dropClp >= 10_000 && dropPercent >= 10;
    const recommended = chosen.verification === "verified" && (
      tier !== "signal" || competitorSavings >= preferences.competitorSavingsPercent || materialDrop
    );
    const reason = materialDrop
      ? `bajó ${dropClp.toLocaleString("es-CL")} CLP (${Math.round(dropPercent)}%) desde la observación anterior`
      : chosen === latam && chosen !== cheapest
      ? `LATAM está dentro del ${preferences.latamTolerancePercent}% de tolerancia`
      : competitorSavings >= preferences.competitorSavingsPercent
        ? `${competitorSavings}% menos que LATAM`
        : reference
          ? `${Math.max(0, percentBelow ?? 0)}% bajo la referencia`
          : "precio observado sin historial suficiente";

    results.push({
      key: `offer:${dateKey}:${offerIdentity(chosen)}`,
      offer: chosen,
      tier,
      medianClp: reference,
      percentBelowMedian: percentBelow,
      reason,
      recommended
    });
  }
  return results.sort((a, b) => a.offer.comparablePriceClp - b.offer.comparablePriceClp);
}
