import { bigint, boolean, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const searchRuns = pgTable("search_runs", {
  id: text("id").primaryKey(),
  mode: text("mode").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  summary: jsonb("summary").notNull().default({})
});

export const offers = pgTable("offers", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  sourceKind: text("source_kind").notNull(),
  origin: text("origin").notNull(),
  destination: text("destination").notNull(),
  departureDate: text("departure_date").notNull(),
  departureAt: timestamp("departure_at", { withTimezone: true }).notNull(),
  arrivalAt: timestamp("arrival_at", { withTimezone: true }).notNull(),
  carrier: text("carrier").notNull(),
  operatingCarrier: text("operating_carrier").notNull(),
  flightNumber: text("flight_number").notNull(),
  fareFamily: text("fare_family").notNull(),
  currency: text("currency").notNull(),
  basePriceClp: integer("base_price_clp").notNull(),
  taxesClp: integer("taxes_clp").notNull(),
  mandatoryFeesClp: integer("mandatory_fees_clp").notNull(),
  baggage: jsonb("baggage").notNull(),
  confirmedDiscountClp: integer("confirmed_discount_clp").notNull(),
  potentialDiscountLabel: text("potential_discount_label"),
  comparablePriceClp: integer("comparable_price_clp").notNull(),
  verification: text("verification").notNull(),
  purchaseUrl: text("purchase_url").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  rawFingerprint: text("raw_fingerprint").notNull()
}, (table) => [
  uniqueIndex("offers_capture_uniq").on(table.source, table.rawFingerprint, table.capturedAt)
]);

export const apiUsage = pgTable("api_usage", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  count: integer("count").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow()
});

export const alerts = pgTable("alerts", {
  key: text("key").primaryKey(),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }).notNull(),
  priceClp: integer("price_clp").notNull(),
  payload: text("payload").notNull()
});

export const sourceHealth = pgTable("source_health", {
  source: text("source").primaryKey(),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  circuitOpenUntil: timestamp("circuit_open_until", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  lastError: text("last_error")
});

export const promotions = pgTable("promotions", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  sourceUrl: text("source_url").notNull(),
  title: text("title").notNull(),
  matchedBenefits: jsonb("matched_benefits").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  fingerprint: text("fingerprint").notNull()
}, (table) => [uniqueIndex("promotions_fingerprint_uniq").on(table.fingerprint)]);

export const preferences = pgTable("preferences", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  sensitive: boolean("sensitive").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});
