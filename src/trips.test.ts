import { describe, expect, it } from "vitest";
import type { RadarPreferences } from "./domain.js";
import { offer } from "./test-helpers.js";
import { buildTripPairs } from "./trips.js";

const preferences: RadarPreferences = {
  routes: [{ origin: "SCL", destination: "IQQ" }, { origin: "IQQ", destination: "SCL" }],
  horizonDays: 60,
  adults: 1,
  cabinBagRequired: true,
  stayNights: [2, 3, 4],
  latamTolerancePercent: 10,
  competitorSavingsPercent: 20,
  bankProducts: [], latamPassTier: "LATAM", latamPassClub: false
};

describe("trip pairs", () => {
  it("combines independently-priced legs for 2-4 nights", () => {
    const pairs = buildTripPairs([
      offer({ departureDate: "2026-09-10", comparablePriceClp: 30_000 }),
      offer({ origin: "IQQ", destination: "SCL", departureDate: "2026-09-13", departureAt: "2026-09-13T12:00:00Z", comparablePriceClp: 35_000 })
    ], preferences, new Date("2026-09-01T12:00:00Z"));
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ nights: 3, totalComparableClp: 65_000, allVerified: true });
  });

  it("rejects unsupported stay lengths", () => {
    const pairs = buildTripPairs([
      offer({ departureDate: "2026-09-10" }),
      offer({ origin: "IQQ", destination: "SCL", departureDate: "2026-09-15", departureAt: "2026-09-15T12:00:00Z" })
    ], preferences, new Date("2026-09-01T12:00:00Z"));
    expect(pairs).toHaveLength(0);
  });
});
