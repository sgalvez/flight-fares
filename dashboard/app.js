const state = { snapshot: null };
const $ = (selector) => document.querySelector(selector);
const currency = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const dateFormat = new Intl.DateTimeFormat("es-CL", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
const dateTimeFormat = new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago" });
const timeFormat = new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Santiago" });
const carrierNames = { LA: "LATAM", H2: "SKY", JA: "JetSMART" };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function routeLabel(offer) { return `${offer.origin} → ${offer.destination}`; }
function dateLabel(value) { return dateFormat.format(new Date(`${value}T12:00:00.000Z`)); }
function carrierLabel(code) { return carrierNames[code] || code; }
function isOld(value, hours = 24) { return Date.now() - new Date(value).getTime() > hours * 3_600_000; }

function badge(offer) {
  if (isOld(offer.capturedAt)) return element("span", "badge stale", "Desactualizado");
  const labels = { signal: "Señal", good: "Buena", exceptional: "Excepcional" };
  return element("span", `badge ${offer.tier}`, labels[offer.tier] || "Señal");
}

function purchaseLink(url, label = "Revisar tarifa →") {
  if (!url) return null;
  const link = element("a", "action", label);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function renderStatus(snapshot) {
  const generated = new Date(snapshot.generatedAt);
  $("#updated-at").textContent = dateTimeFormat.format(generated);
  $("#horizon").textContent = `${dateLabel(snapshot.horizon.start)} – ${dateLabel(snapshot.horizon.end)}`;
  const stale = isOld(snapshot.generatedAt, 12);
  $("#status-dot").classList.toggle("stale", stale);
  if (stale) {
    $("#notice").hidden = false;
    $("#notice").textContent = "La última publicación tiene más de 12 horas. Revisa el estado del workflow antes de tomar una decisión.";
  }
}

function renderBest(snapshot) {
  const container = $("#best-routes");
  container.replaceChildren();
  for (const route of ["SCL-IQQ", "IQQ-SCL"]) {
    const best = snapshot.offers.filter((offer) => `${offer.origin}-${offer.destination}` === route)
      .sort((a, b) => a.comparablePriceClp - b.comparablePriceClp)[0];
    const card = element("article", "route-card");
    const top = element("div", "route-card__top");
    top.append(element("span", "route", route.replace("-", " → ")));
    if (best) top.append(badge(best));
    card.append(top);
    if (!best) {
      card.append(element("p", "meta", "Sin precios disponibles todavía."));
    } else {
      card.append(element("p", "price", currency.format(best.comparablePriceClp)));
      card.append(element("p", "meta", `${dateLabel(best.departureDate)} · ${carrierLabel(best.carrier)} ${best.flightNumber} · ${timeFormat.format(new Date(best.departureAt))}`));
      const link = purchaseLink(best.purchaseUrl);
      if (link) card.append(link);
    }
    container.append(card);
  }
}

function renderTrips(snapshot) {
  const container = $("#trips");
  container.replaceChildren();
  if (!snapshot.trips.length) {
    container.append(element("p", "empty", "Aún no hay pares completos de 2–4 noches."));
    return;
  }
  for (const trip of snapshot.trips.slice(0, 12)) {
    const card = element("article", "trip-card");
    const top = element("div", "trip-card__top");
    top.append(element("strong", "route", `${trip.nights} noches`));
    top.append(element("span", `badge ${trip.allVerified ? "good" : ""}`, trip.allVerified ? "Verificado" : "Estimado"));
    card.append(top, element("p", "price", currency.format(trip.totalComparableClp)));
    const legs = element("div", "legs");
    for (const leg of [trip.outbound, trip.inbound]) {
      const row = element("div", "leg");
      row.append(element("span", "", `${leg.origin}→${leg.destination} · ${dateLabel(leg.departureDate)}`));
      row.append(element("strong", "", currency.format(leg.comparablePriceClp)));
      legs.append(row);
    }
    card.append(legs);
    const link = purchaseLink(trip.outbound.purchaseUrl, "Revisar ida →");
    if (link) card.append(link);
    container.append(card);
  }
}

function renderOffers() {
  const route = $("#route-filter").value;
  const latamOnly = $("#latam-filter").checked;
  const verifiedOnly = $("#verified-filter").checked;
  const offers = state.snapshot.offers.filter((offer) =>
    (route === "all" || `${offer.origin}-${offer.destination}` === route) &&
    (!latamOnly || offer.carrier === "LA") &&
    (!verifiedOnly || offer.verification === "verified")
  );
  const body = $("#offers");
  body.replaceChildren();
  for (const offer of offers) {
    const row = document.createElement("tr");
    row.append(element("td", "", dateLabel(offer.departureDate)));
    row.append(element("td", "", routeLabel(offer)));
    row.append(element("td", "", `${carrierLabel(offer.carrier)} ${offer.flightNumber}`));
    row.append(element("td", "", `${timeFormat.format(new Date(offer.departureAt))}–${timeFormat.format(new Date(offer.arrivalAt))}`));
    const signal = document.createElement("td");
    signal.append(badge(offer));
    row.append(signal, element("td", "price-cell", currency.format(offer.comparablePriceClp)));
    const action = document.createElement("td");
    const link = purchaseLink(offer.purchaseUrl, "Abrir");
    if (link) action.append(link);
    row.append(action);
    body.append(row);
  }
  $("#offers-empty").hidden = offers.length !== 0;
  $(".table-wrap").hidden = offers.length === 0;
}

async function load() {
  try {
    const response = await fetch("./data/latest.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const snapshot = await response.json();
    if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.offers) || !Array.isArray(snapshot.trips)) throw new Error("Formato incompatible");
    state.snapshot = snapshot;
    renderStatus(snapshot);
    renderBest(snapshot);
    renderTrips(snapshot);
    renderOffers();
  } catch (error) {
    $("#status-dot").classList.add("error");
    $("#updated-at").textContent = "No disponible";
    $("#notice").hidden = false;
    $("#notice").textContent = "No fue posible cargar las tarifas publicadas. Intenta nuevamente en unos minutos.";
    $("#best-routes").append(element("p", "empty", "Sin datos para mostrar."));
    console.error("Dashboard load failed", error);
  }
}

for (const selector of ["#route-filter", "#latam-filter", "#verified-filter"]) {
  $(selector).addEventListener("change", () => state.snapshot && renderOffers());
}
load();
