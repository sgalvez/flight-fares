import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import type { BrowserSourceConfig } from "../config.js";
import type { FareFamily, FlightOffer, FlightSource, SearchRequest } from "../domain.js";
import { comparablePrice, fingerprint, normalizeFareFamily, parseClp } from "../pricing.js";

function interpolate(template: string, request: SearchRequest): string {
  return template
    .replaceAll("{origin}", encodeURIComponent(request.route.origin))
    .replaceAll("{destination}", encodeURIComponent(request.route.destination))
    .replaceAll("{date}", encodeURIComponent(request.departureDate))
    .replaceAll("{adults}", String(request.adults));
}

function timeIso(date: string, raw: string | null, fallbackHour: number): string {
  const match = raw?.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  const time = match ? `${match[1]!.padStart(2, "0")}:${match[2]}` : `${String(fallbackHour).padStart(2, "0")}:00`;
  const offsetPart = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Santiago",
    timeZoneName: "longOffset"
  }).formatToParts(new Date(`${date}T12:00:00.000Z`)).find((part) => part.type === "timeZoneName")?.value;
  const offset = offsetPart?.match(/GMT([+-]\d{2}:\d{2})/)?.[1] ?? "-03:00";
  return new Date(`${date}T${time}:00${offset}`).toISOString();
}

async function explicitlyDisallowed(targetUrl: string): Promise<boolean> {
  const url = new URL(targetUrl);
  const response = await fetch(`${url.origin}/robots.txt`, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
  if (!response?.ok) return false;
  const lines = (await response.text()).split(/\r?\n/);
  let applies = false;
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (/^user-agent:/i.test(line)) applies = line.split(":", 2)[1]?.trim() === "*";
    if (applies && /^disallow:/i.test(line)) {
      const path = line.slice(line.indexOf(":") + 1).trim();
      if (path === "/" || (path && url.pathname.startsWith(path))) return true;
    }
  }
  return false;
}

export class ConfiguredBrowserSource implements FlightSource {
  readonly kind = "browser" as const;
  readonly name: string;
  readonly carrier: string;
  private browser: Browser | null = null;
  private robotsChecked = false;

  constructor(private readonly source: BrowserSourceConfig, private readonly screenshotDir: string) {
    this.name = source.name;
    this.carrier = source.carrier;
  }

  isEnabled() { return this.source.enabled !== false && Boolean(this.source.urlTemplate && this.source.priceSelector); }

  private async instance() {
    this.browser ??= await chromium.launch({ headless: true });
    return this.browser;
  }

  async searchOneWay(request: SearchRequest): Promise<FlightOffer[]> {
    const url = interpolate(this.source.urlTemplate, request);
    if (!this.robotsChecked) {
      this.robotsChecked = true;
      if (await explicitlyDisallowed(url)) throw new Error(`${this.name} booking path is explicitly disallowed by robots.txt`);
    }
    const browser = await this.instance();
    const context = await browser.newContext({ locale: "es-CL", timezoneId: "America/Santiago" });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      if (this.source.cookieAcceptSelector) {
        await page.locator(this.source.cookieAcceptSelector).first().click({ timeout: 3_000 }).catch(() => undefined);
      }
      await page.waitForTimeout(2_000 + Math.floor(Math.random() * 3_000));
      await page.locator(this.source.waitForSelector ?? this.source.priceSelector).first().waitFor({ state: "visible" });
      const body = (await page.locator("body").innerText()).slice(0, 20_000);
      if (/captcha|no soy un robot|verify you are human|access denied/i.test(body)) {
        throw new Error(`${this.name} presented a CAPTCHA or access challenge`);
      }
      const priceText = await page.locator(this.source.priceSelector).first().innerText();
      const price = parseClp(priceText);
      const flightNumber = this.source.flightNumberSelector
        ? (await page.locator(this.source.flightNumberSelector).first().innerText()).trim()
        : `${this.carrier}-UNKNOWN`;
      const departureText = this.source.departureTimeSelector
        ? await page.locator(this.source.departureTimeSelector).first().innerText()
        : null;
      const arrivalText = this.source.arrivalTimeSelector
        ? await page.locator(this.source.arrivalTimeSelector).first().innerText()
        : null;
      const rawFare = this.source.fareFamilySelector
        ? await page.locator(this.source.fareFamilySelector).first().innerText()
        : undefined;
      const fareFamily: FareFamily = normalizeFareFamily(rawFare);
      const cabinIncluded = this.source.cabinBagIncluded ?? null;
      const cabinFee = cabinIncluded === true ? 0 : this.source.cabinBagFeeClp ?? null;
      const capturedAt = new Date().toISOString();
      const departureAt = timeIso(request.departureDate, departureText, 12);
      let arrivalAt = timeIso(request.departureDate, arrivalText, 14);
      if (arrivalAt <= departureAt) arrivalAt = new Date(new Date(arrivalAt).getTime() + 86_400_000).toISOString();
      return [{
        source: this.name,
        sourceKind: this.kind,
        origin: request.route.origin,
        destination: request.route.destination,
        departureDate: request.departureDate,
        departureAt,
        arrivalAt,
        carrier: this.carrier,
        operatingCarrier: this.carrier,
        flightNumber,
        fareFamily,
        currency: "CLP",
        basePriceClp: price,
        taxesClp: 0,
        mandatoryFeesClp: 0,
        baggage: {
          personalItemIncluded: true,
          cabinBagIncluded: cabinIncluded,
          cabinBagFeeClp: cabinFee,
          checkedBagIncluded: null
        },
        confirmedDiscountClp: 0,
        comparablePriceClp: comparablePrice({
          basePriceClp: price, taxesClp: 0, mandatoryFeesClp: 0, cabinBagRequired: true,
          cabinBagIncluded: cabinIncluded, cabinBagFeeClp: cabinFee, confirmedDiscountClp: 0
        }),
        verification: cabinIncluded !== null || cabinFee !== null ? "verified" : "estimated",
        purchaseUrl: url,
        capturedAt,
        rawFingerprint: fingerprint([this.name, request.route, request.departureDate, flightNumber, fareFamily, price])
      }];
    } catch (error) {
      await mkdir(this.screenshotDir, { recursive: true });
      const safeName = `${this.name}-${request.route.origin}-${request.route.destination}-${request.departureDate}`.replace(/[^a-zA-Z0-9-]/g, "_");
      await page.screenshot({ path: resolve(this.screenshotDir, `${safeName}.png`), fullPage: false }).catch(() => undefined);
      throw error;
    } finally {
      await context.close();
    }
  }

  async close() {
    await this.browser?.close();
    this.browser = null;
  }
}
