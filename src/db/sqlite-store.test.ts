import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { offer } from "../test-helpers.js";
import { SqliteStore } from "./sqlite-store.js";

describe("SqliteStore", () => {
  it("persists the radar state after closing and reopening the database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "flight-radar-sqlite-"));
    const databasePath = join(directory, "radar.sqlite");
    const first = new SqliteStore(databasePath);

    try {
      await first.init();
      await first.saveOffers([
        offer({ capturedAt: "2026-09-01T10:00:00.000Z", comparablePriceClp: 39_000 }),
        offer({ capturedAt: "2026-09-02T10:00:00.000Z", comparablePriceClp: 32_000 })
      ]);
      await first.recordUsage("amadeus", 7);
      await first.saveAlert({
        key: "SCL:IQQ:2026-09-10",
        lastSentAt: "2026-09-02T12:00:00.000Z",
        priceClp: 32_000,
        payload: "LATAM Light"
      });
      await first.saveSourceHealth({
        source: "latam",
        consecutiveFailures: 1,
        circuitOpenUntil: null,
        lastSuccessAt: "2026-09-01T12:00:00.000Z",
        lastFailureAt: "2026-09-02T12:00:00.000Z",
        lastError: "timeout"
      });
      await first.savePromotions([{
        sourceUrl: "https://example.com/promo",
        title: "Descuento LATAM",
        matchedBenefits: ["Santander LATAM Pass"],
        observedAt: "2026-09-02T11:00:00.000Z",
        fingerprint: "promo-1"
      }]);
      await first.close();

      const reopened = new SqliteStore(databasePath);
      try {
        await reopened.init();
        const latest = await reopened.getLatestOffers("2026-09-01", "2026-09-30");

        expect(latest).toHaveLength(1);
        expect(latest[0]?.comparablePriceClp).toBe(32_000);
        expect(await reopened.getOfferHistory("2026-09-01T00:00:00.000Z")).toHaveLength(2);
        expect(await reopened.getMonthlyUsage("amadeus", "2026-09-01T00:00:00.000Z")).toBe(7);
        expect(await reopened.getAlert("SCL:IQQ:2026-09-10")).toMatchObject({ priceClp: 32_000 });
        expect(await reopened.getSourceHealth("latam")).toMatchObject({ consecutiveFailures: 1, lastError: "timeout" });
        expect(await reopened.getRecentPromotions("2026-09-01T00:00:00.000Z")).toMatchObject([
          { fingerprint: "promo-1", matchedBenefits: ["Santander LATAM Pass"] }
        ]);
      } finally {
        await reopened.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
