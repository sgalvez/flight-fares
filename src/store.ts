import type { FlightOffer, PromotionObservation, SourceHealth } from "./domain.js";

export interface AlertRecord {
  key: string;
  lastSentAt: string;
  priceClp: number;
  payload: string;
}

export interface RadarStore {
  init(): Promise<void>;
  close(): Promise<void>;
  startRun(mode: string): Promise<string>;
  finishRun(id: string, status: "success" | "failed", summary: Record<string, unknown>): Promise<void>;
  saveOffers(offers: FlightOffer[]): Promise<void>;
  getLatestOffers(startDate: string, endDate: string): Promise<FlightOffer[]>;
  getOfferHistory(since: string): Promise<FlightOffer[]>;
  getMonthlyUsage(source: string, monthStart: string): Promise<number>;
  recordUsage(source: string, count: number): Promise<void>;
  getAlert(key: string): Promise<AlertRecord | null>;
  saveAlert(alert: AlertRecord): Promise<void>;
  getSourceHealth(source: string): Promise<SourceHealth>;
  saveSourceHealth(health: SourceHealth): Promise<void>;
  savePromotions(promotions: PromotionObservation[]): Promise<void>;
  getRecentPromotions(since: string): Promise<PromotionObservation[]>;
  prune(before: string): Promise<void>;
}

export class MemoryStore implements RadarStore {
  readonly offers: FlightOffer[] = [];
  readonly alerts = new Map<string, AlertRecord>();
  readonly health = new Map<string, SourceHealth>();
  readonly usage: Array<{ source: string; at: string; count: number }> = [];
  readonly promotions: PromotionObservation[] = [];

  async init() {}
  async close() {}
  async startRun() { return crypto.randomUUID(); }
  async finishRun() {}
  async saveOffers(offers: FlightOffer[]) { this.offers.push(...structuredClone(offers)); }
  async getLatestOffers(startDate: string, endDate: string) {
    const matching = this.offers.filter((offer) => offer.departureDate >= startDate && offer.departureDate <= endDate);
    const latest = new Map<string, FlightOffer>();
    for (const offer of matching) {
      const key = [offer.origin, offer.destination, offer.departureDate, offer.carrier, offer.flightNumber, offer.fareFamily].join(":");
      const current = latest.get(key);
      if (!current || current.capturedAt < offer.capturedAt) latest.set(key, offer);
    }
    return structuredClone([...latest.values()]);
  }
  async getOfferHistory(since: string) { return structuredClone(this.offers.filter((offer) => offer.capturedAt >= since)); }
  async getMonthlyUsage(source: string, start: string) {
    return this.usage.filter((item) => item.source === source && item.at >= start).reduce((sum, item) => sum + item.count, 0);
  }
  async recordUsage(source: string, count: number) { this.usage.push({ source, count, at: new Date().toISOString() }); }
  async getAlert(key: string) { return structuredClone(this.alerts.get(key) ?? null); }
  async saveAlert(alert: AlertRecord) { this.alerts.set(alert.key, structuredClone(alert)); }
  async getSourceHealth(source: string) {
    return structuredClone(this.health.get(source) ?? {
      source, consecutiveFailures: 0, circuitOpenUntil: null, lastSuccessAt: null, lastFailureAt: null, lastError: null
    });
  }
  async saveSourceHealth(health: SourceHealth) { this.health.set(health.source, structuredClone(health)); }
  async savePromotions(promotions: PromotionObservation[]) {
    for (const promotion of promotions) {
      const index = this.promotions.findIndex((item) => item.fingerprint === promotion.fingerprint);
      if (index >= 0) this.promotions[index] = structuredClone(promotion);
      else this.promotions.push(structuredClone(promotion));
    }
  }
  async getRecentPromotions(since: string) { return structuredClone(this.promotions.filter((promotion) => promotion.observedAt >= since)); }
  async prune(before: string) {
    const kept = this.offers.filter((offer) => offer.capturedAt >= before);
    this.offers.splice(0, this.offers.length, ...kept);
  }
}
