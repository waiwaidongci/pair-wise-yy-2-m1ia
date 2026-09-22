// 血统判定模块：血统版本、更正单校验、通过与撤销、三代内子代重算。
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const RECALCULATE_GENERATIONS = 3;

const nowIso = () => new Date().toISOString();
const idNumber = (id) => Number(String(id).split("-")[1] || 0);
const nextId = (items, prefix) => `${prefix}-${String(items.length + 1).padStart(4, "0")}`;

// 规范化档案：补齐集合字段，并为没有版本的老档案补一条“登记”血统版本。
export function normalizeDb(db) {
  db.pigeons = Array.isArray(db.pigeons) ? db.pigeons : [];
  db.corrections = Array.isArray(db.corrections) ? db.corrections : [];
  db.pedigreeVersions = Array.isArray(db.pedigreeVersions) ? db.pedigreeVersions : [];
  for (const pigeon of db.pigeons) {
    pigeon.vaccines = Array.isArray(pigeon.vaccines) ? pigeon.vaccines : [];
    pigeon.transfers = Array.isArray(pigeon.transfers) ? pigeon.transfers : [];
    pigeon.races = Array.isArray(pigeon.races) ? pigeon.races : [];
    if (!db.pedigreeVersions.some(v => v.ringNo === pigeon.ringNo)) {
      db.pedigreeVersions.push({
        id: nextId(db.pedigreeVersions, "PV"),
        ringNo: pigeon.ringNo,
        fatherRing: pigeon.fatherRing || "",
        motherRing: pigeon.motherRing || "",
        status: "active",
        basis: "registration",
        generation: 0,
        createdAt: nowIso()
      });
    }
  }
  return db;
}

export function activeVersion(db, ringNo) {
  return db.pedigreeVersions.find(v => v.ringNo === ringNo && v.status === "active") || null;
}

// 当前用于血统展示与谱系遍历的版本：生效中优先，否则取最近一条未撤销结论（已冻结）。
export function lineageVersion(db, ringNo) {
  const active = activeVersion(db, ringNo);
  if (active) return active;
  const rest = db.pedigreeVersions
    .filter(v => v.ringNo === ringNo && v.status !== "revoked")
    .sort((a, b) => idNumber(b.id) - idNumber(a.id));
  return rest[0] || null;
}

export function childrenOf(db, ringNo) {
  return db.pigeons
    .filter(pigeon => {
      const version = lineageVersion(db, pigeon.ringNo);
      return version && (version.fatherRing === ringNo || version.motherRing === ringNo);
    })
    .map(pigeon => pigeon.ringNo);
}

// 全部后代（按世代标注深度），带访问集合防止既有数据成环时死循环。
export function descendantsOf(db, ringNo) {
  const result = [];
  const visited = new Set([ringNo]);
  let frontier = [ringNo];
  let depth = 0;
  while (frontier.length) {
    depth += 1;
    const next = [];
    for (const current of frontier) {
      for (const child of childrenOf(db, current)) {
        if (visited.has(child)) continue;
        visited.add(child);
        result.push({ ringNo: child, depth });
        next.push(child);
      }
    }
    frontier = next;
  }
  return result;
}

export function listPigeons(db) {
  return db.pigeons.map(pigeon => {
    const version = lineageVersion(db, pigeon.ringNo);
    return {
      ...pigeon,
      fatherRing: version ? version.fatherRing : "",
      motherRing: version ? version.motherRing : "",
      pedigreeStatus: version && version.status === "active" ? "active" : "frozen",
      pendingCorrection: db.corrections.some(c => c.ringNo === pigeon.ringNo && c.status === "pending")
    };
  });
}

