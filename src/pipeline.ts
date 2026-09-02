import type { RadarConfig } from "./config.js";
import { addDays, chooseDiscoveryDates, chooseRotatingDates, daysRemainingInMonth, horizonDates, isoDate, monthStart } from "./date-utils.js";
import { assessDeals } from "./deals.js";
import type { DealAssessment, FlightOffer, FlightSource, SourceHealth, TripPair } from "./domain.js";
import { Logger } from "./logger.js";
import { formatDealAlert, formatDigest, formatTripAlert, type Notifier } from "./notifier.js";
import type { RadarStore } from "./store.js";
import { buildTripPairs } from "./trips.js";
import { scanPromotions } from "./sources/promotions.js";

export interface RunOptions {
  discover: boolean;
  verify: boolean;
  promotions: boolean;
  alerts: boolean;
  digest: boolean;
}

export interface RunSummary {
  discovered: number;
  verified: number;
  promotions: number;
  alerts: number;
  offersInWindow: number;
  trips: number;
}

export class RadarPipeline {
  constructor(private readonly dependencies: {
    config: RadarConfig;
    store: RadarStore;
    amadeus: FlightSource;
    browsers: FlightSource[];
    notifier: Notifier;
    logger: Logger;
    now?: () => Date;
  }) {}

  private now() { return this.dependencies.now?.() ?? new Date(); }

  private async runSource(source: FlightSource, request: Parameters<FlightSource["searchOneWay"]>[0]): Promise<FlightOffer[]> {
    const { store, logger, notifier } = this.dependencies;
    if (!source.isEnabled()) return [];
    const health = await store.getSourceHealth(source.name);
    if (health.circuitOpenUntil && new Date(health.circuitOpenUntil) > this.now()) {
      logger.warn("Source circuit is open", { source: source.name, until: health.circuitOpenUntil });
      return [];
    }
    try {
      const offers = await source.searchOneWay(request);
      await store.saveSourceHealth({
        source: source.name,
        consecutiveFailures: 0,
        circuitOpenUntil: null,
        lastSuccessAt: this.now().toISOString(),
        lastFailureAt: health.lastFailureAt,
        lastError: null
      });
      return offers;
    } catch (error) {
      const failures = health.consecutiveFailures + 1;
      const next: SourceHealth = {
        source: source.name,
        consecutiveFailures: failures,
        circuitOpenUntil: failures >= 3 ? new Date(this.now().getTime() + 86_400_000).toISOString() : null,
        lastSuccessAt: health.lastSuccessAt,
        lastFailureAt: this.now().toISOString(),
        lastError: String(error).slice(0, 1000)
      };
      await store.saveSourceHealth(next);
      logger.error("Source search failed", { source: source.name, error: String(error), failures });
      if (failures === 3) {
        await notifier.send(`⚠️ <b>Fuente degradada</b>\n${source.name} falló tres veces y fue pausada por 24 horas.\n${String(error).slice(0, 500)}`)
          .catch((notifyError) => logger.error("Operational notification failed", { error: String(notifyError) }));
      }
      return [];
    }
  }

  private async discover(dates: string[]): Promise<number> {
    const { config, store, amadeus, logger } = this.dependencies;
    if (!amadeus.isEnabled() || config.AMADEUS_MONTHLY_CAP <= 0) {
      logger.warn("Amadeus discovery disabled; configure credentials and AMADEUS_MONTHLY_CAP");
      return 0;
    }
    const start = isoDate(monthStart(this.now()));
    const used = await store.getMonthlyUsage(amadeus.name, start);
    const hardLimit = Math.floor(config.AMADEUS_MONTHLY_CAP * config.AMADEUS_CAP_SAFETY_PERCENT / 100);
    const remaining = Math.max(0, hardLimit - used);
    const todayBudget = Math.min(
      remaining,
      Math.max(config.preferences.routes.length, Math.ceil(remaining / daysRemainingInMonth(this.now())))
    );
    const perRoute = Math.max(1, Math.ceil(todayBudget / config.preferences.routes.length));
    const selected = chooseDiscoveryDates(dates, perRoute, this.now());
    let saved = 0;
    let attempted = 0;
    for (const route of config.preferences.routes) {
      for (const departureDate of selected) {
        if (attempted >= todayBudget) return saved;
        attempted += 1;
        const offers = await this.runSource(amadeus, { route, departureDate, adults: 1, directOnly: true });
        await store.recordUsage(amadeus.name, 1);
        await store.saveOffers(offers);
        saved += offers.length;
      }
    }
    return saved;
  }

