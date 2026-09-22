// 冒烟测试：临时数据文件 + 独立端口启动服务，验证更正规则、冻结、重算与撤销恢复。
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dbFile = join(mkdtempSync(join(tmpdir(), "pigeon-")), "db.json");
const port = 3917;
const base = `http://localhost:${port}`;
const child = spawn("node", [join(root, "server.js")], {
  env: { ...process.env, PORT: String(port), PIGEON_DB_PATH: dbFile },
  stdio: ["ignore", "pipe", "inherit"]
});

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log("ok -", name);
  else { failures += 1; console.error("FAIL -", name, extra ?? ""); }
}
const json = (res) => res.json();
const post = (path, payload) => fetch(base + path, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload ?? {})
});
const mk = (ringNo, fatherRing = "", motherRing = "") =>
  post("/api/pigeons", { ringNo, owner: "测试棚", fatherRing, motherRing, color: "灰", loft: "T棚" }).then(r => r.status);

async function waitUp() {
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(base + "/api/pigeons")).ok) return; } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("server did not start");
}

try {
  await waitUp();

  const html = await fetch(base + "/").then(r => r.text());
  check("页面可访问", html.includes("血统更正与后代冻结台"));

  let list = await fetch(base + "/api/pigeons").then(json);
  check("种子档案 3 羽", list.length === 3);
  check("列表血统取自生效版本", list.find(p => p.ringNo === "CHN-2026-001").fatherRing === "CHN-2022-188");
  check("列表默认生效状态", list.every(p => p.pedigreeStatus === "active" && p.pendingCorrection === false));

  // 五代链 G1→G5，新父母 NF/NM
  for (const [ring, f, m] of [["NF"], ["NM"], ["G1", "OLD-F", "OLD-M"], ["G2", "G1"], ["G3", "G2"], ["G4", "G3"], ["G5", "G4"]]) {
    check(`建档 ${ring}`, (await mk(ring, f, m)) === 201);
  }

  // —— 409 规则：整段不保存 ——
  let res = await post("/api/pigeons/G1/corrections", { oldFatherRing: "OLD-F", oldMotherRing: "OLD-M", newFatherRing: "NF", reason: "缺新母" });
  check("新父母缺失 → 409", res.status === 409 && (await json(res)).error === "new_parents_required");

  res = await post("/api/pigeons/G1/corrections", { oldFatherRing: "OLD-F", oldMotherRing: "OLD-M", newFatherRing: "NF", newMotherRing: "GHOST", reason: "新母未登记" });
  check("新父母未登记 → 409", res.status === 409 && (await json(res)).error === "new_parent_not_found");

  res = await post("/api/pigeons/G1/corrections", { oldFatherRing: "OLD-F", oldMotherRing: "OLD-M", newFatherRing: "NF", newMotherRing: "G3", reason: "后代环" });
  check("后代环 → 409", res.status === 409 && (await json(res)).error === "pedigree_cycle");

  res = await post("/api/pigeons/G1/corrections", { oldFatherRing: "OLD-F", oldMotherRing: "OLD-M", newFatherRing: "NF", newMotherRing: "NM", reason: "" });
  check("原因缺失 → 409", res.status === 409 && (await json(res)).error === "reason_required");

  res = await post("/api/pigeons/G1/corrections", { oldFatherRing: "WRONG", oldMotherRing: "OLD-M", newFatherRing: "NF", newMotherRing: "NM", reason: "原父母不符" });
  check("原父母不符 → 409", res.status === 409 && (await json(res)).error === "old_parents_mismatch");

  res = await post("/api/pigeons/NOPE/corrections", { oldFatherRing: "", oldMotherRing: "", newFatherRing: "NF", newMotherRing: "NM", reason: "无此羽" });
  check("鸽只不存在 → 404", res.status === 404);

  let corrections = await fetch(base + "/api/corrections").then(json);
  check("连续 409 后整段未保存", corrections.length === 0, JSON.stringify(corrections));

  // —— 合法更正：每羽只允许一条待审 ——
  res = await post("/api/pigeons/G1/corrections", { oldFatherRing: "OLD-F", oldMotherRing: "OLD-M", newFatherRing: "NF", newMotherRing: "NM", reason: "足环录入错误，按血统书更正" });
  check("提交更正 → 201", res.status === 201);
  const corr = await json(res);
  check("更正单待审", corr.status === "pending");

  res = await post("/api/pigeons/G1/corrections", { oldFatherRing: "OLD-F", oldMotherRing: "OLD-M", newFatherRing: "NF", newMotherRing: "NM", reason: "第二条" });
  check("已有待审 → 409", res.status === 409 && (await json(res)).error === "pending_correction_exists");

  // —— 通过：冻结 + 新关系版本 + 三代内重算 ——
  res = await post(`/api/corrections/${corr.id}/approve`);
  check("通过更正 → 200", res.status === 200);
  check("影响范围含本羽与全部后代", (await json(res)).affected.join(",") === "G1,G2,G3,G4,G5");

  let rel = await fetch(base + "/api/pigeons/G1/relation").then(json);
  check("本羽按新关系生效", rel.pigeon.fatherRing === "NF" && rel.pigeon.motherRing === "NM" && rel.frozen === false);

  let versions = await fetch(base + "/api/pigeons/G1/versions").then(json);
  check("本羽旧结论已冻结", versions.some(v => v.basis === "registration" && v.status === "frozen" && v.fatherRing === "OLD-F"));
  check("本羽新版本生效", versions.some(v => v.basis === corr.id && v.status === "active" && v.fatherRing === "NF"));

  for (const [ring, depth] of [["G2", 1], ["G3", 2], ["G4", 3]]) {
    const vv = await fetch(base + `/api/pigeons/${ring}/versions`).then(json);
    check(`第${depth}代 ${ring} 已重算`, vv.some(v => v.basis === corr.id && v.status === "active" && v.generation === depth), JSON.stringify(vv));
    check(`第${depth}代 ${ring} 旧版本冻结`, vv.some(v => v.basis === "registration" && v.status === "frozen"));
  }
  const g5Versions = await fetch(base + "/api/pigeons/G5/versions").then(json);
  check("第四代 G5 不重算（无生效版本）", !g5Versions.some(v => v.status === "active"));
  check("第四代 G5 旧结论冻结", g5Versions.some(v => v.status === "frozen"));

  const g5Rel = await fetch(base + "/api/pigeons/G5/relation").then(json);
  check("G5 详情标记冻结", g5Rel.frozen === true);

  list = await fetch(base + "/api/pigeons").then(json);
  check("列表与详情一致（G1 新父母）", list.find(p => p.ringNo === "G1").fatherRing === "NF");
  check("列表与详情一致（G5 冻结）", list.find(p => p.ringNo === "G5").pedigreeStatus === "frozen");
  check("列表与详情一致（G2 生效）", list.find(p => p.ringNo === "G2").pedigreeStatus === "active");

  res = await post(`/api/corrections/${corr.id}/approve`);
  check("重复通过 → 409", res.status === 409 && (await json(res)).error === "correction_not_pending");

  // —— 撤销：恢复前一有效版本 ——
  res = await post(`/api/corrections/${corr.id}/revoke`);
  check("撤销更正 → 200", res.status === 200);

  rel = await fetch(base + "/api/pigeons/G1/relation").then(json);
  check("撤销后本羽恢复原父母", rel.pigeon.fatherRing === "OLD-F" && rel.pigeon.motherRing === "OLD-M" && rel.frozen === false);
  versions = await fetch(base + "/api/pigeons/G1/versions").then(json);
  check("更正版本已作废", versions.filter(v => v.basis === corr.id).every(v => v.status === "revoked"));
  check("登记版本恢复生效", versions.some(v => v.basis === "registration" && v.status === "active"));

  const g5After = await fetch(base + "/api/pigeons/G5/relation").then(json);
  check("撤销后 G5 恢复生效", g5After.frozen === false);
  list = await fetch(base + "/api/pigeons").then(json);
  check("撤销后列表一致（G1 原父母）", list.find(p => p.ringNo === "G1").fatherRing === "OLD-F");
  check("撤销后列表一致（G5 生效）", list.find(p => p.ringNo === "G5").pedigreeStatus === "active");

  res = await post(`/api/corrections/${corr.id}/revoke`);
  check("重复撤销 → 409", res.status === 409 && (await json(res)).error === "correction_not_revocable");

  // —— 撤销待审单：不动版本 ——
  res = await post("/api/pigeons/G2/corrections", { oldFatherRing: "G1", oldMotherRing: "", newFatherRing: "NF", newMotherRing: "NM", reason: "待审直接撤销" });
  check("撤销后可再次提交", res.status === 201);
  const corr2 = await json(res);
  res = await post(`/api/corrections/${corr2.id}/revoke`);
  check("撤销待审单 → 200", res.status === 200);
  const g2Versions = await fetch(base + "/api/pigeons/G2/versions").then(json);
  check("撤销待审单不产生版本", !g2Versions.some(v => v.basis === corr2.id));
  const g2Rel = await fetch(base + "/api/pigeons/G2/relation").then(json);
  check("G2 血统未受影响", g2Rel.pigeon.fatherRing === "G1" && g2Rel.frozen === false);

  // —— 落盘一致性 ——
  const saved = JSON.parse(readFileSync(dbFile, "utf8"));
  check("更正单已落盘", saved.corrections.length === 2 && saved.corrections.every(c => c.status === "revoked"));
  check("血统版本已落盘", saved.pedigreeVersions.length >= 12);
} finally {
  child.kill();
}

console.log(failures ? `\n${failures} 项失败` : "\n全部通过");
process.exit(failures ? 1 : 0);