export function relation(db, ringNo) {
  const pigeon = db.pigeons.find(item => item.ringNo === ringNo);
  if (!pigeon) return null;
  const version = lineageVersion(db, ringNo);
  const fatherRing = version ? version.fatherRing : "";
  const motherRing = version ? version.motherRing : "";
  const childRings = new Set(childrenOf(db, ringNo));
  return {
    pigeon: { ...pigeon, fatherRing, motherRing },
    version,
    frozen: !version || version.status !== "active",
    father: db.pigeons.find(item => item.ringNo === fatherRing) || null,
    mother: db.pigeons.find(item => item.ringNo === motherRing) || null,
    children: db.pigeons.filter(item => childRings.has(item.ringNo)),
    pendingCorrection: db.corrections.find(c => c.ringNo === ringNo && c.status === "pending") || null
  };
}

export function versionsOf(db, ringNo) {
  return db.pedigreeVersions
    .filter(v => v.ringNo === ringNo)
    .sort((a, b) => idNumber(b.id) - idNumber(a.id));
}

export function listCorrections(db, status) {
  return db.corrections
    .filter(c => !status || c.status === status)
    .slice()
    .sort((a, b) => idNumber(b.id) - idNumber(a.id));
}

export function createPigeon(db, input) {
  const ringNo = String(input.ringNo || "").trim();
  if (!ringNo) throw new HttpError(409, "ring_required", "必须填写足环号");
  if (db.pigeons.some(item => item.ringNo === ringNo)) throw new HttpError(409, "ring_exists", "足环号已存在");
  const pigeon = {
    ringNo,
    owner: String(input.owner || "").trim(),
    fatherRing: String(input.fatherRing || "").trim(),
    motherRing: String(input.motherRing || "").trim(),
    color: String(input.color || "").trim(),
    loft: String(input.loft || "").trim(),
    vaccines: [],
    transfers: [],
    races: []
  };
  db.pigeons.unshift(pigeon);
  db.pedigreeVersions.push({
    id: nextId(db.pedigreeVersions, "PV"),
    ringNo,
    fatherRing: pigeon.fatherRing,
    motherRing: pigeon.motherRing,
    status: "active",
    basis: "registration",
    generation: 0,
    createdAt: nowIso()
  });
  return pigeon;
}

// 提交更正单：全部校验通过才落库，任一 409 规则命中则整段不保存。
export function submitCorrection(db, ringNo, input) {
  const pigeon = db.pigeons.find(item => item.ringNo === ringNo);
  if (!pigeon) throw new HttpError(404, "pigeon_not_found", "鸽只不存在");
  const oldFatherRing = String(input.oldFatherRing || "").trim();
  const oldMotherRing = String(input.oldMotherRing || "").trim();
  const newFatherRing = String(input.newFatherRing || "").trim();
  const newMotherRing = String(input.newMotherRing || "").trim();
  const reason = String(input.reason || "").trim();
  if (!reason) throw new HttpError(409, "reason_required", "必须填写更正原因");
  if (!newFatherRing || !newMotherRing) throw new HttpError(409, "new_parents_required", "必须填写新父鸽和新母鸽足环号");
  for (const parent of [newFatherRing, newMotherRing]) {
    if (!db.pigeons.some(item => item.ringNo === parent)) {
      throw new HttpError(409, "new_parent_not_found", `新父母 ${parent} 未登记在册`);
    }
  }
  if (db.corrections.some(c => c.ringNo === ringNo && c.status === "pending")) {
    throw new HttpError(409, "pending_correction_exists", "该羽已存在待审更正，每羽只允许一条");
  }
  const descendants = new Set(descendantsOf(db, ringNo).map(item => item.ringNo));
  if (newFatherRing === ringNo || newMotherRing === ringNo || descendants.has(newFatherRing) || descendants.has(newMotherRing)) {
    throw new HttpError(409, "pedigree_cycle", "新父母为本羽或其后代，会形成后代环");
  }
  const current = lineageVersion(db, ringNo);
  if ((current ? current.fatherRing : "") !== oldFatherRing || (current ? current.motherRing : "") !== oldMotherRing) {
    throw new HttpError(409, "old_parents_mismatch", "原父母与当前生效血统不一致");
  }
  const correction = {
    id: nextId(db.corrections, "CORR"),
    ringNo,
    oldFatherRing,
    oldMotherRing,
    newFatherRing,
    newMotherRing,
    reason,
    status: "pending",
    affected: [],
    createdAt: nowIso(),
    approvedAt: null,
    revokedAt: null
  };
  db.corrections.push(correction);
  return correction;
}

