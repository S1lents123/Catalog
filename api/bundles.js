export default async function handler(req, res) {
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

  async function fetchJson(url) {
    const r = await fetch(url, { headers: { "Content-Type": "application/json" } });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, text, json };
  }

  function hasBundles(json) {
    const data = json && json.data;
    if (!Array.isArray(data)) return false;
    return data.some(it => String(it.itemType || it.ItemType || "").toLowerCase() === "bundle");
  }

  // Construimos candidatos (Roblox cambia qué params acepta por bucket)
  const base = new URL("https://catalog.roblox.com/v1/search/items/details");
  base.searchParams.set("SortType", "3");
  base.searchParams.set("SortAggregation", "5");
  base.searchParams.set("SalesTypeFilter", "1");
  base.searchParams.set("Limit", String(limit));
  if (cursor) base.searchParams.set("Cursor", cursor);
  if (keyword) base.searchParams.set("Keyword", keyword);

  const candidates = [];

  // Candidate 1: ItemType=Bundle (may or may not work)
  {
    const u = new URL(base.toString());
    u.searchParams.set("ItemType", "Bundle");
    candidates.push(u);
  }

  // Candidate 2: itemType=Bundle (lowercase param)
  {
    const u = new URL(base.toString());
    u.searchParams.set("itemType", "Bundle");
    candidates.push(u);
  }

  // Candidate 3: Category=3 (bundles in some buckets) + ItemType=Bundle
  {
    const u = new URL(base.toString());
    u.searchParams.set("Category", "3");
    u.searchParams.set("ItemType", "Bundle");
    candidates.push(u);
  }

  // Candidate 4: Search endpoint WITHOUT details (sometimes behaves differently)
  {
    const u = new URL("https://catalog.roblox.com/v1/search/items");
    u.searchParams.set("SortType", "3");
    u.searchParams.set("SortAggregation", "5");
    u.searchParams.set("SalesTypeFilter", "1");
    u.searchParams.set("Limit", String(limit));
    if (cursor) u.searchParams.set("Cursor", cursor);
    if (keyword) u.searchParams.set("Keyword", keyword);
    u.searchParams.set("ItemType", "Bundle");
    candidates.push(u);
  }

  let last = null;

  for (const u of candidates) {
    const r = await fetchJson(u.toString());
    last = r;

    // si no es 200, probamos siguiente
    if (r.status !== 200 || !r.json) continue;

    // si ya trae bundles, devolvemos este
    if (hasBundles(r.json)) {
      return res.status(200).setHeader("Content-Type", "application/json").send(JSON.stringify(r.json));
    }
  }

  // Si ninguna variante devolvió bundles:
  // devolvemos el último JSON (para debug) con un campo extra.
  if (last && last.json) {
    last.json.__proxyWarning = "No variant returned itemType=Bundle in this bucket.";
    return res.status(200).setHeader("Content-Type", "application/json").send(JSON.stringify(last.json));
  }

  return res.status(last ? last.status : 500).setHeader("Content-Type", "application/json").send(
    last ? last.text : JSON.stringify({ errors: [{ message: "Unknown proxy error" }] })
  );
}
