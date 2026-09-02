CREATE TABLE IF NOT EXISTS search_runs (
  id text PRIMARY KEY,
  mode text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS offers (
  id serial PRIMARY KEY,
  source text NOT NULL,
  source_kind text NOT NULL,
  origin text NOT NULL,
  destination text NOT NULL,
  departure_date text NOT NULL,
  departure_at timestamptz NOT NULL,
  arrival_at timestamptz NOT NULL,
  carrier text NOT NULL,
  operating_carrier text NOT NULL,
  flight_number text NOT NULL,
  fare_family text NOT NULL,
  currency text NOT NULL CHECK (currency = 'CLP'),
  base_price_clp integer NOT NULL CHECK (base_price_clp >= 0),
  taxes_clp integer NOT NULL CHECK (taxes_clp >= 0),
  mandatory_fees_clp integer NOT NULL CHECK (mandatory_fees_clp >= 0),
  baggage jsonb NOT NULL,
  confirmed_discount_clp integer NOT NULL CHECK (confirmed_discount_clp >= 0),
  potential_discount_label text,
  comparable_price_clp integer NOT NULL CHECK (comparable_price_clp >= 0),
  verification text NOT NULL,
  purchase_url text NOT NULL,
  captured_at timestamptz NOT NULL,
  expires_at timestamptz,
  raw_fingerprint text NOT NULL,
  UNIQUE(source, raw_fingerprint, captured_at)
);
CREATE INDEX IF NOT EXISTS offers_latest_idx ON offers(origin, destination, departure_date, captured_at DESC);
CREATE INDEX IF NOT EXISTS offers_history_idx ON offers(captured_at, carrier);

CREATE TABLE IF NOT EXISTS api_usage (
  id serial PRIMARY KEY,
  source text NOT NULL,
  count integer NOT NULL CHECK (count > 0),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_usage_month_idx ON api_usage(source, recorded_at);

CREATE TABLE IF NOT EXISTS alerts (
  key text PRIMARY KEY,
  last_sent_at timestamptz NOT NULL,
  price_clp integer NOT NULL,
  payload text NOT NULL
);

CREATE TABLE IF NOT EXISTS source_health (
  source text PRIMARY KEY,
  consecutive_failures integer NOT NULL DEFAULT 0,
  circuit_open_until timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text
);

CREATE TABLE IF NOT EXISTS promotions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_url text NOT NULL,
  title text NOT NULL,
  matched_benefits jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  fingerprint text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS preferences (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  sensitive boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
