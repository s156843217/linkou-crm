// ═══════════════════════════════════════════════════════════════
// Supabase Edge Function：parse-line
// 收 LINE 對話文字 → 交給 Claude Opus 4.8 結構化萃取客戶資料 → 回傳 JSON
//
// 安全：Anthropic 金鑰只存在這裡（伺服器端環境變數），瀏覽器看不到。
//   設定金鑰：supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   部署：    supabase functions deploy parse-line
//
// 預設只有「已登入」的使用者能呼叫（Supabase 會驗證 JWT）。
// ═══════════════════════════════════════════════════════════════
import Anthropic from "npm:@anthropic-ai/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// 萃取結果的結構（對應 customers 表的可萃取欄位；未知一律 null）
const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: ["string", "null"], description: "客戶姓名或稱呼，未知則 null" },
    nickname: { type: ["string", "null"] },
    phone: { type: ["string", "null"] },
    line_id: { type: ["string", "null"] },
    source: { type: ["string", "null"], description: "如何認識：網路/轉介/洗街…" },
    intent: { type: ["string", "null"], description: "買 或 租" },
    budget_min: { type: ["integer", "null"], description: "總價下限，單位：萬元" },
    budget_max: { type: ["integer", "null"], description: "總價上限，單位：萬元" },
    areas: { type: "array", items: { type: "string" }, description: "想要的區域/路段" },
    communities: { type: "array", items: { type: "string" }, description: "提到的社區名稱" },
    room_min: { type: ["integer", "null"] },
    room_max: { type: ["integer", "null"] },
    ping_min: { type: ["number", "null"] },
    ping_max: { type: ["number", "null"] },
    need_parking: { type: ["boolean", "null"] },
    school_need: { type: ["string", "null"], description: "學區需求，如欲設籍某國小" },
    age_max: { type: ["integer", "null"], description: "可接受屋齡上限（年）" },
    floor_pref: { type: ["string", "null"] },
    orientation: { type: ["string", "null"] },
    purpose: { type: ["string", "null"], description: "自住 或 投資" },
    urgency: { type: ["string", "null"], description: "急迫度/時間軸" },
    family_members: { type: ["string", "null"] },
    kids: { type: ["string", "null"], description: "小孩年齡/數量" },
    occupation: { type: ["string", "null"] },
    interests: { type: ["string", "null"], description: "興趣/嗜好" },
    pets: { type: ["string", "null"] },
    note: {
      type: ["string", "null"],
      description: "重點摘要 + 客戶屬性分析（個性、決策風格、在意點等可推測的觀察），繁體中文",
    },
  },
  required: [
    "name", "nickname", "phone", "line_id", "source", "intent",
    "budget_min", "budget_max", "areas", "communities", "room_min", "room_max",
    "ping_min", "ping_max", "need_parking", "school_need", "age_max",
    "floor_pref", "orientation", "purpose", "urgency",
    "family_members", "kids", "occupation", "interests", "pets", "note",
  ],
};

const SYSTEM = `你是房仲（新北市林口區）的客戶資料助理。會收到一段業務員與「買方客戶」的 LINE 對話。
請從對話中萃取這位客戶的資料，輸出符合指定 JSON 結構的結果。規則：
- 全程使用繁體中文，絕不使用日文或簡體字。
- 只萃取對話中明確或可合理推斷的資訊；無法判斷的欄位一律填 null（陣列則填空陣列 []）。
- 不要捏造電話、姓名等具體資料。
- 總價單位一律換算成「萬元」整數（例如 1380 代表 1380 萬）。
- intent 只填「買」或「租」；purpose 只填「自住」或「投資」。
- note 欄位：寫一段重點摘要，並加上對客戶屬性的分析（個性、決策風格、在意的點、急迫度等可推測的觀察）。`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { text } = await req.json();
    if (!text || typeof text !== "string" || text.length < 20) {
      return new Response(JSON.stringify({ error: "對話內容太短" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "伺服器尚未設定 ANTHROPIC_API_KEY" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4000,
      system: SYSTEM,
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: `以下是 LINE 對話內容：\n\n${text}` }],
    });

    // output_config.format 保證第一個 text block 是合法 JSON
    const block = resp.content.find((b: any) => b.type === "text");
    const parsed = JSON.parse(block.text);

    return new Response(JSON.stringify(parsed), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
