export default async function handler(req, res) {
  // CORS (opcional)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Auth");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

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

  // sort dinámico (si no mandas nada, queda igual que antes)
  const sortType = String(req.query.sortType || "3");
  const sortAgg = String(req.query.sortAgg || "5");
  const salesTypeFilter = String(req.query.salesTypeFilter || "1");

  // Cache CDN (reduce 429)
  res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=60");

  const target = new URL("https://catalog.roblox.com/v1/search/items/details");
  target.searchParams.set("SortType", sortType);
  target.searchParams.set("SortAggregation", sortAgg);
  target.searchParams.set("SalesTypeFilter", salesTypeFilter);
  target.searchParams.set("Limit", String(limit));
  if (cursor) target.searchParams.set("Cursor", cursor);
  if (keyword) target.searchParams.set("Keyword", keyword);
  if (assetTypesCsv) target.searchParams.set("AssetTypes", assetTypesCsv);

  const r = await fetch(target.toString(), {
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json,text/plain,*/*",
      "User-Agent": "Mozilla/5.0 (compatible; CatalogProxy/1.0)",
    },
  });

  const text = await r.text();

  // Si Roblox devolvió no-JSON, lo devolvemos tal cual
  let json = null;
  try { json = JSON.parse(text); } catch {}

  if (!json || typeof json !== "object") {
    return res.status(r.status).setHeader("Content-Type", "application/json").send(text);
  }

  // === FILTRO ESTRICTO POR AssetTypes (para que Hair=41 SOLO muestre hair) ===
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
