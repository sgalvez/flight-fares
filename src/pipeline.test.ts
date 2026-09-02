import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import type { FlightSource, SearchRequest } from "./domain.js";
import { Logger } from "./logger.js";
import type { Notifier } from "./notifier.js";
import { RadarPipeline } from "./pipeline.js";
import { MemoryStore } from "./store.js";
import { offer } from "./test-helpers.js";

class FakeSource implements FlightSource {
  readonly name = "amadeus";
  readonly kind = "fixture" as const;
  calls: SearchRequest[] = [];
  isEnabled() { return true; }
  async searchOneWay(request: SearchRequest) {
    this.calls.push(request);
    return [offer({
      origin: request.route.origin,
      destination: request.route.destination,
      departureDate: request.departureDate,
      departureAt: `${request.departureDate}T12:00:00Z`,
      verification: "estimated"
    })];
  }
}

class CaptureNotifier implements Notifier {
  messages: string[] = [];
  async send(message: string) { this.messages.push(message); }
}

class FailingSource extends FakeSource {
  override async searchOneWay(request: SearchRequest): Promise<never> {
    this.calls.push(request);
    throw new Error("fixture provider unavailable");
  }
}

describe("radar pipeline", () => {
  it("honours the configured monthly API safety cap", async () => {
    const config = loadConfig({
      AMADEUS_API_KEY: "key", AMADEUS_API_SECRET: "secret", AMADEUS_MONTHLY_CAP: "10",
      AMADEUS_CAP_SAFETY_PERCENT: "80", HORIZON_DAYS: "60"
    });
    const source = new FakeSource();
    const store = new MemoryStore();
    const notifier = new CaptureNotifier();
    const pipeline = new RadarPipeline({
      config, store, amadeus: source, browsers: [], notifier, logger: new Logger("error"),
      now: () => new Date("2026-09-01T12:00:00Z")
    });
    await pipeline.run("discover", { discover: true, verify: false, promotions: false, alerts: false, digest: false });
    expect(source.calls.length).toBeGreaterThan(0);
    expect(source.calls.length).toBeLessThanOrEqual(8);
    expect(await store.getMonthlyUsage("amadeus", "2026-09-01")).toBe(source.calls.length);
  });

  it("produces a daily digest even when no sources are configured", async () => {
    const config = loadConfig({});
    const source = new FakeSource();
    const notifier = new CaptureNotifier();
    const pipeline = new RadarPipeline({
      config, store: new MemoryStore(), amadeus: source, browsers: [], notifier, logger: new Logger("error"),
      now: () => new Date("2026-09-01T12:00:00Z")
    });
    await pipeline.run("digest", { discover: false, verify: false, promotions: false, alerts: false, digest: true });
    expect(notifier.messages[0]).toContain("Resumen diario");
  });

  it("opens a 24-hour source circuit after three consecutive failures", async () => {
    const config = loadConfig({
      AMADEUS_API_KEY: "key", AMADEUS_API_SECRET: "secret", AMADEUS_MONTHLY_CAP: "100",
      AMADEUS_CAP_SAFETY_PERCENT: "80", HORIZON_DAYS: "2"
    });
    const source = new FailingSource();
    const store = new MemoryStore();
    const notifier = new CaptureNotifier();
    const now = new Date("2026-09-01T12:00:00Z");
    const pipeline = new RadarPipeline({ config, store, amadeus: source, browsers: [], notifier, logger: new Logger("error"), now: () => now });
    await pipeline.run("discover", { discover: true, verify: false, promotions: false, alerts: false, digest: false });
    await pipeline.run("discover", { discover: true, verify: false, promotions: false, alerts: false, digest: false });
    const health = await store.getSourceHealth("amadeus");
    expect(health.consecutiveFailures).toBe(3);
    expect(health.circuitOpenUntil).toBe("2026-09-02T12:00:00.000Z");
    expect(notifier.messages.some((message) => message.includes("Fuente degradada"))).toBe(true);
  });
});
