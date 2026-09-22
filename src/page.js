// 页面模块：血统更正与后代冻结台的单页界面。
export const page = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>赛鸽血统更正与后代冻结台</title>
  <style>
    :root { --bg:#eff2f5; --panel:#fff; --ink:#1f2833; --muted:#697786; --line:#d3dce4; --accent:#315f83; --red:#9b3f35; --amber:#9a6b1f; --green:#2f6b45; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:24px; } main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card { background:#fff; border:1px solid var(--line); border-radius:8px; padding:16px; } h2 { margin:0 0 12px; font-size:18px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:9px 13px; font-weight:700; cursor:pointer; }
    button.ghost { background:#e6edf2; color:var(--accent); } button.danger { background:var(--red); } button.small { padding:5px 9px; font-size:12px; }
    .toolbar { display:grid; grid-template-columns:1fr auto; gap:10px; margin-bottom:14px; } .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; }
    .card { display:grid; gap:8px; cursor:pointer; } .card.selected { border-color:var(--accent); box-shadow:0 0 0 2px rgba(49,95,131,.18); }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; margin-right:6px; }
    .pill.frozen { border-color:var(--red); color:var(--red); } .pill.pending { border-color:var(--amber); color:var(--amber); } .pill.approved { border-color:var(--green); color:var(--green); } .pill.revoked { color:var(--muted); }
    .section { margin-top:14px; } .relation { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:14px; } .small { background:#f8fafb; border:1px solid var(--line); border-radius:8px; padding:10px; }
    .banner { display:none; border-radius:6px; padding:10px 12px; margin-bottom:12px; font-size:13px; } .banner.err { display:block; background:#f7e8e6; color:var(--red); border:1px solid var(--red); } .banner.ok { display:block; background:#e7f2ec; color:var(--green); border:1px solid var(--green); }
    .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; } table { width:100%; border-collapse:collapse; font-size:13px; } td,th { border-bottom:1px solid var(--line); padding:6px 8px; text-align:left; vertical-align:top; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} .relation{grid-template-columns:1fr;} }
  </style>
