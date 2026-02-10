// /api/assets.js (Vercel / Next.js API Route)
// - Auth por header: X-Auth
// - Cursor/Keyword/AssetTypes
// - Sort dinámico (sortType/sortAgg)
// - SalesTypeFilter por defecto = 0 (incluye offsale -> más resultados)
// - Filtro estricto por AssetTypeId para que Hair=41 SOLO muestre Hair, etc.
// - Cache CDN para reducir 429

export default async function handler(req, res) {
  // CORS (opcional)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Auth");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // Auth
  const auth = req.headers["x-auth"];
  if (!process.env.AUTH_TOKEN || auth !== process.env.AUTH_TOKEN) {
    return res.status(401).send("Unauthorized");
  }

  function normalizeLimit(n) {
    n = Number(n || 30);
    if (n <= 10) return 10;
    if (n <= 28) return 28;
    return 30;
  }

  const limit = normalizeLimit(req.query.limit);
  const cursor = req.query.cursor || "";
  const keyword = req.query.keyword || "";
  const assetTypesCsv = (req.query.assetTypes || "").toString(); // "41" o "8,41,..."

  // sort dinámico (si no mandas nada, queda como tu default)
  const sortType = String(req.query.sortType || "3");
  const sortAgg = String(req.query.sortAgg || "5");

  // IMPORTANTE: por defecto 0 (incluye offsale) -> más resultados en Face/Neck/Shoulder/Front
  // Si quieres solo items en venta, manda salesTypeFilter=1 desde Roblox.
  const salesTypeFilter = String(req.query.salesTypeFilter || "0");

  // Cache CDN (reduce 429)
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");

  const target = new URL("https://catalog.roblox.com/v1/search/items/details");
  target.searchParams.set("SortType", sortType);
  target.searchParams.set("SortAggregation", sortAgg);
  target.searchParams.set("SalesTypeFilter", salesTypeFilter);
  target.searchParams.set("Limit", String(limit));

  if (cursor) target.searchParams.set("Cursor", cursor);
  if (keyword) target.searchParams.set("Keyword", keyword);
  if (assetTypesCsv) target.searchParams.set("AssetTypes", assetTypesCsv);

  let r;
  try {
    r = await fetch(target.toString(), {
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json,text/plain,*/*",
        "User-Agent": "Mozilla/5.0 (compatible; CatalogProxy/1.0)",
      },
    });
  } catch (e) {
    return res
      .status(502)
      .setHeader("Content-Type", "application/json; charset=utf-8")
      .send(JSON.stringify({ errors: [{ message: "Upstream fetch failed", detail: String(e) }] }));
  }

  const text = await r.text();

  // Si Roblox devolvió no-JSON, lo devolvemos tal cual
  let json = null;
  try { json = JSON.parse(text); } catch {}

  if (!json || typeof json !== "object") {
    return res.status(r.status).setHeader("Content-Type", "application/json; charset=utf-8").send(text);
  }

  // === FILTRO ESTRICTO POR AssetTypes ===
  const allowed = new Set(
    assetTypesCsv
      .match(/\d+/g)
      ?.map(Number)
      .filter(n => Number.isFinite(n)) || []
  );

  function pickAssetTypeId(it) {
    let v =
      it.assetTypeId ?? it.AssetTypeId ??
      it.assetType ?? it.AssetType;

    // a veces viene como objeto
    if (v && typeof v === "object") {
      v = v.id ?? v.Id ?? v.assetTypeId ?? v.AssetTypeId;
    }

    if (typeof v === "string") {
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : null;
    }
    if (typeof v === "number") return v;
    return null;
  }

  if (allowed.size > 0 && Array.isArray(json.data)) {
    json.data = json.data.filter(it => {
      const itemType = String(it.itemType ?? it.ItemType ?? "").toLowerCase();
      // si viene vacío, lo aceptamos; si viene y no es "asset", fuera
      if (itemType && itemType !== "asset") return false;

      const at = pickAssetTypeId(it);
      if (!Number.isFinite(at)) return false;

      return allowed.has(at);
    });
  }

  return res
    .status(r.status)
    .setHeader("Content-Type", "application/json; charset=utf-8")
    .send(JSON.stringify(json));
}
