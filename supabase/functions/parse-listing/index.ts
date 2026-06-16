// ═══════════════════════════════════════════════════════════════
// Supabase Edge Function：parse-listing
// 收「案件網址」或「案件文字」→ 抓網頁/讀文字 → 交給 Claude Opus 4.8
// 萃取案件條件 → 回傳結構化 JSON，供前端「新案比對」自動填欄位。
//
// 設定金鑰：supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// 部署：    supabase functions deploy parse-listing
//
// 注意：591 等網站有反爬蟲，後端常抓不到內容；前端有「貼文字」備援。
// ═══════════════════════════════════════════════════════════════
import Anthropic from "npm:@anthropic-ai/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: ["string", "null"], description: "案件標題/物件名稱" },
    price: { type: ["integer", "null"], description: "總價，單位：萬元" },
    area: { type: ["string", "null"], description: "區域/路段" },
    community: { type: ["string", "null"], description: "社區名稱" },
    room: { type: ["integer", "null"], description: "房數（幾房）" },
    ping: { type: ["number", "null"], description: "坪數（權狀或主建物坪數）" },
    school: { type: ["string", "null"], description: "提到的學區/鄰近學校" },
    parking: { type: ["boolean", "null"], description: "是否含車位" },
    age: { type: ["integer", "null"], description: "屋齡（年）" },
    address: { type: ["string", "null"] },
    note: { type: ["string", "null"], description: "其他重點摘要，繁體中文" },
  },
  required: [
    "title", "price", "area", "community", "room", "ping",
    "school", "parking", "age", "address", "note",
  ],
};

const SYSTEM = `你是房仲（新北市林口區）的案件資料助理。會收到一則房屋待售案件的網頁文字或描述。
請萃取案件的關鍵條件，輸出符合指定 JSON 結構的結果。規則：
- 全程使用繁體中文，絕不使用日文或簡體字。
- 只萃取明確或可合理推斷的資訊；無法判斷的欄位填 null。
- 不要捏造資料。
- 總價單位一律換算成「萬元」整數（例如 1380 代表 1380 萬）。
- 若內容看起來是登入頁、驗證頁或沒有實際案件資訊（例如被反爬蟲擋下），
  就把所有欄位填 null，並在 note 說明「未能取得案件內容，建議改貼文字」。`;

// 粗略把 HTML 轉成純文字（移除 script/style/標籤、壓縮空白、限制長度）
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const { url, text } = await req.json();
    let content = (text || "").trim();

    // 有網址 → 後端抓取（帶瀏覽器 UA 提高成功率）
    if (!content && url) {
      try {
        const r = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            "Accept-Language": "zh-TW,zh;q=0.9",
          },
        });
        content = htmlToText(await r.text());
      } catch (_e) {
        return json({ error: "抓取網址失敗，請改用「貼上案件文字」。" }, 502);
      }
    }
    if (!content || content.length < 20) {
      return json({ error: "沒有可解析的內容（網址抓不到時請改貼文字）。" }, 400);
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "伺服器尚未設定 ANTHROPIC_API_KEY" }, 500);

    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2000,
      system: SYSTEM,
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: `${url ? `案件網址：${url}\n\n` : ""}以下是案件內容：\n\n${content}` }],
    });

    const block = resp.content.find((b: any) => b.type === "text");
    return json(JSON.parse(block.text));
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
