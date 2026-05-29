export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { token, dbId } = req.body || {};
  if (!token || !dbId) {
    return res.status(400).json({ error: "token and dbId are required" });
  }

  try {
    const response = await fetch(
      `https://api.notion.com/v1/databases/${dbId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sorts: [{ timestamp: "created_time", direction: "descending" }],
          page_size: 50,
        }),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.message || "Notion API error" });
    }

    const data = await response.json();

    const pages = (data.results || []).map((page) => {
      // タイトルプロパティを探す（Name / Title / 名前 など）
      const titleProp = Object.values(page.properties || {}).find(
        (p) => p.type === "title"
      );
      const title =
        titleProp?.title?.map((t) => t.plain_text).join("") || "(無題)";

      return {
        id: page.id,
        title,
        createdAt: page.created_time?.slice(0, 10) || "",
        url: page.url || "",
      };
    });

    return res.status(200).json({ pages });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