</head>
<body>
  <header><div><h1>赛鸽血统更正与后代冻结台</h1><div class="meta">血统更正申请 · 通过后旧结论冻结 · 撤销恢复前一有效版本</div></div><button id="reload">刷新</button></header>
  <main>
    <div>
      <form id="form">
        <h2>创建鸽只档案</h2>
        <label>足环号</label><input name="ringNo" required>
        <label>鸽主</label><input name="owner" required>
        <label>父鸽足环号（可空）</label><input name="fatherRing">
        <label>母鸽足环号（可空）</label><input name="motherRing">
        <label>羽色</label><input name="color" required>
        <label>出生棚号</label><input name="loft" required>
        <button>保存档案</button>
      </form>
    </div>
    <section>
      <div class="toolbar"><input id="search" placeholder="输入足环号定位鸽只"><button id="searchBtn">定位</button></div>
      <div class="banner" id="banner"></div>
      <div class="panel" id="detail"></div>
      <div class="section grid" id="cards"></div>
    </section>
  </main>
  <script>
    let pigeons = [];
    let selected = "";
    const cards = document.querySelector("#cards");
    const detail = document.querySelector("#detail");
    const search = document.querySelector("#search");
    const banner = document.querySelector("#banner");
    const errorText = {
      ring_exists: "该足环号已登记", correction_already_pending: "已有待审更正，每羽仅限一条",
      new_parent_missing: "新父母缺失或未登记（409，整段未保存）", descendant_cycle: "新关系会形成后代环（409，整段未保存）",
      original_parent_mismatch: "原父母与档案现状不一致（409，整段未保存）", correction_not_pending: "该更正不是待审状态",
      correction_not_approved: "该更正未处于通过状态", newer_correction_exists: "存在更新的已通过更正，请先撤销它",
      pigeon_not_found: "鸽只不存在", correction_not_found: "更正单不存在", missing_required_fields: "须填原父母、新父母和原因"
    };
    function showError(text) { banner.className = "banner err"; banner.textContent = text; }
    function showOk(text) { banner.className = "banner ok"; banner.textContent = text; }
    function clearBanner() { banner.className = "banner"; banner.textContent = ""; }
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? Object.assign({}, options, { headers: { "Content-Type": "application/json" } }) : options);
      const data = await res.json();
      if (!res.ok) throw Object.assign(new Error((data.error && errorText[data.error]) || data.error || "请求失败"), { status: res.status });
      return data;
    }
    function esc(value) { const d = document.createElement("div"); d.textContent = value == null ? "" : String(value); return d.innerHTML; }
    function statusPill(p) {
      const badges = [];
      if (p.frozen) badges.push('<span class="pill frozen">血统已冻结</span>');
      if (p.hasPendingCorrection) badges.push('<span class="pill pending">待审更正 ' + esc(p.pendingCorrectionId) + "</span>");
      return badges.join("");
    }
    function renderCards() {
      cards.innerHTML = pigeons.map(function(p) {
        return '<article class="card' + (p.ringNo === selected ? " selected" : "") + '" data-ring="' + esc(p.ringNo) + '">'
          + "<h3>" + esc(p.ringNo) + "</h3><div>" + statusPill(p) + '<span class="pill">v' + p.activeVersion + "</span></div>"
          + '<span class="pill">' + esc(p.owner) + "</span><div class=\"meta\">" + esc(p.color) + " · " + esc(p.loft) + "</div>"
          + "<div>父：" + (p.fatherRing ? esc(p.fatherRing) : "未登记") + "</div>"
          + "<div>母：" + (p.motherRing ? esc(p.motherRing) : "未登记") + "</div></article>";
      }).join("");
      cards.querySelectorAll("[data-ring]").forEach(function(el) {
        el.onclick = function() { selected = el.dataset.ring; search.value = selected; loadDetail(); renderCards(); };
      });
    }
    function corrPill(status) {
      const map = { pending: "待审", approved: "已通过", revoked: "已撤销" };
      return '<span class="pill ' + esc(status) + '">' + esc(map[status] || status) + "</span>";
    }
    function renderDetail(data) {
      if (!data) { detail.innerHTML = "<h2>血统档案</h2><p class=\"meta\">点击列表或输入足环号查看。</p>"; return; }
      const p = data.pigeon;
      const pending = data.corrections.find(function(c) { return c.status === "pending"; });
      let html = "<h2>" + esc(p.ringNo) + " 血统档案</h2>"
        + "<div class=\"row\">" + (data.frozen ? '<span class="pill frozen">血统已冻结（旧结论）</span>' : '<span class="pill approved">有效版本 v' + data.activeVersion + "</span>") + corrPill(pending ? "pending" : "") + "</div>"
        + '<div class="section relation"><div class="small"><b>父鸽</b><br>' + (data.father ? esc(data.father.ringNo) : (p.fatherRing ? esc(p.fatherRing) + "（未登记）" : "未登记")) + "</div>"
        + '<div class="small"><b>本鸽</b><br>' + esc(p.owner) + " · " + esc(p.color) + "</div>"
        + '<div class="small"><b>母鸽</b><br>' + (data.mother ? esc(data.mother.ringNo) : (p.motherRing ? esc(p.motherRing) + "（未登记）" : "未登记")) + "</div></div>";
      const kids = (data.pedigree && data.pedigree.children) || [];
      const desc = (data.pedigree && data.pedigree.descendantsWithinThree) || [];
      html += "<div><b>子代</b> " + (kids.map(esc).join("、") || "暂无") + "</div>"
        + '<div class="meta">三代内后代：' + (desc.map(function(d) { return esc(d.ringNo) + "（第" + d.depth + "代）"; }).join("、") || "暂无") + "</div>";

      if (!pending) {
        html += '<form class="section" id="corrForm"><h2>提交血统更正</h2>'
          + "<label>原父鸽足环号</label><input name=\"oldFatherRing\" value=\"" + esc(p.fatherRing || "") + "\">"
          + "<label>原母鸽足环号</label><input name=\"oldMotherRing\" value=\"" + esc(p.motherRing || "") + "\">"
          + "<label>新父鸽足环号（须已登记）</label><input name=\"newFatherRing\" required>"
          + "<label>新母鸽足环号（须已登记）</label><input name=\"newMotherRing\" required>"
          + "<label>更正原因</label><input name=\"reason\" required placeholder=\"如：DNA鉴定 / 原始登记错误\">"
          + '<div class="section"><button>提交待审更正</button></div></form>';
      } else {
        html += '<div class="section small"><b>待审更正 ' + esc(pending.id) + "</b>"
          + "<div class=\"meta\">原：" + esc(pending.oldFatherRing) + " × " + esc(pending.oldMotherRing) + " → 新：" + esc(pending.newFatherRing) + " × " + esc(pending.newMotherRing) + "</div>"
          + '<div class="meta">原因：' + esc(pending.reason) + "</div>"
          + '<div class="row section"><button data-approve="' + esc(pending.id) + '">通过并冻结后代旧血统</button> <button class="danger" data-cancel="' + esc(pending.id) + '">撤销申请</button></div></div>';
      }

      html += '<div class="section"><b>血统版本履历</b><table><tr><th>版本</th><th>状态</th><th>父母</th><th>原因</th></tr>';
      html += (data.versions || []).map(function(v) {
        const st = { active: "有效", frozen: "已冻结", revoked: "已作废", initial: "初版" }[v.status] || v.status;
        return "<tr><td>v" + v.version + "</td><td>" + esc(st) + "</td><td>" + esc(v.parents.fatherRing || "—") + " × " + esc(v.parents.motherRing || "—") + "</td><td>" + esc(v.reason || "") + "</td></tr>";
      }).join("") || "<tr><td colspan=\"4\">暂无版本（首次通过更正时补登初版）</td></tr>";
      html += "</table></div>";

      html += '<div class="section"><b>更正记录</b><table><tr><th>单号</th><th>状态</th><th>原父母→新父母</th><th>原因</th><th>操作</th></tr>';
      html += data.corrections.map(function(c) {
        let action = "";
        if (c.status === "approved") action = '<button class="small danger" data-revoke="' + esc(c.id) + '">撤销（恢复前一版本）</button>';
        return "<tr><td>" + esc(c.id) + "</td><td>" + corrPill(c.status) + "</td><td>" + esc(c.oldFatherRing) + "×" + esc(c.oldMotherRing) + "<br>→ " + esc(c.newFatherRing) + "×" + esc(c.newMotherRing) + "</td><td>" + esc(c.reason) + "</td><td>" + action + "</td></tr>";
      }).join("") || "<tr><td colspan=\"5\">暂无更正</td></tr>";
      html += "</table></div>";

      html += '<div class="section small"><b>转让与成绩</b>'
        + '<label>录入转让（新归属人）</label><div class="row"><input data-to="' + esc(p.ringNo) + '" placeholder="新归属人" style="flex:1"><button class="small" data-transfer="' + esc(p.ringNo) + '">保存转让</button></div>'
        + '<label>归巢成绩（赛事/距离/名次）</label><div class="row"><input data-race="' + esc(p.ringNo) + '" placeholder="200公里/200/6" style="flex:1"><button class="small" data-score="' + esc(p.ringNo) + '">保存成绩</button></div>'
        + '<div class="meta">转让：' + (p.transfers.map(function(t) { return esc(t.from) + "→" + esc(t.to); }).join(" / ") || "暂无") + "</div>"
        + '<div class="meta">归巢：' + (p.races.map(function(r) { return esc(r.event) + " 第" + r.rank + "名"; }).join(" / ") || "暂无") + "</div></div>";

      detail.innerHTML = html;
      bindDetail(p.ringNo);
    }
    function bindDetail(ringNo) {
      const form = document.querySelector("#corrForm");
      if (form) form.onsubmit = async function(event) {
        event.preventDefault();
        const payload = Object.fromEntries(new FormData(form).entries());
        try {
          await api("/api/pigeons/" + encodeURIComponent(ringNo) + "/corrections", { method: "POST", body: JSON.stringify(payload) });
          showOk("更正已提交待审");
        } catch (e) { showError(e.message); }
        await refresh();
      };
      const approve = document.querySelector("[data-approve]");
      if (approve) approve.onclick = async function() {
        try { await api("/api/corrections/" + encodeURIComponent(approve.dataset.approve) + "/approve", { method: "POST" }); showOk("已通过，旧血统结论冻结，三代内子代已按新关系重算"); }
        catch (e) { showError(e.message); }
        await refresh();
      };
      const cancel = document.querySelector("[data-cancel]");
      if (cancel) cancel.onclick = async function() {
        try { await api("/api/corrections/" + encodeURIComponent(cancel.dataset.cancel) + "/revoke", { method: "POST" }); showOk("待审申请已撤销"); }
        catch (e) { showError(e.message); }
        await refresh();
      };
      const revoke = document.querySelector("[data-revoke]");
      if (revoke) revoke.onclick = async function() {
        try { await api("/api/corrections/" + encodeURIComponent(revoke.dataset.revoke) + "/revoke", { method: "POST" }); showOk("已撤销，恢复前一有效版本"); }
        catch (e) { showError(e.message); }
        await refresh();
      };
      const tBtn = document.querySelector("[data-transfer]");
      if (tBtn) tBtn.onclick = async function() {
        const to = document.querySelector("[data-to]").value;
        try { await api("/api/pigeons/" + encodeURIComponent(ringNo) + "/transfers", { method: "POST", body: JSON.stringify({ to }) }); }
        catch (e) { showError(e.message); }
        await refresh();
      };
      const rBtn = document.querySelector("[data-score]");
      if (rBtn) rBtn.onclick = async function() {
        const raw = document.querySelector("[data-race]").value.split("/");
        const payload = { event: raw[0] || "未命名赛事", distance: Number(raw[1] || 0), rank: Number(raw[2] || 0) };
        try { await api("/api/pigeons/" + encodeURIComponent(ringNo) + "/races", { method: "POST", body: JSON.stringify(payload) }); }
        catch (e) { showError(e.message); }
        await refresh();
      };
    }
    async function loadList() {
      pigeons = await api("/api/pigeons");
      renderCards();
    }
    async function loadDetail() {
      if (!selected) { renderDetail(null); return; }
      try { renderDetail(await api("/api/pigeons/" + encodeURIComponent(selected) + "/relation")); }
      catch (e) { selected = ""; renderDetail(null); showError(e.message); renderCards(); }
    }
    async function refresh() {
      await loadList();
      await loadDetail();
    }
    document.querySelector("#searchBtn").onclick = function() {
      const ring = search.value.trim();
      if (!ring) return;
      if (!pigeons.some(function(p) { return p.ringNo === ring; })) { showError(errorText.pigeon_not_found); return; }
      selected = ring;
      refresh();
    };
    document.querySelector("#reload").onclick = function() { clearBanner(); refresh(); };
    document.querySelector("#form").onsubmit = async function(event) {
      event.preventDefault();
      try {
        await api("/api/pigeons", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(document.querySelector("#form")).entries())) });
        document.querySelector("#form").reset();
        showOk("档案已保存");
      } catch (e) { showError(e.message); }
      await loadList();
    };
    refresh();
  </script>
</body>
</html>`;
