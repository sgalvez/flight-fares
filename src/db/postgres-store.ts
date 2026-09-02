import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { BaggageAllowance, FlightOffer, PromotionObservation, SourceHealth } from "../domain.js";
import type { AlertRecord, RadarStore } from "../store.js";

const { Pool } = pg;

type OfferRow = Record<string, unknown>;

function dateString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function mapOffer(row: OfferRow): FlightOffer {
  return {
    id: Number(row.id),
    source: String(row.source),
    sourceKind: row.source_kind as FlightOffer["sourceKind"],
    origin: row.origin as FlightOffer["origin"],
    destination: row.destination as FlightOffer["destination"],
    departureDate: String(row.departure_date),
    departureAt: dateString(row.departure_at),
    arrivalAt: dateString(row.arrival_at),
    carrier: String(row.carrier),
    operatingCarrier: String(row.operating_carrier),
    flightNumber: String(row.flight_number),
    fareFamily: row.fare_family as FlightOffer["fareFamily"],
    currency: "CLP",
    basePriceClp: Number(row.base_price_clp),
    taxesClp: Number(row.taxes_clp),
    mandatoryFeesClp: Number(row.mandatory_fees_clp),
    baggage: row.baggage as BaggageAllowance,
    confirmedDiscountClp: Number(row.confirmed_discount_clp),
    ...(row.potential_discount_label ? { potentialDiscountLabel: String(row.potential_discount_label) } : {}),
    comparablePriceClp: Number(row.comparable_price_clp),
    verification: row.verification as FlightOffer["verification"],
    purchaseUrl: String(row.purchase_url),
    capturedAt: dateString(row.captured_at),
    ...(row.expires_at ? { expiresAt: dateString(row.expires_at) } : {}),
    rawFingerprint: String(row.raw_fingerprint)
  };
}

