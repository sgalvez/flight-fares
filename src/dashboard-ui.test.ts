import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";

const snapshot = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  horizon: { start: "2026-09-03", end: "2026-11-01", days: 60 },
  latestCapturedAt: new Date().toISOString(),
  offers: [
    {
      origin: "SCL", destination: "IQQ", departureDate: "2026-09-10",
      departureAt: "2026-09-10T22:10:00.000Z", arrivalAt: "2026-09-11T00:35:00.000Z",
      carrier: "LA", flightNumber: "LA123", fareFamily: "LIGHT", comparablePriceClp: 34_990,
      cabinBagIncluded: true, verification: "verified", capturedAt: new Date().toISOString(),
      tier: "good", referenceClp: 48_500, percentBelowReference: 27.9,
      reason: "28% bajo la referencia", recommended: true,
      purchaseUrl: "https://www.latamairlines.com/cl/es"
    },
    {
      origin: "IQQ", destination: "SCL", departureDate: "2026-09-12",
      departureAt: "2026-09-12T15:00:00.000Z", arrivalAt: "2026-09-12T17:20:00.000Z",
      carrier: "H2", flightNumber: "H2456", fareFamily: "LIGHT", comparablePriceClp: 29_990,
      cabinBagIncluded: false, verification: "estimated", capturedAt: new Date().toISOString(),
      tier: "signal", referenceClp: 36_000, percentBelowReference: 16.7,
      reason: "17% bajo la referencia", recommended: false,
      purchaseUrl: "https://www.skyairline.com/chile"
    }
  ],
  trips: []
};

describe.skipIf(process.env.RUN_BROWSER_TESTS !== "true")("public dashboard", () => {
  it("renders the snapshot and applies public filters", async () => {
    const server = createServer(async (request, response) => {
      const requestPath = request.url ?? "/";
      const path = requestPath === "/" ? "/index.html" : requestPath;
      if (path === "/data/latest.json") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(snapshot));
        return;
      }
      const file = path === "/index.html" || path === "/styles.css" || path === "/app.js"
        ? resolve("dashboard", path.slice(1))
        : null;
      if (!file) { response.statusCode = 404; response.end(); return; }
      response.setHeader("content-type", path.endsWith(".css") ? "text/css" : path.endsWith(".js") ? "text/javascript" : "text/html");
      response.end(await readFile(file));
    });
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", rejectListen);
        resolveListen();
      });
    });
    const port = (server.address() as AddressInfo).port;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.goto(`http://127.0.0.1:${port}/`);
      await expect.poll(() => page.locator("#offers tr").count()).toBe(2);
      expect(await page.locator("#best-routes").innerText()).toContain("$34.990");
      await page.locator("#latam-filter").check();
      await expect.poll(() => page.locator("#offers tr").count()).toBe(1);
      expect(await page.locator("#offers").innerText()).toContain("LATAM LA123");
      expect(await page.locator("body").evaluate((body) => body.scrollWidth <= body.clientWidth)).toBe(true);
    } finally {
      await browser.close();
      await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    }
  }, 20_000);
});
