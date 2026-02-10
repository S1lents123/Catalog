// /api/assets.js  (Vercel / Next.js API Route)
// - Auth por header X-Auth
// - Soporta sort dinámico (para “featured por pestaña” vs “búsqueda”)
// - Maneja OPTIONS/GET
// - Headers/CORS + Cache-Control (mejora velocidad percibida)
// - Forward del body tal cual lo devuelve catalog.roblox.com (cuando es JSON)

export default async function handler(req, res) {
  // CORS (no es obligatorio para Roblox HttpService, pero no estorba)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Auth");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Auth (en Node, los headers vienen en lowercase)
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

  // Query base
  const limit = normalizeLimit(req.query.limit);
  const cursor = req.query.cursor || "";
  const keyword = req.query.keyword || "";
  const assetTypes = req.query.assetTypes || ""; // "8,41,42,..."

  // NUEVO: sort dinámico (para featured por pestaña / relevancia en búsqueda)
  // Defaults = tu config actual
  const sortType = String(req.query.sortType || "3");
  const sortAgg = String(req.query.sortAgg || "5");
  const salesTypeFilter = String(req.query.salesTypeFilter || "1");

  // Si algún día quieres permitir Category/Subcategory, déjalo opcional:
  const category = req.query.category ? String(req.query.category) : "";
  const subcategory = req.query.subcategory ? String(req.query.subcategory) : "";

  // Cache CDN por URL (Vercel). Útil para “featured” repetido.
  // Para búsquedas con keyword cambia mucho; aun así ayuda si varios piden lo mismo.
  res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=30");

  const target = new URL("https://catalog.roblox.com/v1/search/items/details");
  target.searchParams.set("SortType", sortType);
  target.searchParams.set("SortAggregation", sortAgg);
  target.searchParams.set("SalesTypeFilter", salesTypeFilter);
  target.searchParams.set("Limit", String(limit));

  if (cursor) target.searchParams.set("Cursor", cursor);
  if (keyword) target.searchParams.set("Keyword", keyword);
  if (assetTypes) target.searchParams.set("AssetTypes", assetTypes);

  // Opcional (si lo usas). Si no, se ignora.
  if (category) target.searchParams.set("Category", category);
  if (subcategory) target.searchParams.set("Subcategory", subcategory);

  let r;
  try {
    r = await fetch(target.toString(), {
      headers: {
        "Content-Type": "application/json",
        // A veces ayuda contra bloqueos raros upstream (no siempre necesario)
        "User-Agent": "Mozilla/5.0 (compatible; CatalogProxy/1.0)",
        "Accept": "application/json,text/plain,*/*",
      },
    });
  } catch (e) {
    // Esto evita que Roblox “reviente” por body no-JSON
    return res
      .status(502)
      .setHeader("Content-Type", "application/json")
      .send(JSON.stringify({ errors: [{ message: "Upstream fetch failed", detail: String(e) }] }));
  }

  const text = await r.text();

  // Forward del content-type si existe; si no, forzamos JSON
  const ct = r.headers.get("content-type") || "application/json; charset=utf-8";
  res.status(r.status).setHeader("Content-Type", ct).send(text);
}
