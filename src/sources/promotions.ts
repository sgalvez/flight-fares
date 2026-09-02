import type { PromotionUrlConfig } from "../config.js";
import type { PromotionObservation } from "../domain.js";
import { fingerprint } from "../pricing.js";

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export async function scanPromotions(
  sources: PromotionUrlConfig[],
  profileTokens: string[]
): Promise<PromotionObservation[]> {
  const output: PromotionObservation[] = [];
  for (const source of sources) {
    const response = await fetch(source.url, {
      headers: { "user-agent": "SCL-IQQ personal fare monitor/0.1" },
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) throw new Error(`Promotion page failed (${response.status}): ${source.url}`);
    const html = await response.text();
    const text = visibleText(html).slice(0, 50_000);
    const title = html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]?.replace(/<[^>]+>/g, " ").trim()
      ?? text.slice(0, 120);
    const tokens = [...profileTokens, ...(source.benefitTokens ?? [])].filter(Boolean);
    const matched = tokens.filter((token) => text.toLocaleLowerCase("es-CL").includes(token.toLocaleLowerCase("es-CL")));
    const discountSignals = [...text.matchAll(/(?:hasta\s+)?\d{1,2}%\s+(?:de\s+)?(?:dcto|descuento)/gi)]
      .map((match) => match[0]).slice(0, 5);
    if (matched.length === 0 && discountSignals.length === 0) continue;
    const observedAt = new Date().toISOString();
    output.push({
      sourceUrl: source.url,
      title: `${title}${discountSignals.length ? ` — ${discountSignals.join(", ")}` : ""}`.slice(0, 500),
      matchedBenefits: matched,
      observedAt,
      fingerprint: fingerprint([source.url, title, matched, discountSignals])
    });
  }
  return output;
}
