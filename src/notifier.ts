import type { DealAssessment, PromotionObservation, SourceHealth, TripPair } from "./domain.js";
import { formatClp } from "./pricing.js";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function time(value: string): string {
  return new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Santiago" })
    .format(new Date(value));
}

export interface Notifier {
  send(message: string): Promise<void>;
}

export class ConsoleNotifier implements Notifier {
  async send(message: string) { console.log(message.replace(/<[^>]+>/g, "")); }
}

export class TelegramNotifier implements Notifier {
  constructor(private readonly token: string, private readonly chatId: string) {}

  async send(message: string) {
    for (let offset = 0; offset < message.length; offset += 3900) {
      const chunk = message.slice(offset, offset + 3900);
      const response = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: this.chatId, text: chunk, parse_mode: "HTML", disable_web_page_preview: true }),
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) throw new Error(`Telegram sendMessage failed (${response.status}): ${await response.text()}`);
    }
  }
}

export function formatDealAlert(deal: DealAssessment): string {
  const icon = deal.tier === "exceptional" ? "🔥" : "✈️";
  const offer = deal.offer;
  const reference = deal.medianClp ? `\nReferencia: ${formatClp(deal.medianClp)}` : "";
  return `${icon} <b>${deal.tier === "exceptional" ? "Oferta excepcional" : "Buena oportunidad"}</b>\n\n` +
    `<b>${offer.origin} → ${offer.destination}</b>, ${offer.departureDate}\n` +
    `${escapeHtml(offer.carrier)} ${escapeHtml(offer.flightNumber)} · ${time(offer.departureAt)}–${time(offer.arrivalAt)}\n` +
    `Total comparable: <b>${formatClp(offer.comparablePriceClp)}</b>${reference}\n` +
    `${escapeHtml(deal.reason)} · equipaje de cabina considerado\n` +
    `Verificado: ${escapeHtml(new Date(offer.capturedAt).toLocaleString("es-CL", { timeZone: "America/Santiago" }))}\n` +
    `<a href="${escapeHtml(offer.purchaseUrl)}">Revisar en la fuente</a>\n\n` +
    `Confirma el precio y las condiciones antes de pagar.`;
}

export function formatTripAlert(trip: TripPair): string {
  return `🧳 <b>Viaje conveniente de ${trip.nights} noches</b>\n\n` +
    `${trip.outbound.origin} → ${trip.outbound.destination}: ${trip.outbound.departureDate} · ${formatClp(trip.outbound.comparablePriceClp)}\n` +
    `${trip.inbound.origin} → ${trip.inbound.destination}: ${trip.inbound.departureDate} · ${formatClp(trip.inbound.comparablePriceClp)}\n` +
    `Total comparable: <b>${formatClp(trip.totalComparableClp)}</b>\n` +
    `<a href="${escapeHtml(trip.outbound.purchaseUrl)}">Revisar ida</a> · <a href="${escapeHtml(trip.inbound.purchaseUrl)}">Revisar regreso</a>\n\n` +
    `Ambos tramos fueron observados durante las últimas 24 horas. Confirma antes de pagar.`;
}

export function formatDigest(input: {
  deals: DealAssessment[];
  trips: TripPair[];
  promotions: PromotionObservation[];
  health: SourceHealth[];
}): string {
  const dealLines = input.deals.slice(0, 3).map((deal) =>
    `• ${deal.offer.origin}→${deal.offer.destination} ${deal.offer.departureDate}: ${formatClp(deal.offer.comparablePriceClp)} ${deal.offer.carrier}`
  );
  const tripLines = input.trips.slice(0, 3).map((trip) =>
    `• ${trip.outbound.departureDate}–${trip.inbound.departureDate} (${trip.nights} noches): ${formatClp(trip.totalComparableClp)}`
  );
  const promotionLines = input.promotions.slice(0, 3).map((promotion) =>
    `• <a href="${escapeHtml(promotion.sourceUrl)}">${escapeHtml(promotion.title.slice(0, 140))}</a>`
  );
  const staleThreshold = Date.now() - 30 * 60 * 60 * 1000;
  const degraded = input.health.filter((item) =>
    item.consecutiveFailures > 0 || !item.lastSuccessAt || new Date(item.lastSuccessAt).getTime() < staleThreshold
  ).map((item) => item.consecutiveFailures > 0
    ? `${escapeHtml(item.source)} (${item.consecutiveFailures} fallas)`
    : `${escapeHtml(item.source)} (sin éxito en 30 h)`
  );
  return `📊 <b>Resumen diario SCL ↔ IQQ</b>\n\n` +
    `<b>Mejores tramos</b>\n${dealLines.length ? dealLines.join("\n") : "Sin precios disponibles"}\n\n` +
    `<b>Viajes de 2–4 noches</b>\n${tripLines.length ? tripLines.join("\n") : "Sin pares recientes"}\n\n` +
    `<b>Promociones compatibles</b>\n${promotionLines.length ? promotionLines.join("\n") : "Sin promociones verificables nuevas"}\n\n` +
    `<b>Fuentes</b>: ${input.health.length === 0 ? "sin fuentes configuradas" : degraded.length ? `degradadas: ${degraded.join(", ")}` : "operativas"}\n\n` +
    `Los precios son observaciones, no reservas. Confirma siempre antes de pagar.`;
}
