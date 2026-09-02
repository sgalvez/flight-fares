import { describe, expect, it } from "vitest";
import type { RadarPreferences } from "./domain.js";
import { assessDeals } from "./deals.js";
import { offer } from "./test-helpers.js";

const preferences: RadarPreferences = {
  routes: [{ origin: "SCL", destination: "IQQ" }, { origin: "IQQ", destination: "SCL" }],
  horizonDays: 60,
  adults: 1,
  cabinBagRequired: true,
  stayNights: [2, 3, 4],
  latamTolerancePercent: 10,
  competitorSavingsPercent: 20,
  bankProducts: [],
  latamPassTier: "LATAM",
  latamPassClub: false
};

describe("deal assessment", () => {
  it("prefers LATAM when it is within the configured tolerance", () => {
    const latest = [
      offer({ carrier: "H2", flightNumber: "H2100", comparablePriceClp: 30_000 }),
      offer({ carrier: "LA", flightNumber: "LA100", comparablePriceClp: 32_000 }),
      offer({ departureDate: "2026-09-11", departureAt: "2026-09-11T12:00:00Z", comparablePriceClp: 60_000 })
    ];
    const result = assessDeals(latest, [], preferences);
    expect(result.find((item) => item.offer.departureDate === "2026-09-10")?.offer.carrier).toBe("LA");
  });

  it("recommends a verified competitor with a material LATAM saving", () => {
    const latest = [
      offer({ carrier: "JA", flightNumber: "JA1", comparablePriceClp: 30_000 }),
      offer({ carrier: "LA", flightNumber: "LA1", comparablePriceClp: 40_000 }),
      offer({ departureDate: "2026-09-11", departureAt: "2026-09-11T12:00:00Z", comparablePriceClp: 60_000 })
    ];
    const result = assessDeals(latest, [], preferences);
    const deal = result.find((item) => item.offer.departureDate === "2026-09-10");
    expect(deal?.offer.carrier).toBe("JA");
    expect(deal?.recommended).toBe(true);
    expect(deal?.reason).toContain("menos que LATAM");
  });

  it("does not urgently recommend an estimated offer", () => {
    const latest = [
      offer({ verification: "estimated", comparablePriceClp: 20_000 }),
      offer({ departureDate: "2026-09-11", departureAt: "2026-09-11T12:00:00Z", comparablePriceClp: 80_000 })
    ];
    expect(assessDeals(latest, [], preferences)[0]?.recommended).toBe(false);
  });

  it("alerts a simultaneous 10 percent and CLP 10,000 price drop", () => {
    const current = offer({ comparablePriceClp: 80_000, capturedAt: "2026-09-02T10:00:00Z" });
    const previous = offer({ comparablePriceClp: 100_000, capturedAt: "2026-09-01T10:00:00Z", rawFingerprint: "previous" });
    const result = assessDeals([current], [previous, current], preferences)[0];
    expect(result?.recommended).toBe(true);
    expect(result?.reason).toContain("20.000 CLP");
  });
});