export class PostgresStore implements RadarStore {
  private readonly pool: pg.Pool;
  readonly db;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 15_000 });
    this.db = drizzle(this.pool);
  }

  async init() {
    const sql = await readFile(join(process.cwd(), "src", "db", "migrations", "0001_initial.sql"), "utf8");
    await this.pool.query(sql);
  }

  async close() { await this.pool.end(); }

  async startRun(mode: string) {
    const id = crypto.randomUUID();
    await this.pool.query("INSERT INTO search_runs (id, mode, status) VALUES ($1, $2, 'running')", [id, mode]);
    return id;
  }

  async finishRun(id: string, status: "success" | "failed", summary: Record<string, unknown>) {
    await this.pool.query(
      "UPDATE search_runs SET status=$2, finished_at=now(), summary=$3::jsonb WHERE id=$1",
      [id, status, JSON.stringify(summary)]
    );
  }

  async saveOffers(input: FlightOffer[]) {
    if (input.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const offer of input) {
        await client.query(
          `INSERT INTO offers (
            source, source_kind, origin, destination, departure_date, departure_at, arrival_at,
            carrier, operating_carrier, flight_number, fare_family, currency, base_price_clp,
            taxes_clp, mandatory_fees_clp, baggage, confirmed_discount_clp,
            potential_discount_label, comparable_price_clp, verification, purchase_url,
            captured_at, expires_at, raw_fingerprint
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19,$20,$21,$22,$23,$24
          ) ON CONFLICT (source, raw_fingerprint, captured_at) DO NOTHING`,
          [
            offer.source, offer.sourceKind, offer.origin, offer.destination, offer.departureDate,
            offer.departureAt, offer.arrivalAt, offer.carrier, offer.operatingCarrier,
            offer.flightNumber, offer.fareFamily, offer.currency, offer.basePriceClp, offer.taxesClp,
            offer.mandatoryFeesClp, JSON.stringify(offer.baggage), offer.confirmedDiscountClp,
            offer.potentialDiscountLabel ?? null, offer.comparablePriceClp, offer.verification,
            offer.purchaseUrl, offer.capturedAt, offer.expiresAt ?? null, offer.rawFingerprint
          ]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getLatestOffers(startDate: string, endDate: string) {
    const result = await this.pool.query(
      `SELECT DISTINCT ON (origin,destination,departure_date,carrier,flight_number,fare_family)
         * FROM offers WHERE departure_date BETWEEN $1 AND $2
       ORDER BY origin,destination,departure_date,carrier,flight_number,fare_family,captured_at DESC`,
      [startDate, endDate]
    );
    return result.rows.map(mapOffer);
  }

  async getOfferHistory(since: string) {
    const result = await this.pool.query("SELECT * FROM offers WHERE captured_at >= $1 ORDER BY captured_at", [since]);
    return result.rows.map(mapOffer);
  }

  async getMonthlyUsage(source: string, start: string) {
    const result = await this.pool.query(
      "SELECT COALESCE(sum(count), 0)::int AS total FROM api_usage WHERE source=$1 AND recorded_at >= $2",
      [source, start]
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  async recordUsage(source: string, count: number) {
    if (count > 0) await this.pool.query("INSERT INTO api_usage(source,count) VALUES($1,$2)", [source, count]);
  }

  async getAlert(key: string) {
    const result = await this.pool.query("SELECT * FROM alerts WHERE key=$1", [key]);
    const row = result.rows[0];
    return row ? { key: row.key, lastSentAt: dateString(row.last_sent_at), priceClp: row.price_clp, payload: row.payload } : null;
  }

  async saveAlert(alert: AlertRecord) {
    await this.pool.query(
      `INSERT INTO alerts(key,last_sent_at,price_clp,payload) VALUES($1,$2,$3,$4)
       ON CONFLICT(key) DO UPDATE SET last_sent_at=excluded.last_sent_at, price_clp=excluded.price_clp, payload=excluded.payload`,
      [alert.key, alert.lastSentAt, alert.priceClp, alert.payload]
    );
  }

  async getSourceHealth(source: string): Promise<SourceHealth> {
    const result = await this.pool.query("SELECT * FROM source_health WHERE source=$1", [source]);
    const row = result.rows[0];
    return row ? {
      source: row.source,
      consecutiveFailures: row.consecutive_failures,
      circuitOpenUntil: row.circuit_open_until ? dateString(row.circuit_open_until) : null,
      lastSuccessAt: row.last_success_at ? dateString(row.last_success_at) : null,
      lastFailureAt: row.last_failure_at ? dateString(row.last_failure_at) : null,
      lastError: row.last_error
    } : { source, consecutiveFailures: 0, circuitOpenUntil: null, lastSuccessAt: null, lastFailureAt: null, lastError: null };
  }

  async saveSourceHealth(health: SourceHealth) {
    await this.pool.query(
      `INSERT INTO source_health(source,consecutive_failures,circuit_open_until,last_success_at,last_failure_at,last_error)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(source) DO UPDATE SET
       consecutive_failures=excluded.consecutive_failures,circuit_open_until=excluded.circuit_open_until,
       last_success_at=excluded.last_success_at,last_failure_at=excluded.last_failure_at,last_error=excluded.last_error`,
      [health.source, health.consecutiveFailures, health.circuitOpenUntil, health.lastSuccessAt, health.lastFailureAt, health.lastError]
    );
  }

  async savePromotions(input: PromotionObservation[]) {
    for (const promotion of input) {
      await this.pool.query(
        `INSERT INTO promotions(source_url,title,matched_benefits,observed_at,fingerprint)
         VALUES($1,$2,$3::jsonb,$4,$5) ON CONFLICT(fingerprint) DO UPDATE SET
         title=excluded.title, matched_benefits=excluded.matched_benefits, observed_at=excluded.observed_at`,
        [promotion.sourceUrl, promotion.title, JSON.stringify(promotion.matchedBenefits), promotion.observedAt, promotion.fingerprint]
      );
    }
  }

  async getRecentPromotions(since: string) {
    const result = await this.pool.query("SELECT * FROM promotions WHERE observed_at >= $1 ORDER BY observed_at DESC", [since]);
    return result.rows.map((row) => ({
      sourceUrl: row.source_url,
      title: row.title,
      matchedBenefits: row.matched_benefits as string[],
      observedAt: dateString(row.observed_at),
      fingerprint: row.fingerprint
    }));
  }

  async prune(before: string) {
    await this.pool.query("DELETE FROM offers WHERE captured_at < $1", [before]);
  }
}
