import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { buildDashboardSnapshot, dashboardSnapshotSchema } from "./dashboard.js";
import { offer } from "./test-helpers.js";

describe("dashboard snapshot", () => {
  it("publishes only the selected public fare fields and valid official URLs", () => {
    const preferences = loadConfig({ HORIZON_DAYS: "60" }).preferences;
    const outbound = offer({
      departureDate: "2026-09-10",
      capturedAt: "2026-09-02T10:00:00.000Z",
      purchaseUrl: "https://www.latamairlines.com/cl/es?from=SCL&to=IQQ"
    });
    const inbound = offer({
      origin: "IQQ",
      destination: "SCL",
      departureDate: "2026-09-12",
      departureAt: "2026-09-12T12:00:00.000Z",
      arrivalAt: "2026-09-12T14:15:00.000Z",
      capturedAt: "2026-09-02T10:30:00.000Z",
      purchaseUrl: "https://untrusted.example/checkout"
    });
    const snapshot = buildDashboardSnapshot({
      latest: [outbound, inbound],
      history: [outbound, inbound],
      preferences,
      generatedAt: new Date("2026-09-02T12:00:00.000Z"),
      horizonStart: "2026-09-03",
      horizonEnd: "2026-11-01"
    });

    expect(dashboardSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(snapshot.offers).toHaveLength(2);
    expect(snapshot.offers[0]?.purchaseUrl).toContain("latamairlines.com");
    expect(snapshot.offers[1]?.purchaseUrl).toBeUndefined();
    expect(snapshot.trips[0]).toMatchObject({ nights: 2, totalComparableClp: 60_000, allVerified: true });
    expect(JSON.stringify(snapshot)).not.toMatch(/bankProducts|latamPass|rawFingerprint|lastError|api_usage/i);
  });

  it("emits a valid empty snapshot", () => {
    const preferences = loadConfig({ HORIZON_DAYS: "60" }).preferences;
    const snapshot = buildDashboardSnapshot({
      latest: [],
      history: [],
      preferences,
      generatedAt: new Date("2026-09-02T12:00:00.000Z"),
      horizonStart: "2026-09-03",
      horizonEnd: "2026-11-01"
    });

    expect(snapshot.latestCapturedAt).toBeNull();
    expect(snapshot.offers).toEqual([]);
    expect(snapshot.trips).toEqual([]);
  });
});
