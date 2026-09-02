import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadConfig } from "./config.js";
import { addDays, horizonDates } from "./date-utils.js";
import { buildDashboardSnapshot } from "./dashboard.js";
import { PostgresStore } from "./db/postgres-store.js";
import { SqliteStore } from "./db/sqlite-store.js";

const config = loadConfig();
const outputPath = resolve(process.argv[2] ?? "dashboard-output/data/latest.json");
const store = config.DATABASE_URL ? new PostgresStore(config.DATABASE_URL) : new SqliteStore(config.SQLITE_PATH);
const generatedAt = new Date();
const dates = horizonDates(generatedAt, config.preferences.horizonDays);

await store.init();
try {
  const latest = await store.getLatestOffers(dates[0]!, dates.at(-1)!);
  const history = await store.getOfferHistory(addDays(generatedAt, -400).toISOString());
  const snapshot = buildDashboardSnapshot({
    latest,
    history,
    preferences: config.preferences,
    generatedAt,
    horizonStart: dates[0]!,
    horizonEnd: dates.at(-1)!
  });
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
  await rename(temporaryPath, outputPath);
  console.log(`Dashboard snapshot written to ${outputPath} (${snapshot.offers.length} offers, ${snapshot.trips.length} trips)`);
} finally {
  await store.close();
}
