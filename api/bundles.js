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

  // IMPORTANT: pedimos BUNDLES explícitamente
  const target = new URL("https://catalog.roblox.com/v1/search/items/details");
  target.searchParams.set("ItemType", "Bundle");         // <- clave
  target.searchParams.set("SortType", "3");
  target.searchParams.set("SortAggregation", "5");
  target.searchParams.set("SalesTypeFilter", "1");
  target.searchParams.set("Limit", String(limit));

  if (cursor) target.searchParams.set("Cursor", cursor);
  if (keyword) target.searchParams.set("Keyword", keyword);

  const r = await fetch(target.toString(), {
    headers: { "Content-Type": "application/json" },
  });

  const text = await r.text();
  res.status(r.status).setHeader("Content-Type", "application/json").send(text);
}
