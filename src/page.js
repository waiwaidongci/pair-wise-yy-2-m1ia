// 页面视图：由请求入口返回，列表、详情、审批台数据全部来自同一套接口。
export const page = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>赛鸽血统更正与后代冻结台</title>
  <style>
    :root { --bg:#eff2f5; --panel:#fff; --ink:#1f2833; --muted:#697786; --line:#d3dce4; --accent:#315f83; --red:#9b3f35; --green:#2c6e49; --amber:#8a5a13; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } main { display:grid; grid-template-columns:400px 1fr; gap:22px; padding:22px 28px; }
    aside { display:grid; gap:22px; align-content:start; }
    form,.panel,.card,.stat { background:#fff; border:1px solid var(--line); border-radius:8px; padding:16px; } h2 { margin:0 0 12px; font-size:18px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; }
    button.ghost { background:#fff; color:var(--accent); border:1px solid var(--accent); }
    .toolbar { display:grid; grid-template-columns:1fr auto; gap:10px; margin-bottom:14px; } .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; }
    .card { display:grid; gap:8px; } .card h3 { margin:0; } .meta { color:var(--muted); font-size:13px; }
    .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .pill.green { background:#e7f4ec; color:var(--green); border-color:#bcd9c6; }
    .pill.red { background:#f9e9e7; color:var(--red); border-color:#e4bcb6; }
    .pill.amber { background:#fdf3e0; color:var(--amber); border-color:#ecd3a3; }
    .section { margin-top:14px; } .relation { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:14px; } .small { background:#f8fafb; border:1px solid var(--line); border-radius:8px; padding:10px; }
    .corr { display:grid; gap:6px; margin-bottom:10px; } .actions { display:flex; gap:8px; margin-top:4px; }
    .corrform { display:grid; grid-template-columns:1fr 1fr; gap:0 12px; } #corrBtn { margin-top:10px; }
    table { width:100%; border-collapse:collapse; font-size:13px; margin-top:4px; }
    th,td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); } th { color:var(--muted); font-weight:600; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} .relation{grid-template-columns:1fr;} .corrform{grid-template-columns:1fr;} }
  </style>
</head>
<body>
  <header><div><h1>赛鸽血统更正与后代冻结台</h1><div class="meta">档案登记 · 血统更正审批 · 后代冻结 · 版本恢复</div></div><button id="reload">刷新</button></header>
  <main>
    <aside>
      <form id="form">
        <h2>创建鸽只档案</h2>
        <label>足环号</label><input name="ringNo" required>
        <label>鸽主</label><input name="owner" required>
        <label>父鸽足环号</label><input name="fatherRing">
        <label>母鸽足环号</label><input name="motherRing">
        <label>羽色</label><input name="color" required>
        <label>出生棚号</label><input name="loft" required>
        <button>保存档案</button>
      </form>
      <div class="panel" id="corrections"></div>
    </aside>
    <section>
      <div class="toolbar"><input id="search" placeholder="输入足环号查询血统"><button id="searchBtn">查询</button></div>
      <div class="panel" id="detail"></div>
      <div class="section grid" id="cards"></div>
    </section>
  </main>
  <script>
    const state = { pigeons: [], corrections: [], currentRing: "", relation: null, versions: [] };
    const cards = document.querySelector("#cards");
    const detail = document.querySelector("#detail");
    const correctionsBox = document.querySelector("#corrections");
    const search = document.querySelector("#search");
    const form = document.querySelector("#form");
    const versionStatus = { active: ["生效中", "green"], frozen: ["已冻结", "red"], revoked: ["已撤销", ""] };
    const corrStatus = { pending: ["待审", "amber"], approved: ["已通过", "green"], revoked: ["已撤销", ""] };
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers: { "Content-Type": "application/json" } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "请求失败");
      return data;
    }
    async function run(task) { try { await task(); } catch (error) { alert(error.message); } }
    function pill(text, tone) { return '<span class="pill ' + (tone || "") + '">' + text + '</span>'; }
    function fmtTime(value) { return (value || "").slice(0, 19).replace("T", " "); }
    function renderCards() {
      cards.innerHTML = state.pigeons.map(p =>
        '<article class="card"><h3>' + p.ringNo + '</h3><div>' + pill(p.owner, "") +
        (p.pedigreeStatus === "frozen" ? pill("血统已冻结", "red") : pill("血统生效中", "green")) +
        (p.pendingCorrection ? pill("有待审更正", "amber") : "") + '</div>' +
        '<div class="meta">' + p.color + ' · ' + p.loft + '</div>' +
        '<div>父：' + (p.fatherRing || "未登记") + '</div><div>母：' + (p.motherRing || "未登记") + '</div>' +
        '<button data-detail="' + p.ringNo + '">查看血统</button>' +
        '<label>录入转让</label><input data-to="' + p.ringNo + '" placeholder="新归属人"><button data-transfer="' + p.ringNo + '">保存转让</button>' +
        '<label>归巢成绩</label><input data-race="' + p.ringNo + '" placeholder="赛事/距离/名次，如200公里/200/6"><button data-score="' + p.ringNo + '">保存成绩</button></article>'
      ).join("");
      document.querySelectorAll("[data-detail]").forEach(btn => btn.onclick = () => run(() => loadDetail(btn.dataset.detail)));
      document.querySelectorAll("[data-transfer]").forEach(btn => btn.onclick = () => run(async () => {
        const ringNo = btn.dataset.transfer;
        const to = document.querySelector('[data-to="' + ringNo + '"]').value;
        await api('/api/pigeons/' + encodeURIComponent(ringNo) + '/transfers', { method: 'POST', body: JSON.stringify({ to }) });
        await load();
      }));
      document.querySelectorAll("[data-score]").forEach(btn => btn.onclick = () => run(async () => {
        const ringNo = btn.dataset.score;
        const raw = document.querySelector('[data-race="' + ringNo + '"]').value.split("/");
        await api('/api/pigeons/' + encodeURIComponent(ringNo) + '/races', { method: 'POST', body: JSON.stringify({ event: raw[0] || "未命名赛事", distance: Number(raw[1] || 0), rank: Number(raw[2] || 0) }) });
        await load();
      }));
    }
    function renderCorrections() {
      if (!state.corrections.length) {
        correctionsBox.innerHTML = '<h2>更正审批台</h2><p class="meta">暂无更正单。提交后在这里通过或撤销。</p>';
        return;
      }
      correctionsBox.innerHTML = '<h2>更正审批台</h2>' + state.corrections.map(c => {
        const st = corrStatus[c.status] || [c.status, ""];
        return '<div class="small corr"><div><b>' + c.id + '</b> · ' + c.ringNo + ' ' + pill(st[0], st[1]) + '</div>' +
          '<div class="meta">原父母 ' + (c.oldFatherRing || "未登记") + ' / ' + (c.oldMotherRing || "未登记") + ' → 新父母 ' + c.newFatherRing + ' / ' + c.newMotherRing + '</div>' +
          '<div class="meta">原因：' + c.reason + '</div>' +
          (c.status === "approved" && c.affected && c.affected.length ? '<div class="meta">冻结并重算范围：' + c.affected.join("、") + '</div>' : '') +
          '<div class="actions">' +
          (c.status === "pending" ? '<button data-approve="' + c.id + '">通过</button>' : '') +
          (c.status !== "revoked" ? '<button class="ghost" data-revoke="' + c.id + '">撤销</button>' : '') +
          '</div></div>';
      }).join("");
      document.querySelectorAll("[data-approve]").forEach(btn => btn.onclick = () => run(async () => {
        await api('/api/corrections/' + btn.dataset.approve + '/approve', { method: "POST" });
        await load();
      }));
      document.querySelectorAll("[data-revoke]").forEach(btn => btn.onclick = () => run(async () => {
        await api('/api/corrections/' + btn.dataset.revoke + '/revoke', { method: "POST" });
        await load();
      }));
    }
    function renderVersions() {
      if (!state.versions.length) return '<p class="meta">暂无血统版本。</p>';
      const rows = state.versions.map(v => {
        const st = versionStatus[v.status] || [v.status, ""];
        return '<tr><td>' + v.id + '</td><td>' + (v.fatherRing || "—") + '</td><td>' + (v.motherRing || "—") + '</td><td>' + pill(st[0], st[1]) + '</td>' +
          '<td>' + v.basis + (v.generation ? ' · 第' + v.generation + '代子代' : '') + '</td><td class="meta">' + fmtTime(v.createdAt) + '</td></tr>';
      }).join("");
      return '<table><tr><th>版本</th><th>父</th><th>母</th><th>状态</th><th>依据</th><th>生成时间</th></tr>' + rows + '</table>';
    }
    function renderDetail() {
      const data = state.relation;
      if (!data) {
        detail.innerHTML = '<h2>血统查询</h2><p class="meta">请输入足环号查看父母、子代、血统版本，并提交血统更正。</p>';
        return;
      }
      const p = data.pigeon;
      const v = data.version || { fatherRing: "", motherRing: "" };
      detail.innerHTML =
        '<h2>' + p.ringNo + ' 血统档案 ' + (data.frozen ? pill("血统已冻结", "red") : pill("血统生效中", "green")) +
        (data.pendingCorrection ? pill("待审更正 " + data.pendingCorrection.id, "amber") : "") + '</h2>' +
        '<div class="relation"><div class="small"><b>父鸽</b><br>' + ((data.father && data.father.ringNo) || v.fatherRing || "未登记") + '</div>' +
        '<div class="small"><b>本鸽</b><br>' + p.owner + ' · ' + p.color + '</div>' +
        '<div class="small"><b>母鸽</b><br>' + ((data.mother && data.mother.ringNo) || v.motherRing || "未登记") + '</div></div>' +
        '<div><b>子代</b> ' + (data.children.map(c => c.ringNo).join("、") || "暂无") + '</div>' +
        '<div class="meta">转让：' + (p.transfers.map(t => t.from + "→" + t.to).join(" / ") || "暂无") + '　归巢：' + (p.races.map(r => r.event + " 第" + r.rank + "名").join(" / ") || "暂无") + '</div>' +
        '<div class="section"><h2>提交血统更正</h2>' +
        (data.pendingCorrection ? '<p class="meta">该羽已存在待审更正（' + data.pendingCorrection.id + '），每羽只允许一条，需先通过或撤销。</p>' : '') +
        '<div class="corrform"><div><label>原父鸽足环号</label><input id="oldF" value="' + (v.fatherRing || "") + '"><label>原母鸽足环号</label><input id="oldM" value="' + (v.motherRing || "") + '"></div>' +
        '<div><label>新父鸽足环号</label><input id="newF" placeholder="必填，须已登记"><label>新母鸽足环号</label><input id="newM" placeholder="必填，须已登记"></div></div>' +
        '<label>更正原因</label><input id="reason" placeholder="必填，说明血统更正依据"><button id="corrBtn">提交更正单</button></div>' +
        '<div class="section"><h2>血统版本</h2>' + renderVersions() + '</div>';
      document.querySelector("#corrBtn").onclick = () => run(async () => {
        const payload = {
          oldFatherRing: document.querySelector("#oldF").value.trim(),
          oldMotherRing: document.querySelector("#oldM").value.trim(),
          newFatherRing: document.querySelector("#newF").value.trim(),
          newMotherRing: document.querySelector("#newM").value.trim(),
          reason: document.querySelector("#reason").value.trim()
        };
        await api('/api/pigeons/' + encodeURIComponent(state.currentRing) + '/corrections', { method: "POST", body: JSON.stringify(payload) });
        await load();
      });
    }
    async function loadDetail(ringNo) {
      const relation = await api('/api/pigeons/' + encodeURIComponent(ringNo) + '/relation');
      const versions = await api('/api/pigeons/' + encodeURIComponent(ringNo) + '/versions');
      state.currentRing = ringNo;
      state.relation = relation;
      state.versions = versions;
      renderDetail();
    }
    async function load() {
      state.pigeons = await api("/api/pigeons");
      state.corrections = await api("/api/corrections");
      renderCards();
      renderCorrections();
      if (state.currentRing) await loadDetail(state.currentRing);
      else renderDetail();
    }
    document.querySelector("#searchBtn").onclick = () => {
      const ringNo = search.value.trim();
      if (ringNo) run(() => loadDetail(ringNo));
    };
    document.querySelector("#reload").onclick = () => run(load);
    form.onsubmit = event => {
      event.preventDefault();
      run(async () => {
        await api("/api/pigeons", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
        form.reset();
        await load();
      });
    };
    run(load);
  </script>
</body>
</html>`;