// 通过更正：该羽及全部后代旧结论立即冻结，只按新关系生成版本，并重算三代内子代。
export function approveCorrection(db, correctionId) {
  const correction = db.corrections.find(c => c.id === correctionId);
  if (!correction) throw new HttpError(404, "correction_not_found", "更正单不存在");
  if (correction.status !== "pending") throw new HttpError(409, "correction_not_pending", "只有待审更正可以通过");
  const at = nowIso();
  const affected = [{ ringNo: correction.ringNo, depth: 0 }, ...descendantsOf(db, correction.ringNo)];
  for (const { ringNo } of affected) {
    const version = activeVersion(db, ringNo);
    if (version) {
      version.status = "frozen";
      version.frozenBy = correction.id;
      version.frozenAt = at;
    }
  }
  db.pedigreeVersions.push({
    id: nextId(db.pedigreeVersions, "PV"),
    ringNo: correction.ringNo,
    fatherRing: correction.newFatherRing,
    motherRing: correction.newMotherRing,
    status: "active",
    basis: correction.id,
    generation: 0,
    createdAt: at
  });
  for (const { ringNo, depth } of affected) {
    if (depth < 1 || depth > RECALCULATE_GENERATIONS) continue;
    const previous = lineageVersion(db, ringNo);
    db.pedigreeVersions.push({
      id: nextId(db.pedigreeVersions, "PV"),
      ringNo,
      fatherRing: previous ? previous.fatherRing : "",
      motherRing: previous ? previous.motherRing : "",
      status: "active",
      basis: correction.id,
      generation: depth,
      createdAt: at
    });
  }
  correction.status = "approved";
  correction.approvedAt = at;
  correction.affected = affected.map(item => item.ringNo);
  return correction;
}

// 撤销更正：作废本次生成的版本，恢复前一有效版本。
export function revokeCorrection(db, correctionId) {
  const correction = db.corrections.find(c => c.id === correctionId);
  if (!correction) throw new HttpError(404, "correction_not_found", "更正单不存在");
  if (correction.status === "revoked") throw new HttpError(409, "correction_not_revocable", "已撤销的更正不能重复撤销");
  const at = nowIso();
  if (correction.status === "approved") {
    for (const version of db.pedigreeVersions.filter(v => v.basis === correction.id && v.status === "active")) {
      version.status = "revoked";
      version.revokedAt = at;
    }
    for (const version of db.pedigreeVersions.filter(v => v.frozenBy === correction.id && v.status === "frozen")) {
      const hasActive = db.pedigreeVersions.some(v => v.ringNo === version.ringNo && v.status === "active");
      if (!hasActive) {
        version.status = "active";
        version.restoredAt = at;
      }
    }
  }
  correction.status = "revoked";
  correction.revokedAt = at;
  return correction;
}

export function appendPigeonRecord(db, ringNo, kind, input) {
  const pigeon = db.pigeons.find(item => item.ringNo === ringNo);
  if (!pigeon) throw new HttpError(404, "pigeon_not_found", "鸽只不存在");
  const date = input.date || new Date().toISOString().slice(0, 10);
  if (kind === "transfers") {
    pigeon.transfers.push({ date, from: pigeon.owner, to: input.to });
    pigeon.owner = input.to;
  }
  if (kind === "races") pigeon.races.push({ date, event: input.event, distance: Number(input.distance || 0), returnTime: input.returnTime || "", rank: Number(input.rank || 0) });
  if (kind === "vaccines") pigeon.vaccines.push({ date, name: input.name });
  return pigeon;
}
