import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BaggageAllowance, FlightOffer, PromotionObservation, SourceHealth } from "../domain.js";
import type { AlertRecord, RadarStore } from "../store.js";

type SqliteRow = Record<string, unknown>;

function asIso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function mapOffer(row: SqliteRow): FlightOffer {
  return {
    id: Number(row.id),
    source: String(row.source),
    sourceKind: row.source_kind as FlightOffer["sourceKind"],
    origin: row.origin as FlightOffer["origin"],
    destination: row.destination as FlightOffer["destination"],
    departureDate: String(row.departure_date),
    departureAt: asIso(row.departure_at),
    arrivalAt: asIso(row.arrival_at),
    carrier: String(row.carrier),
    operatingCarrier: String(row.operating_carrier),
    flightNumber: String(row.flight_number),
    fareFamily: row.fare_family as FlightOffer["fareFamily"],
    currency: "CLP",
    basePriceClp: Number(row.base_price_clp),
    taxesClp: Number(row.taxes_clp),
    mandatoryFeesClp: Number(row.mandatory_fees_clp),
    baggage: JSON.parse(String(row.baggage)) as BaggageAllowance,
    confirmedDiscountClp: Number(row.confirmed_discount_clp),
    ...(row.potential_discount_label ? { potentialDiscountLabel: String(row.potential_discount_label) } : {}),
    comparablePriceClp: Number(row.comparable_price_clp),
    verification: row.verification as FlightOffer["verification"],
    purchaseUrl: String(row.purchase_url),
    capturedAt: asIso(row.captured_at),
    ...(row.expires_at ? { expiresAt: asIso(row.expires_at) } : {}),
    rawFingerprint: String(row.raw_fingerprint)
  };
}

const schema = `
CREATE TABLE IF NOT EXISTS search_runs (
  id TEXT PRIMARY KEY, mode TEXT NOT NULL, status TEXT NOT NULL,
  started_at TEXT NOT NULL, finished_at TEXT, summary TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL, source_kind TEXT NOT NULL, origin TEXT NOT NULL, destination TEXT NOT NULL,
  departure_date TEXT NOT NULL, departure_at TEXT NOT NULL, arrival_at TEXT NOT NULL,
  carrier TEXT NOT NULL, operating_carrier TEXT NOT NULL, flight_number TEXT NOT NULL,
  fare_family TEXT NOT NULL, currency TEXT NOT NULL CHECK(currency='CLP'),
  base_price_clp INTEGER NOT NULL CHECK(base_price_clp>=0), taxes_clp INTEGER NOT NULL CHECK(taxes_clp>=0),
  mandatory_fees_clp INTEGER NOT NULL CHECK(mandatory_fees_clp>=0), baggage TEXT NOT NULL,
  confirmed_discount_clp INTEGER NOT NULL CHECK(confirmed_discount_clp>=0), potential_discount_label TEXT,
  comparable_price_clp INTEGER NOT NULL CHECK(comparable_price_clp>=0), verification TEXT NOT NULL,
  purchase_url TEXT NOT NULL, captured_at TEXT NOT NULL, expires_at TEXT, raw_fingerprint TEXT NOT NULL,
  UNIQUE(source, raw_fingerprint, captured_at)
);
CREATE INDEX IF NOT EXISTS offers_latest_idx ON offers(origin,destination,departure_date,captured_at DESC);
CREATE INDEX IF NOT EXISTS offers_history_idx ON offers(captured_at,carrier);
CREATE TABLE IF NOT EXISTS api_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, count INTEGER NOT NULL CHECK(count>0), recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS api_usage_month_idx ON api_usage(source,recorded_at);
CREATE TABLE IF NOT EXISTS alerts (
  key TEXT PRIMARY KEY, last_sent_at TEXT NOT NULL, price_clp INTEGER NOT NULL, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source_health (
  source TEXT PRIMARY KEY, consecutive_failures INTEGER NOT NULL DEFAULT 0, circuit_open_until TEXT,
  last_success_at TEXT, last_failure_at TEXT, last_error TEXT
);
CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source_url TEXT NOT NULL, title TEXT NOT NULL,
  matched_benefits TEXT NOT NULL, observed_at TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS preferences (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, sensitive INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
`;

export class SqliteStore implements RadarStore {
  private readonly database: DatabaseSync;

  constructor(private readonly path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
  }

  async init() {
    this.database.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
    this.database.exec(schema);
  }

  async close() { this.database.close(); }

  async startRun(mode: string) {
    const id = crypto.randomUUID();
    this.database.prepare("INSERT INTO search_runs(id,mode,status,started_at) VALUES(?,?,?,?)")
      .run(id, mode, "running", new Date().toISOString());
    return id;
  }

  async finishRun(id: string, status: "success" | "failed", summary: Record<string, unknown>) {
    this.database.prepare("UPDATE search_runs SET status=?,finished_at=?,summary=? WHERE id=?")
      .run(status, new Date().toISOString(), JSON.stringify(summary), id);
  }

