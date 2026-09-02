import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfiguredBrowserSource } from "./browser.js";

describe.skipIf(process.env.RUN_BROWSER_TESTS !== "true")("configured browser source", () => {
  it("extracts and normalizes an anonymous public fare page", async () => {
    const source = new ConfiguredBrowserSource({
      name: "fixture-browser",
      carrier: "LA",
      urlTemplate: pathToFileURL(resolve("src/test-fixtures/flight.html")).href + "?origin={origin}&destination={destination}&date={date}",
      priceSelector: ".price",
      flightNumberSelector: ".flight-number",
      departureTimeSelector: ".departure",
      arrivalTimeSelector: ".arrival",
      fareFamilySelector: ".fare",
      cabinBagIncluded: true,
      waitForSelector: ".flight-card"
    }, "screenshots");
    try {
      const offers = await source.searchOneWay({
        route: { origin: "SCL", destination: "IQQ" },
        departureDate: "2026-09-10",
        adults: 1,
        directOnly: true
      });
      expect(offers).toHaveLength(1);
      expect(offers[0]).toMatchObject({
        carrier: "LA",
        flightNumber: "LA123",
        fareFamily: "LIGHT",
        comparablePriceClp: 34_990,
        verification: "verified"
      });
      expect(new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Santiago" })
        .format(new Date(offers[0]!.departureAt))).toBe("19:10");
    } finally {
      await source.close();
    }
  }, 20_000);
});
