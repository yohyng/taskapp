export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed", stage: "method" });
  }

  const { token, dbId } = req.body || {};
  if (!token || !dbId) {
    return res.status(400).json({ error: "token and dbId are required", stage: "validate" });
  }

  const notionVersion = "2022-06-28";
  const headers = {
    Authorization: `Bearer ${token}`,
    "Notion-Version": notionVersion,
    "Content-Type": "application/json",
  };

  try {
    // 1) まずDBのメタデータを取得して、アクセス可否と種別を確認する
    const metaRes = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
      method: "GET",
      headers,
    });
    const meta = await metaRes.json().catch(() => ({}));

    if (!metaRes.ok) {
      return res.status(metaRes.status).json({
        stage: "retrieve_database",
        status: metaRes.status,
        code: meta.code || "",
        error: meta.message || "Notion database retrieve error",
        hint: notionHint(metaRes.status, meta.code, meta.message),
        dbId,
        notionVersion,
      });
    }

    // 2) DB本体をクエリ
    const queryRes = await fetch(
      `https://api.notion.com/v1/databases/${dbId}/query`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          sorts: [{ timestamp: "created_time", direction: "descending" }],
          page_size: 50,
        }),
      }
    );

    if (!queryRes.ok) {
      const err = await queryRes.json().catch(() => ({}));
      return res.status(queryRes.status).json({
        stage: "query_database",
        status: queryRes.status,
        code: err.code || "",
        error: err.message || "Notion query error",
        hint: notionHint(queryRes.status, err.code, err.message),
        dbId,
        notionVersion,
      });
    }

    const data = await queryRes.json();

    const pages = (data.results || []).map((page) => {
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

    return res.status(200).json({ pages, count: pages.length });
  } catch (err) {
    return res.status(500).json({
      stage: "fetch_exception",
      error: err.message,
      hint: "ネットワークまたはサーバー側の例外です",
    });
  }
}

// よくあるエラーに対する日本語ヒント
function notionHint(status, code, message) {
  const msg = (message || "").toLowerCase();
  if (msg.includes("does not contain any data sources")) {
    return "Integrationが対象DBに接続されていない可能性が高いです。対象DBを開き ⋯ → 「接続」から該当Integrationを追加してください（親ページに追加してもDB自体には継承されないことがあります）。";
  }
  if (status === 401 || code === "unauthorized") {
    return "トークンが無効です。secret_... の値を再コピーするか、トークンを更新してください。";
  }
  if (status === 404 || code === "object_not_found") {
    return "DB IDが間違っているか、Integrationがそのページ/DBにアクセスできません。DBの ⋯ → 接続 でIntegrationを追加してください。";
  }
  if (status === 400 && code === "validation_error") {
    return "DB IDの形式が不正です。NotionのDB URLの32文字のIDをコピーしてください。";
  }
  if (status === 429) {
    return "レート制限に達しました。しばらく待って再試行してください。";
  }
  return "";
}