  async saveOffers(input: FlightOffer[]) {
    if (input.length === 0) return;
    const statement = this.database.prepare(`INSERT OR IGNORE INTO offers (
      source,source_kind,origin,destination,departure_date,departure_at,arrival_at,carrier,operating_carrier,
      flight_number,fare_family,currency,base_price_clp,taxes_clp,mandatory_fees_clp,baggage,
      confirmed_discount_clp,potential_discount_label,comparable_price_clp,verification,purchase_url,
      captured_at,expires_at,raw_fingerprint
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const offer of input) {
        statement.run(
          offer.source, offer.sourceKind, offer.origin, offer.destination, offer.departureDate,
          offer.departureAt, offer.arrivalAt, offer.carrier, offer.operatingCarrier, offer.flightNumber,
          offer.fareFamily, offer.currency, offer.basePriceClp, offer.taxesClp, offer.mandatoryFeesClp,
          JSON.stringify(offer.baggage), offer.confirmedDiscountClp, offer.potentialDiscountLabel ?? null,
          offer.comparablePriceClp, offer.verification, offer.purchaseUrl, offer.capturedAt,
          offer.expiresAt ?? null, offer.rawFingerprint
        );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async getLatestOffers(startDate: string, endDate: string) {
    const rows = this.database.prepare(`SELECT * FROM (
      SELECT offers.*, ROW_NUMBER() OVER (
        PARTITION BY origin,destination,departure_date,carrier,flight_number,fare_family
        ORDER BY captured_at DESC
      ) AS row_number FROM offers WHERE departure_date BETWEEN ? AND ?
    ) WHERE row_number=1`).all(startDate, endDate) as SqliteRow[];
    return rows.map(mapOffer);
  }

  async getOfferHistory(since: string) {
    return (this.database.prepare("SELECT * FROM offers WHERE captured_at>=? ORDER BY captured_at").all(since) as SqliteRow[]).map(mapOffer);
  }

  async getMonthlyUsage(source: string, monthStart: string) {
    const row = this.database.prepare("SELECT COALESCE(sum(count),0) AS total FROM api_usage WHERE source=? AND recorded_at>=?")
      .get(source, monthStart) as SqliteRow;
    return Number(row.total);
  }

  async recordUsage(source: string, count: number) {
    if (count > 0) this.database.prepare("INSERT INTO api_usage(source,count,recorded_at) VALUES(?,?,?)")
      .run(source, count, new Date().toISOString());
  }

  async getAlert(key: string): Promise<AlertRecord | null> {
    const row = this.database.prepare("SELECT * FROM alerts WHERE key=?").get(key) as SqliteRow | undefined;
    return row ? { key: String(row.key), lastSentAt: asIso(row.last_sent_at), priceClp: Number(row.price_clp), payload: String(row.payload) } : null;
  }

  async saveAlert(alert: AlertRecord) {
    this.database.prepare(`INSERT INTO alerts(key,last_sent_at,price_clp,payload) VALUES(?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET last_sent_at=excluded.last_sent_at,price_clp=excluded.price_clp,payload=excluded.payload`)
      .run(alert.key, alert.lastSentAt, alert.priceClp, alert.payload);
  }

  async getSourceHealth(source: string): Promise<SourceHealth> {
    const row = this.database.prepare("SELECT * FROM source_health WHERE source=?").get(source) as SqliteRow | undefined;
    return row ? {
      source: String(row.source), consecutiveFailures: Number(row.consecutive_failures),
      circuitOpenUntil: row.circuit_open_until ? asIso(row.circuit_open_until) : null,
      lastSuccessAt: row.last_success_at ? asIso(row.last_success_at) : null,
      lastFailureAt: row.last_failure_at ? asIso(row.last_failure_at) : null,
      lastError: row.last_error ? String(row.last_error) : null
    } : { source, consecutiveFailures: 0, circuitOpenUntil: null, lastSuccessAt: null, lastFailureAt: null, lastError: null };
  }

  async saveSourceHealth(health: SourceHealth) {
    this.database.prepare(`INSERT INTO source_health(source,consecutive_failures,circuit_open_until,last_success_at,last_failure_at,last_error)
      VALUES(?,?,?,?,?,?) ON CONFLICT(source) DO UPDATE SET consecutive_failures=excluded.consecutive_failures,
      circuit_open_until=excluded.circuit_open_until,last_success_at=excluded.last_success_at,
      last_failure_at=excluded.last_failure_at,last_error=excluded.last_error`)
      .run(health.source, health.consecutiveFailures, health.circuitOpenUntil, health.lastSuccessAt, health.lastFailureAt, health.lastError);
  }

  async savePromotions(input: PromotionObservation[]) {
    const statement = this.database.prepare(`INSERT INTO promotions(source_url,title,matched_benefits,observed_at,fingerprint)
      VALUES(?,?,?,?,?) ON CONFLICT(fingerprint) DO UPDATE SET title=excluded.title,
      matched_benefits=excluded.matched_benefits,observed_at=excluded.observed_at`);
    for (const promotion of input) statement.run(
      promotion.sourceUrl, promotion.title, JSON.stringify(promotion.matchedBenefits), promotion.observedAt, promotion.fingerprint
    );
  }

  async getRecentPromotions(since: string) {
    return (this.database.prepare("SELECT * FROM promotions WHERE observed_at>=? ORDER BY observed_at DESC").all(since) as SqliteRow[])
      .map((row): PromotionObservation => ({
        sourceUrl: String(row.source_url), title: String(row.title),
        matchedBenefits: JSON.parse(String(row.matched_benefits)) as string[],
        observedAt: asIso(row.observed_at), fingerprint: String(row.fingerprint)
      }));
  }

  async prune(before: string) { this.database.prepare("DELETE FROM offers WHERE captured_at<?").run(before); }
}