  private async verify(dates: string[]): Promise<number> {
    const { config, store, browsers } = this.dependencies;
    const enabledBrowsers = browsers.filter((source) => source.isEnabled());
    if (enabledBrowsers.length === 0 || config.BROWSER_CHECKS_PER_DAY === 0) return 0;
    const latest = await store.getLatestOffers(dates[0]!, dates.at(-1)!);
    const candidates = new Map<string, string[]>();
    for (const route of config.preferences.routes) {
      const routeOffers = latest.filter((offer) => offer.origin === route.origin && offer.destination === route.destination)
        .sort((a, b) => a.comparablePriceClp - b.comparablePriceClp);
      const top = routeOffers[0]?.departureDate;
      const rotating = chooseRotatingDates(dates, 2, this.now());
      candidates.set(`${route.origin}-${route.destination}`, [...new Set([...(top ? [top] : []), ...rotating])]);
    }
    let checks = 0;
    let saved = 0;
    for (const route of config.preferences.routes) {
      for (const departureDate of candidates.get(`${route.origin}-${route.destination}`) ?? []) {
        for (const browser of enabledBrowsers) {
          if (checks >= config.BROWSER_CHECKS_PER_DAY) return saved;
          checks += 1;
          const offers = await this.runSource(browser, { route, departureDate, adults: 1, directOnly: true });
          await store.saveOffers(offers);
          saved += offers.length;
        }
      }
    }
    return saved;
  }

  private async notifyDeals(deals: DealAssessment[], trips: TripPair[]): Promise<number> {
    const { store, notifier, logger } = this.dependencies;
    let sent = 0;
    const shouldSend = async (key: string, priceClp: number) => {
      const previous = await store.getAlert(key);
      if (!previous) return true;
      const elapsed = this.now().getTime() - new Date(previous.lastSentAt).getTime();
      return elapsed >= 86_400_000 || priceClp <= previous.priceClp * 0.95;
    };
    for (const deal of deals.filter((item) => item.recommended).slice(0, 5)) {
      if (!(await shouldSend(deal.key, deal.offer.comparablePriceClp))) continue;
      const payload = formatDealAlert(deal);
      await notifier.send(payload);
      await store.saveAlert({ key: deal.key, lastSentAt: this.now().toISOString(), priceClp: deal.offer.comparablePriceClp, payload });
      sent += 1;
    }
    const recommendedDates = new Set(deals.filter((deal) => deal.recommended).map((deal) => `${deal.offer.origin}:${deal.offer.departureDate}`));
    for (const trip of trips.filter((item) => item.allVerified).filter((item) =>
      recommendedDates.has(`${item.outbound.origin}:${item.outbound.departureDate}`) ||
      recommendedDates.has(`${item.inbound.origin}:${item.inbound.departureDate}`)
    ).slice(0, 3)) {
      if (!(await shouldSend(trip.key, trip.totalComparableClp))) continue;
      const payload = formatTripAlert(trip);
      await notifier.send(payload);
      await store.saveAlert({ key: trip.key, lastSentAt: this.now().toISOString(), priceClp: trip.totalComparableClp, payload });
      sent += 1;
    }
    logger.info("Deal notification pass complete", { sent });
    return sent;
  }

  async run(mode: string, options: RunOptions): Promise<RunSummary> {
    const { config, store, logger, notifier, browsers } = this.dependencies;
    const runId = await store.startRun(mode);
    const summary: RunSummary = { discovered: 0, verified: 0, promotions: 0, alerts: 0, offersInWindow: 0, trips: 0 };
    try {
      const dates = horizonDates(this.now(), config.preferences.horizonDays);
      if (options.discover) summary.discovered = await this.discover(dates);
      if (options.verify) summary.verified = await this.verify(dates);
      if (options.promotions && config.promotionUrls.length > 0) {
        const profileTokens = [...config.preferences.bankProducts, config.preferences.latamPassTier, ...(config.preferences.latamPassClub ? ["Club LATAM Pass"] : [])];
        for (const source of config.promotionUrls) {
          try {
            const found = await scanPromotions([source], profileTokens);
            await store.savePromotions(found);
            summary.promotions += found.length;
          } catch (error) {
            logger.warn("Promotion scan failed", { url: source.url, error: String(error) });
          }
        }
      }

      const latest = await store.getLatestOffers(dates[0]!, dates.at(-1)!);
      const historySince = addDays(this.now(), -400).toISOString();
      const history = await store.getOfferHistory(historySince);
      const deals = assessDeals(latest, history, config.preferences);
      const trips = buildTripPairs(latest, config.preferences, this.now());
      summary.offersInWindow = latest.length;
      summary.trips = trips.length;
      if (options.alerts) summary.alerts = await this.notifyDeals(deals, trips);
      if (options.digest) {
        const promotions = await store.getRecentPromotions(addDays(this.now(), -7).toISOString());
        const health = await Promise.all([this.dependencies.amadeus, ...browsers]
          .filter((source) => source.isEnabled())
          .map((source) => store.getSourceHealth(source.name)));
        await notifier.send(formatDigest({ deals, trips, promotions, health }));
      }
      await store.prune(addDays(this.now(), -400).toISOString());
      await store.finishRun(runId, "success", summary as unknown as Record<string, unknown>);
      logger.info("Radar run complete", { mode, ...summary });
      return summary;
    } catch (error) {
      await store.finishRun(runId, "failed", { error: String(error), ...summary });
      logger.error("Radar run failed", { mode, error: String(error) });
      throw error;
    } finally {
      await Promise.allSettled([this.dependencies.amadeus, ...browsers].map((source) => source.close?.()));
    }
  }
}
