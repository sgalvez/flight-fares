import type { FlightOffer } from "./domain.js";
import { fingerprint } from "./pricing.js";

export function offer(overrides: Partial<FlightOffer> = {}): FlightOffer {
  const base: FlightOffer = {
    source: "fixture",
    sourceKind: "fixture",
    origin: "SCL",
    destination: "IQQ",
    departureDate: "2026-09-10",
    departureAt: "2026-09-10T12:00:00.000Z",
    arrivalAt: "2026-09-10T14:15:00.000Z",
    carrier: "LA",
    operatingCarrier: "LA",
    flightNumber: "LA100",
    fareFamily: "LIGHT",
    currency: "CLP",
    basePriceClp: 30_000,
    taxesClp: 0,
    mandatoryFeesClp: 0,
    baggage: { personalItemIncluded: true, cabinBagIncluded: true, cabinBagFeeClp: 0, checkedBagIncluded: false },
    confirmedDiscountClp: 0,
    comparablePriceClp: 30_000,
    verification: "verified",
    purchaseUrl: "https://example.com",
    capturedAt: "2026-09-01T10:00:00.000Z",
    rawFingerprint: "fixture"
  };
  const merged = { ...base, ...overrides };
  return { ...merged, rawFingerprint: fingerprint([merged.origin, merged.destination, merged.departureDate, merged.carrier, merged.comparablePriceClp, overrides.rawFingerprint]) };
}
