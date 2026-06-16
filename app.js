/* ═══════════════════════════════════════════════════════════════
   林口 CRM 主程式（純原生 JS，零建置）
   資料/邏輯分離：所有資料存 Supabase，本檔只管 UI 與互動。
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  // ── 小工具 ──────────────────────────────────────────────
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const arr = (t) => String(t || "").split(/[,，、\s]+/).map((x) => x.trim()).filter(Boolean);
  const join = (a) => (a || []).join("、");
  const numOrNull = (v) => (v === "" || v == null ? null : Number(v));
  const today = () => new Date().toISOString().slice(0, 10);

  // ── 設定檢查 ────────────────────────────────────────────
  const cfg = window.CRM_CONFIG;
  if (!cfg || !cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("你的專案")) {
    $("#loginErr").textContent = "尚未設定連線：請複製 config.example.js 為 config.js 並填入 Supabase URL 與 anon key。";
    $("#loginBtn").disabled = true;
    return;
  }
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // ── 狀態 ────────────────────────────────────────────────
  let me = null;            // 目前登入者 user
  let profiles = {};        // id → display_name
  let customers = [];       // 全部客戶

  // ── 彈窗系統 ────────────────────────────────────────────
  function openModal(innerHTML) {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="box">${innerHTML}</div>`;
    m.addEventListener("mousedown", (e) => { if (e.target === m) closeModal(m); });
    $("#modalRoot").appendChild(m);
    return m;
  }
  const closeModal = (m) => m && m.remove();
  const closeTop = () => { const ms = document.querySelectorAll(".modal"); if (ms.length) ms[ms.length - 1].remove(); };

  // ═══ 認證 ═══════════════════════════════════════════════
  async function doLogin() {
    const email = $("#email").value.trim();
    const pw = $("#pw").value;
    $("#loginErr").textContent = "";
    if (!email || !pw) { $("#loginErr").textContent = "請輸入 Email 與密碼。"; return; }
    $("#loginBtn").disabled = true; $("#loginBtn").textContent = "登入中…";
    const { error } = await sb.auth.signInWithPassword({ email, password: pw });
    $("#loginBtn").disabled = false; $("#loginBtn").textContent = "登入";
    if (error) { $("#loginErr").textContent = "登入失敗：" + error.message; }
  }

  async function onSession(session) {
    if (session && session.user) {
      me = session.user;
      $("#login").classList.add("hidden");
      $("#app").classList.remove("hidden");
      await loadProfiles();
      await ensureMyProfile();
      $("#whoami").textContent = (profiles[me.id] || me.email) + " ・ 您好";
      await loadCustomers();
    } else {
      me = null;
      $("#app").classList.add("hidden");
      $("#login").classList.remove("hidden");
    }
  }

  async function loadProfiles() {
    const { data } = await sb.from("profiles").select("id,display_name");
    profiles = {};
    (data || []).forEach((p) => { profiles[p.id] = p.display_name; });
  }

  // 保險：確保目前登入者一定有一筆 profile（萬一觸發器沒建到，
  // 才不會讓「負責人」下拉是空的）。靠 p_profiles_insert 權限。
  async function ensureMyProfile() {
    if (profiles[me.id]) return;
    const name = (me.email || "").split("@")[0];
    const { error } = await sb.from("profiles").upsert({ id: me.id, display_name: name });
    if (!error) profiles[me.id] = name;
  }

  // ═══ 客戶列表 ═══════════════════════════════════════════
  async function loadCustomers() {
    const { data, error } = await sb.from("customers").select("*").order("updated_at", { ascending: false });
    if (error) { $("#clist").innerHTML = `<div class="empty">讀取失敗：${esc(error.message)}</div>`; return; }
    customers = data || [];
    renderBirthday();
    renderList();
  }

  function renderList() {
    const q = $("#search").value.trim().toLowerCase();
    const fs = $("#fStatus").value, fg = $("#fGrade").value;
    let rows = customers.filter((c) => {
      if (fs && c.status !== fs) return false;
      if (fg && c.grade !== fg) return false;
      if (q) {
        const hay = [c.name, c.nickname, c.phone, c.note, join(c.communities), join(c.areas)].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (!rows.length) {
      $("#clist").innerHTML = `<div class="empty"><div class="big">${customers.length ? "沒有符合的客戶" : "還沒有客戶"}</div>
        <div>${customers.length ? "試試清掉搜尋或篩選" : "點右上「＋ 新增客戶」開始建檔"}</div></div>`;
      return;
    }
    $("#clist").innerHTML = rows.map(cardHTML).join("");
    document.querySelectorAll(".ccard").forEach((n) => n.addEventListener("click", () => openDetail(n.dataset.id)));
  }

  function cardHTML(c) {
    const gMap = { A: "A 熱", B: "B 溫", C: "C 冷" };
    const sCls = c.status === "已成交" ? "done" : c.status === "已流失" ? "lost" : "";
    const budget = c.budget_min || c.budget_max
      ? `${c.budget_min || "?"}–${c.budget_max || "?"} 萬` : "";
    const meta = [c.phone, budget, join(c.areas)].filter(Boolean).join(" ・ ");
    return `<div class="ccard" data-id="${c.id}">
      <div class="nm">${esc(c.name)}${c.nickname ? `<small>${esc(c.nickname)}</small>` : ""}</div>
      <div class="meta">${esc(meta) || "（尚無需求資料）"}</div>
      <div class="chips">
        <span class="chip ${c.grade || ""}">${gMap[c.grade] || c.grade || ""}</span>
        <span class="chip ${sCls}">${esc(c.status || "")}</span>
        ${c.intent ? `<span class="chip">${esc(c.intent)}</span>` : ""}
        ${join(c.communities) ? `<span class="chip">${esc(c.communities[0])}${c.communities.length > 1 ? "＋" : ""}</span>` : ""}
      </div></div>`;
  }

  // ═══ 生日提醒（未來 14 天）═══════════════════════════════
  function renderBirthday() {
    const banner = $("#bdayBanner");
    const now = new Date();
    const soon = customers.map((c) => {
      if (!c.birthday) return null;
      const b = new Date(c.birthday);
      const d = new Date(now.getFullYear(), b.getMonth(), b.getDate());
      if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) d.setFullYear(now.getFullYear() + 1);
      const days = Math.round((d - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
      return days <= 14 ? { c, days, md: `${b.getMonth() + 1}/${b.getDate()}` } : null;
    }).filter(Boolean).sort((a, b) => a.days - b.days);
    if (!soon.length) { banner.classList.add("hidden"); return; }
    banner.classList.remove("hidden");
    banner.innerHTML = `<b>🎂 近期壽星</b>（14 天內）　` + soon.map((s) =>
      `<span class="bd" data-id="${s.c.id}">${esc(s.c.name)} ${s.md}（${s.days === 0 ? "今天" : s.days + " 天後"}）</span>`
    ).join("");
    banner.querySelectorAll(".bd").forEach((n) => n.addEventListener("click", () => openDetail(n.dataset.id)));
  }

  // ═══ 新增 / 編輯 客戶 ═══════════════════════════════════
  function ownerOptions(sel) {
    return Object.keys(profiles).map((id) =>
      `<option value="${id}" ${id === sel ? "selected" : ""}>${esc(profiles[id])}</option>`).join("");
  }
  function opt(list, sel) {
    return list.map((v) => `<option ${v === sel ? "selected" : ""}>${v}</option>`).join("");
  }

  function openEditor(c) {
    c = c || {};
    const isNew = !c.id;
    const box = openModal(`
      <div class="mhead"><h2>${isNew ? "新增客戶" : "編輯客戶"}</h2><button class="x" data-x>×</button></div>
      <div class="mbody">
        <div class="section-t"><span class="dot"></span>基本資料</div>
        <div class="grid2">
          <div class="field"><label class="lbl">姓名 *</label><input id="f_name" value="${esc(c.name)}"></div>
          <div class="field"><label class="lbl">暱稱 / 稱呼</label><input id="f_nickname" value="${esc(c.nickname)}"></div>
          <div class="field"><label class="lbl">電話</label><input id="f_phone" value="${esc(c.phone)}"></div>
          <div class="field"><label class="lbl">LINE ID</label><input id="f_line_id" value="${esc(c.line_id)}"></div>
          <div class="field"><label class="lbl">來源</label><input id="f_source" value="${esc(c.source)}" placeholder="網路/轉介/洗街…"></div>
          <div class="field"><label class="lbl">生日</label><input id="f_birthday" type="date" value="${esc(c.birthday)}"></div>
        </div>
        <div class="grid3">
          <div class="field"><label class="lbl">分級</label><select id="f_grade">${opt(["A", "B", "C"], c.grade || "B")}</select></div>
          <div class="field"><label class="lbl">狀態</label><select id="f_status">${opt(["進行中", "已成交", "已流失"], c.status || "進行中")}</select></div>
          <div class="field"><label class="lbl">意向</label><select id="f_intent">${opt(["買", "租"], c.intent || "買")}</select></div>
        </div>
        <div class="grid2">
          <div class="field"><label class="lbl">負責人</label><select id="f_owner">${ownerOptions(c.owner_id || me.id)}</select></div>
          <div class="field"><label class="lbl">最後聯絡日</label><input id="f_last_contact" type="date" value="${esc(c.last_contact)}"></div>
        </div>

        <div class="section-t"><span class="dot"></span>買方需求（比對用）</div>
        <div class="grid2">
          <div class="field"><label class="lbl">總價下限（萬）</label><input id="f_budget_min" type="number" value="${esc(c.budget_min)}"></div>
          <div class="field"><label class="lbl">總價上限（萬）</label><input id="f_budget_max" type="number" value="${esc(c.budget_max)}"></div>
        </div>
        <div class="field"><label class="lbl">區域 / 路段（用、或逗號分隔）</label><input id="f_areas" value="${esc(join(c.areas))}" placeholder="如：文化一路、捷運A9、頭湖"></div>
        <div class="field"><label class="lbl">偏好社區（用、或逗號分隔）</label><input id="f_communities" value="${esc(join(c.communities))}" placeholder="如：竹城伊豆、空間樂園"></div>
        <div class="grid3">
          <div class="field"><label class="lbl">房數下限</label><input id="f_room_min" type="number" value="${esc(c.room_min)}"></div>
          <div class="field"><label class="lbl">房數上限</label><input id="f_room_max" type="number" value="${esc(c.room_max)}"></div>
          <div class="field"><label class="lbl">需車位</label><select id="f_need_parking">${opt(["否", "是"], c.need_parking ? "是" : "否")}</select></div>
          <div class="field"><label class="lbl">坪數下限</label><input id="f_ping_min" type="number" value="${esc(c.ping_min)}"></div>
          <div class="field"><label class="lbl">坪數上限</label><input id="f_ping_max" type="number" value="${esc(c.ping_max)}"></div>
          <div class="field"><label class="lbl">屋齡上限（年）</label><input id="f_age_max" type="number" value="${esc(c.age_max)}"></div>
        </div>
        <div class="grid3">
          <div class="field"><label class="lbl">樓層偏好</label><input id="f_floor_pref" value="${esc(c.floor_pref)}"></div>
          <div class="field"><label class="lbl">朝向</label><input id="f_orientation" value="${esc(c.orientation)}"></div>
          <div class="field"><label class="lbl">自住 / 投資</label><input id="f_purpose" value="${esc(c.purpose)}"></div>
        </div>
        <div class="grid2">
          <div class="field"><label class="lbl">學區需求</label><input id="f_school_need" value="${esc(c.school_need)}" placeholder="如：欲設籍麗園國小"></div>
          <div class="field"><label class="lbl">急迫度</label><input id="f_urgency" value="${esc(c.urgency)}" placeholder="如：3個月內、看到喜歡就買"></div>
        </div>

        <div class="section-t"><span class="dot"></span>家庭 / 背景</div>
        <div class="grid2">
          <div class="field"><label class="lbl">家庭成員</label><input id="f_family_members" value="${esc(c.family_members)}"></div>
          <div class="field"><label class="lbl">小孩年齡</label><input id="f_kids" value="${esc(c.kids)}"></div>
          <div class="field"><label class="lbl">職業</label><input id="f_occupation" value="${esc(c.occupation)}"></div>
          <div class="field"><label class="lbl">興趣 / 嗜好</label><input id="f_interests" value="${esc(c.interests)}"></div>
          <div class="field"><label class="lbl">寵物</label><input id="f_pets" value="${esc(c.pets)}"></div>
        </div>
        <div class="field"><label class="lbl">綜合備註 / 屬性分析</label><textarea id="f_note">${esc(c.note)}</textarea></div>
        <div class="err" id="f_err"></div>
      </div>
      <div class="mfoot">
        <button class="btn ghost" data-x>取消</button>
        <button class="btn" id="f_save">${isNew ? "建立客戶" : "儲存"}</button>
      </div>`);

    box.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", () => closeModal(box)));
    box.querySelector("#f_save").addEventListener("click", () => saveCustomer(c, box));
  }

  function readEditor(box) {
    const g = (id) => box.querySelector("#" + id).value.trim();
    return {
      name: g("f_name"), nickname: g("f_nickname"), phone: g("f_phone"), line_id: g("f_line_id"),
      source: g("f_source"), birthday: g("f_birthday") || null, grade: g("f_grade"),
      status: g("f_status"), intent: g("f_intent"), owner_id: g("f_owner"),
      last_contact: g("f_last_contact") || null,
      budget_min: numOrNull(g("f_budget_min")), budget_max: numOrNull(g("f_budget_max")),
      areas: arr(g("f_areas")), communities: arr(g("f_communities")),
      room_min: numOrNull(g("f_room_min")), room_max: numOrNull(g("f_room_max")),
      ping_min: numOrNull(g("f_ping_min")), ping_max: numOrNull(g("f_ping_max")),
      need_parking: g("f_need_parking") === "是", school_need: g("f_school_need"),
      age_max: numOrNull(g("f_age_max")), floor_pref: g("f_floor_pref"),
      orientation: g("f_orientation"), purpose: g("f_purpose"), urgency: g("f_urgency"),
      family_members: g("f_family_members"), kids: g("f_kids"), occupation: g("f_occupation"),
      interests: g("f_interests"), pets: g("f_pets"), note: g("f_note"),
    };
  }

  async function saveCustomer(orig, box) {
    const payload = readEditor(box);
    if (!payload.name) { box.querySelector("#f_err").textContent = "請填寫姓名。"; return; }
    const btn = box.querySelector("#f_save"); btn.disabled = true; btn.textContent = "儲存中…";
    let error;
    if (orig.id) {
      ({ error } = await sb.from("customers").update(payload).eq("id", orig.id));
    } else {
      payload.created_by = me.id;
      ({ error } = await sb.from("customers").insert(payload));
    }
    if (error) { box.querySelector("#f_err").textContent = "儲存失敗：" + error.message; btn.disabled = false; btn.textContent = "儲存"; return; }
    closeModal(box);
    await loadCustomers();
  }

  // ═══ 客戶詳情（含互動 / 帶看）═══════════════════════════
  async function openDetail(id) {
    const c = customers.find((x) => x.id === id);
    if (!c) return;
    const box = openModal(`
      <div class="mhead">
        <h2>${esc(c.name)} ${c.nickname ? `<span style="font-size:14px;color:var(--ink-soft)">${esc(c.nickname)}</span>` : ""}</h2>
        <button class="btn sm ghost" id="d_edit">編輯</button>
        <button class="x" data-x>×</button>
      </div>
      <div class="mbody">
        <div class="tabs">
          <button class="tab on" data-tab="info">資料</button>
          <button class="tab" data-tab="inter">互動紀錄</button>
          <button class="tab" data-tab="view">帶看紀錄</button>
        </div>
        <div id="d_info"></div>
        <div id="d_inter" class="hidden"></div>
        <div id="d_view" class="hidden"></div>
      </div>
      <div class="mfoot">
        <button class="btn danger sm" id="d_del">刪除客戶</button>
      </div>`);

    box.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", () => closeModal(box)));
    box.querySelector("#d_edit").addEventListener("click", () => { closeModal(box); openEditor(c); });
    box.querySelector("#d_del").addEventListener("click", () => delCustomer(c, box));
    box.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
      box.querySelectorAll(".tab").forEach((x) => x.classList.toggle("on", x === t));
      ["info", "inter", "view"].forEach((k) => box.querySelector("#d_" + k).classList.toggle("hidden", k !== t.dataset.tab));
    }));

    box.querySelector("#d_info").innerHTML = infoHTML(c);
    renderInteractions(c, box);
    renderViewings(c, box);
  }

  function row(k, v) { return v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : ""; }
  function infoHTML(c) {
    const budget = (c.budget_min || c.budget_max) ? `${c.budget_min || "?"}–${c.budget_max || "?"} 萬` : "";
    const rooms = (c.room_min || c.room_max) ? `${c.room_min || "?"}–${c.room_max || "?"} 房` : "";
    const ping = (c.ping_min || c.ping_max) ? `${c.ping_min || "?"}–${c.ping_max || "?"} 坪` : "";
    return `<dl class="kv">
      ${row("分級", { A: "A 熱", B: "B 溫", C: "C 冷" }[c.grade] || c.grade)}
      ${row("狀態", c.status)}${row("意向", c.intent)}
      ${row("負責人", profiles[c.owner_id])}
      ${row("電話", c.phone)}${row("LINE", c.line_id)}${row("來源", c.source)}
      ${row("生日", c.birthday)}${row("最後聯絡", c.last_contact)}
    </dl>
    <div class="section-t" style="margin-top:18px"><span class="dot"></span>買方需求</div>
    <dl class="kv">
      ${row("總價", budget)}${row("區域", join(c.areas))}${row("偏好社區", join(c.communities))}
      ${row("房數", rooms)}${row("坪數", ping)}${row("車位", c.need_parking ? "需要" : "")}
      ${row("屋齡上限", c.age_max ? c.age_max + " 年" : "")}${row("樓層", c.floor_pref)}
      ${row("朝向", c.orientation)}${row("自住/投資", c.purpose)}
      ${row("學區需求", c.school_need)}${row("急迫度", c.urgency)}
    </dl>
    <div class="section-t" style="margin-top:18px"><span class="dot"></span>家庭 / 背景</div>
    <dl class="kv">
      ${row("家庭成員", c.family_members)}${row("小孩", c.kids)}${row("職業", c.occupation)}
      ${row("興趣", c.interests)}${row("寵物", c.pets)}
    </dl>
    ${c.note ? `<div class="section-t" style="margin-top:18px"><span class="dot"></span>備註 / 屬性分析</div>
      <div class="subrec"><div class="body">${esc(c.note)}</div></div>` : ""}`;
  }

  // ── 互動紀錄 ──
  async function renderInteractions(c, box) {
    const wrap = box.querySelector("#d_inter");
    const { data } = await sb.from("interactions").select("*").eq("customer_id", c.id).order("happened_on", { ascending: false });
    const list = (data || []).map((r) => `<div class="subrec">
      <div class="top"><span>${esc(r.happened_on)}</span><span class="tag">${esc(r.channel)}</span>
        <button class="del" data-del="${r.id}">刪除</button></div>
      <div class="body">${esc(r.summary)}</div></div>`).join("") || `<div class="hint">尚無互動紀錄。</div>`;
    wrap.innerHTML = `
      <div class="panel" style="padding:14px;margin-bottom:14px">
        <div class="grid2">
          <div class="field"><label class="lbl">日期</label><input id="i_date" type="date" value="${today()}"></div>
          <div class="field"><label class="lbl">方式</label><select id="i_ch">${opt(["LINE", "電話", "面談", "其他"], "LINE")}</select></div>
        </div>
        <div class="field"><label class="lbl">內容摘要</label><textarea id="i_sum" placeholder="談了什麼、客戶反應…"></textarea></div>
        <button class="btn sm" id="i_add">＋ 新增互動</button>
      </div>${list}`;
    wrap.querySelector("#i_add").addEventListener("click", async () => {
      const summary = wrap.querySelector("#i_sum").value.trim();
      if (!summary) return;
      await sb.from("interactions").insert({
        customer_id: c.id, created_by: me.id,
        happened_on: wrap.querySelector("#i_date").value, channel: wrap.querySelector("#i_ch").value, summary,
      });
      renderInteractions(c, box);
    });
    wrap.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
      await sb.from("interactions").delete().eq("id", b.dataset.del); renderInteractions(c, box);
    }));
  }

  // ── 帶看紀錄 ──
  async function renderViewings(c, box) {
    const wrap = box.querySelector("#d_view");
    const { data } = await sb.from("viewings").select("*").eq("customer_id", c.id).order("viewed_on", { ascending: false });
    const rCls = { 喜歡: "like", 普通: "mid", 不喜歡: "dislike" };
    const list = (data || []).map((r) => `<div class="subrec">
      <div class="top"><span>${esc(r.viewed_on)}</span><b>${esc(r.community || "")}</b>
        ${r.reaction ? `<span class="tag ${rCls[r.reaction] || ""}">${esc(r.reaction)}</span>` : ""}
        <button class="del" data-del="${r.id}">刪除</button></div>
      ${r.pros ? `<div class="pc"><b>優點</b>：${esc(r.pros)}</div>` : ""}
      ${r.cons ? `<div class="pc cons"><b>缺點</b>：${esc(r.cons)}</div>` : ""}
      ${r.note ? `<div class="body" style="margin-top:4px">${esc(r.note)}</div>` : ""}</div>`).join("") || `<div class="hint">尚無帶看紀錄。</div>`;
    wrap.innerHTML = `
      <div class="panel" style="padding:14px;margin-bottom:14px">
        <div class="grid2">
          <div class="field"><label class="lbl">日期</label><input id="v_date" type="date" value="${today()}"></div>
          <div class="field"><label class="lbl">社區 / 物件</label><input id="v_comm" placeholder="社區名稱"></div>
          <div class="field"><label class="lbl">客戶反應</label><select id="v_react">${opt(["", "喜歡", "普通", "不喜歡"], "")}</select></div>
          <div class="field"><label class="lbl">地址（選填）</label><input id="v_addr"></div>
        </div>
        <div class="grid2">
          <div class="field"><label class="lbl">客戶說的優點</label><textarea id="v_pros"></textarea></div>
          <div class="field"><label class="lbl">客戶說的缺點</label><textarea id="v_cons"></textarea></div>
        </div>
        <div class="field"><label class="lbl">其他備註</label><textarea id="v_note"></textarea></div>
        <button class="btn sm" id="v_add">＋ 新增帶看</button>
      </div>${list}`;
    wrap.querySelector("#v_add").addEventListener("click", async () => {
      const community = wrap.querySelector("#v_comm").value.trim();
      if (!community) return;
      await sb.from("viewings").insert({
        customer_id: c.id, created_by: me.id, viewed_on: wrap.querySelector("#v_date").value,
        community, address: wrap.querySelector("#v_addr").value.trim(),
        reaction: wrap.querySelector("#v_react").value || null,
        pros: wrap.querySelector("#v_pros").value.trim(), cons: wrap.querySelector("#v_cons").value.trim(),
        note: wrap.querySelector("#v_note").value.trim(),
      });
      renderViewings(c, box);
    });
    wrap.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
      await sb.from("viewings").delete().eq("id", b.dataset.del); renderViewings(c, box);
    }));
  }

  async function delCustomer(c, box) {
    if (!confirm(`確定刪除「${c.name}」？此動作無法復原（互動與帶看紀錄一併刪除）。`)) return;
    await sb.from("customers").delete().eq("id", c.id);
    closeModal(box); await loadCustomers();
  }

  // ═══ 新案比對 ═══════════════════════════════════════════
  function openMatch() {
    const box = openModal(`
      <div class="mhead"><h2>🔍 新案比對</h2><button class="x" data-x>×</button></div>
      <div class="mbody">
        <p class="hint" style="margin-bottom:14px">貼網址或案件文字讓 AI 自動填條件，或直接手動輸入；系統會掃描「進行中」客戶依吻合度評分排序。</p>
        <div class="panel" style="padding:13px;margin-bottom:14px">
          <label class="lbl">① 貼案件網址（公司案場通常可讀；591 常被反爬蟲擋）</label>
          <div style="display:flex;gap:8px">
            <input id="m_url" placeholder="https://…">
            <button class="btn teal sm" id="m_fetch" style="white-space:nowrap">AI 讀取</button>
          </div>
          <div style="font-size:12px;color:var(--ink-soft);text-align:center;margin:10px 0 6px">— 或，網址讀不到就貼文字 —</div>
          <label class="lbl">② 貼上案件文字（591 描述、案件頁文字…）</label>
          <textarea id="m_text" style="min-height:68px" placeholder="把案件頁看得到的文字複製貼上…"></textarea>
          <button class="btn ghost sm" id="m_ptext" style="margin-top:8px">AI 解析文字</button>
          <div class="hint" id="m_read"></div>
        </div>
        <div class="section-t"><span class="dot"></span>案件條件（AI 填好後可手動調整）</div>
        <div class="grid2">
          <div class="field"><label class="lbl">總價（萬）</label><input id="m_price" type="number" placeholder="如 1380"></div>
          <div class="field"><label class="lbl">區域 / 路段</label><input id="m_area" placeholder="如 文化一路"></div>
          <div class="field"><label class="lbl">社區名稱</label><input id="m_comm" placeholder="如 竹城伊豆"></div>
          <div class="field"><label class="lbl">房數</label><input id="m_room" type="number" placeholder="如 3"></div>
          <div class="field"><label class="lbl">坪數</label><input id="m_ping" type="number" placeholder="如 32"></div>
          <div class="field"><label class="lbl">學區</label><input id="m_school" placeholder="如 麗園國小"></div>
          <div class="field"><label class="lbl">含車位</label><select id="m_park">${opt(["否", "是"], "否")}</select></div>
          <div class="field"><label class="lbl">屋齡（年）</label><input id="m_age" type="number"></div>
        </div>
        <button class="btn teal" id="m_go" style="width:100%">開始比對</button>
        <div id="m_res" style="margin-top:16px"></div>
      </div>`);
    box.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", () => closeModal(box)));
    box.querySelector("#m_go").addEventListener("click", () => runMatch(box));
    box.querySelector("#m_fetch").addEventListener("click", () => fetchListing(box, "url"));
    box.querySelector("#m_ptext").addEventListener("click", () => fetchListing(box, "text"));
  }

  // 呼叫 parse-listing：抓網址 or 解析文字 → 自動填入比對條件欄位
  async function fetchListing(box, kind) {
    const read = box.querySelector("#m_read");
    read.textContent = "";
    let body;
    if (kind === "url") {
      const url = box.querySelector("#m_url").value.trim();
      if (!url) { read.textContent = "請先貼上網址。"; return; }
      body = { url };
    } else {
      const text = box.querySelector("#m_text").value.trim();
      if (text.length < 20) { read.textContent = "請貼上足夠的案件文字。"; return; }
      body = { text };
    }
    const btn = box.querySelector(kind === "url" ? "#m_fetch" : "#m_ptext");
    const label = btn.textContent;
    btn.disabled = true; btn.innerHTML = `<span class="spin"></span> 解析中…`;
    const { data, error } = await sb.functions.invoke("parse-listing", { body });
    btn.disabled = false; btn.textContent = label;
    if (error || (data && data.error)) {
      read.innerHTML = `<span style="color:var(--red)">讀取失敗：${esc((data && data.error) || error.message)}${kind === "url" ? "（試試改貼文字）" : ""}</span>`;
      return;
    }
    const set = (id, v) => { if (v != null && v !== "") box.querySelector("#" + id).value = v; };
    set("m_price", data.price); set("m_area", data.area); set("m_comm", data.community);
    set("m_room", data.room); set("m_ping", data.ping); set("m_school", data.school); set("m_age", data.age);
    box.querySelector("#m_park").value = data.parking ? "是" : "否";
    read.innerHTML = `已讀取：<b>${esc(data.title || "案件")}</b>　請確認下方條件後按「開始比對」。`;
  }

  function runMatch(box) {
    const g = (id) => box.querySelector("#" + id).value.trim();
    const L = {
      price: numOrNull(g("m_price")), area: g("m_area"), comm: g("m_comm"),
      room: numOrNull(g("m_room")), ping: numOrNull(g("m_ping")), school: g("m_school"),
      park: g("m_park") === "是", age: numOrNull(g("m_age")),
    };
    const scored = customers.filter((c) => c.status === "進行中").map((c) => {
      let s = 0; const why = [];
      // 總價
      if (L.price != null && (c.budget_min || c.budget_max)) {
        const lo = c.budget_min || 0, hi = c.budget_max || Infinity;
        if (L.price >= lo && L.price <= hi) { s += 30; why.push("總價吻合"); }
        else if (L.price <= hi * 1.1 && L.price >= lo * 0.9) { s += 15; why.push("總價接近"); }
      }
      // 社區
      if (L.comm && (c.communities || []).some((x) => x.includes(L.comm) || L.comm.includes(x))) { s += 22; why.push("指名社區"); }
      // 區域
      if (L.area && (c.areas || []).some((x) => x.includes(L.area) || L.area.includes(x))) { s += 18; why.push("區域吻合"); }
      // 房數
      if (L.room != null && (c.room_min || c.room_max)) {
        if (L.room >= (c.room_min || 0) && L.room <= (c.room_max || 99)) { s += 14; why.push("房數吻合"); }
      }
      // 坪數
      if (L.ping != null && (c.ping_min || c.ping_max)) {
        if (L.ping >= (c.ping_min || 0) && L.ping <= (c.ping_max || 999)) { s += 10; why.push("坪數吻合"); }
      }
      // 學區
      if (L.school && c.school_need && (c.school_need.includes(L.school) || L.school.includes(c.school_need))) { s += 12; why.push("學區符合"); }
      // 車位
      if (L.park && c.need_parking) { s += 5; why.push("有車位"); }
      // 屋齡
      if (L.age != null && c.age_max && L.age <= c.age_max) { s += 4; why.push("屋齡可"); }
      return { c, s, why };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);

    const res = box.querySelector("#m_res");
    if (!scored.length) { res.innerHTML = `<div class="empty">沒有吻合的進行中客戶。可放寬條件或先建立更多客戶需求。</div>`; return; }
    res.innerHTML = `<div class="section-t"><span class="dot"></span>吻合客戶（${scored.length}）</div>` +
      scored.map((x) => `<div class="match" data-id="${x.c.id}">
        <div class="score">${x.s}<small>分</small></div>
        <div class="info"><div class="nm">${esc(x.c.name)}${x.c.nickname ? ` ${esc(x.c.nickname)}` : ""}
          ${x.c.phone ? `<span style="font-weight:400;color:var(--ink-soft)"> ・ ${esc(x.c.phone)}</span>` : ""}</div>
          <div class="why">${x.why.map((w) => `<span class="chip">${w}</span>`).join("")}</div></div>
      </div>`).join("");
    res.querySelectorAll(".match").forEach((n) => n.addEventListener("click", () => { closeTop(); openDetail(n.dataset.id); }));
  }

  // ═══ LINE 對話匯入（呼叫 Supabase Edge Function → Claude Opus 4.8）═══
  function openLineImport() {
    const box = openModal(`
      <div class="mhead"><h2>📥 LINE 對話匯入</h2><button class="x" data-x>×</button></div>
      <div class="mbody">
        <div class="ai-note">把與客戶的 LINE 對話（在 LINE 聊天室 → 選單 → 匯出聊天記錄）的文字貼到下方，
          系統會交給 AI（Claude Opus 4.8）自動萃取姓名、需求、喜好與屬性分析，產生一張預填好的客戶卡讓你確認後存檔。
          <br>※ 對話內容會送到 AI 服務處理，請留意這屬於對外傳送個資。</div>
        <div class="field"><label class="lbl">貼上 LINE 對話文字</label>
          <textarea id="l_text" style="min-height:200px" placeholder="貼上匯出的對話…"></textarea></div>
        <button class="btn" id="l_go" style="width:100%">用 AI 解析並建檔</button>
        <div class="err" id="l_err"></div>
      </div>`);
    box.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", () => closeModal(box)));
    box.querySelector("#l_go").addEventListener("click", () => runLineImport(box));
  }

  async function runLineImport(box) {
    const text = box.querySelector("#l_text").value.trim();
    const err = box.querySelector("#l_err");
    err.textContent = "";
    if (text.length < 20) { err.textContent = "請貼上足夠的對話內容。"; return; }
    const btn = box.querySelector("#l_go");
    btn.disabled = true; btn.innerHTML = `<span class="spin"></span> AI 解析中（約 10–30 秒）…`;
    const { data, error } = await sb.functions.invoke("parse-line", { body: { text } });
    btn.disabled = false; btn.textContent = "用 AI 解析並建檔";
    if (error) { err.textContent = "解析失敗：" + error.message + "（請確認 Edge Function 已部署、金鑰已設定）"; return; }
    closeModal(box);
    // AI 回傳的欄位 → 開啟預填好的新增表單讓使用者確認
    openEditor(Object.assign({}, data, { id: null }));
  }

  // ═══ 綁定與啟動 ═════════════════════════════════════════
  $("#loginBtn").addEventListener("click", doLogin);
  $("#pw").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
  $("#logoutBtn").addEventListener("click", () => sb.auth.signOut());
  $("#search").addEventListener("input", renderList);
  $("#fStatus").addEventListener("change", renderList);
  $("#fGrade").addEventListener("change", renderList);
  $("#addBtn").addEventListener("click", () => openEditor());
  $("#matchBtn").addEventListener("click", openMatch);
  $("#lineBtn").addEventListener("click", openLineImport);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeTop(); });

  sb.auth.getSession().then(({ data }) => onSession(data.session));
  sb.auth.onAuthStateChange((_e, session) => onSession(session));
})();
