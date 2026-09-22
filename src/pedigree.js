// 血统判定模块：父母关系、后代/祖先遍历、三代结论、血统更正的申请/通过/撤销与版本管理。
// 不接触文件系统，只读写传入的 db 内存对象；是否落盘由入口模块决定。

export class DomainError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

const now = () => new Date().toISOString();

export function findPigeon(db, ringNo) {
  return db.pigeons.find(item => item.ringNo === ringNo) || null;
}

// —— 关系图（始终以当前父母指针为准）——
export function childrenOf(db, ringNo) {
  return db.pigeons.filter(item => item.fatherRing === ringNo || item.motherRing === ringNo);
}

// BFS 求全部后代，返回 Map(ringNo -> 深度，子代=1)；maxDepth 可限制到三代内
export function descendantsByDepth(db, ringNo, maxDepth = Infinity) {
  const result = new Map();
  let frontier = [ringNo];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next = [];
    for (const current of frontier) {
      for (const child of childrenOf(db, current)) {
        if (!result.has(child.ringNo) && child.ringNo !== ringNo) {
          result.set(child.ringNo, depth);
          next.push(child.ringNo);
        }
      }
    }
    frontier = next;
  }
  return result;
}

function ancestorNode(db, ringNo, depth, maxDepth, seen) {
  if (!ringNo) return null;
  const pigeon = findPigeon(db, ringNo);
  const node = { ringNo, registered: Boolean(pigeon) };
  if (depth >= maxDepth || seen.has(ringNo)) return node; // 环保护，防止异常数据成环
  seen.add(ringNo);
  node.father = pigeon ? ancestorNode(db, pigeon.fatherRing, depth + 1, maxDepth, seen) : null;
  node.mother = pigeon ? ancestorNode(db, pigeon.motherRing, depth + 1, maxDepth, seen) : null;
  seen.delete(ringNo);
  return node;
}

// 某羽在当前关系图下的完整血统结论：三代祖先 + 子代 + 三代内后代
export function conclusionFor(db, ringNo) {
  const pigeon = findPigeon(db, ringNo);
  if (!pigeon) return null;
  const descendants = descendantsByDepth(db, ringNo, 3);
  return {
    ringNo,
    fatherRing: pigeon.fatherRing || "",
    motherRing: pigeon.motherRing || "",
    ancestors: {
      father: ancestorNode(db, pigeon.fatherRing, 1, 3, new Set()),
      mother: ancestorNode(db, pigeon.motherRing, 1, 3, new Set())
    },
    children: childrenOf(db, ringNo).map(item => item.ringNo),
    descendantsWithinThree: [...descendants].map(([descRingNo, depth]) => ({ ringNo: descRingNo, depth }))
  };
}

// 实时关系（列表、详情共用同一判定口径）
export function relation(db, ringNo) {
  const pigeon = findPigeon(db, ringNo);
  if (!pigeon) return null;
  return {
    pigeon,
    father: findPigeon(db, pigeon.fatherRing) || null,
    mother: findPigeon(db, pigeon.motherRing) || null,
    children: childrenOf(db, ringNo)
  };
}

// 沿父母链检测：新父母是否会让 target 成为自己的祖先（后代环）
export function createsCycle(db, targetRingNo, newFatherRing, newMotherRing) {
  const walk = (ringNo, seen) => {
    if (!ringNo) return false;
    if (ringNo === targetRingNo) return true;
    if (seen.has(ringNo)) return false;
    seen.add(ringNo);
    const pigeon = findPigeon(db, ringNo);
    if (!pigeon) return false;
    return walk(pigeon.fatherRing, seen) || walk(pigeon.motherRing, seen);
  };
  return walk(newFatherRing, new Set()) || walk(newMotherRing, new Set());
}

// —— 血统版本 ——
// 版本履历 append-only：initial=初版 active=当前有效 frozen=旧结论已冻结 revoked=随更正撤销
function ensureInitialVersion(db, pigeon) {
  if (!pigeon.pedigreeVersions) pigeon.pedigreeVersions = [];
  if (pigeon.pedigreeVersions.length === 0) {
    pigeon.pedigreeVersions.push({
      version: 1,
      status: "active",
      reason: "登记初版血统",
      parents: { fatherRing: pigeon.fatherRing || "", motherRing: pigeon.motherRing || "" },
      conclusion: conclusionFor(db, pigeon.ringNo),
      createdAt: now()
    });
  }
  return pigeon.pedigreeVersions;
}

// 对外血统状态：有有效版本用有效版本；否则回退最近一份未作废结论（超出三代重算范围的后代）
export function pedigreeState(db, ringNo) {
  const pigeon = findPigeon(db, ringNo);
  if (!pigeon) return null;
  const visible = (pigeon.pedigreeVersions || []).filter(v => v.status !== "revoked");
  const active = [...visible].reverse().find(v => v.status === "active") || null;
  const latest = visible.at(-1) || null;
  if (active) {
    return { frozen: false, version: active.version, conclusion: active.conclusion, versions: pigeon.pedigreeVersions };
  }
  if (latest) {
    return { frozen: true, version: latest.version, conclusion: latest.conclusion, versions: pigeon.pedigreeVersions };
  }
  return { frozen: false, version: 0, conclusion: conclusionFor(db, ringNo), versions: pigeon.pedigreeVersions || [] };
}

export function listCorrections(db, status) {
  return status ? db.corrections.filter(item => item.status === status) : db.corrections;
}

// —— 申请血统更正：每羽仅允许一条待审 ——
export function createCorrection(db, ringNo, input = {}) {
  const pigeon = findPigeon(db, ringNo);
  if (!pigeon) throw new DomainError(404, "pigeon_not_found");

  // 五个字段都必须提交；原父母允许为空值（本就未登记），原因必须填写
  const names = ["oldFatherRing", "oldMotherRing", "newFatherRing", "newMotherRing", "reason"];
  if (names.some(name => typeof input[name] !== "string") || !input.reason.trim()) {
    throw new DomainError(400, "missing_required_fields", "须填写原父母、新父母和原因");
  }
  const values = Object.fromEntries(names.map(name => [name, input[name].trim()]));

  if (db.corrections.some(c => c.ringNo === ringNo && c.status === "pending")) {
    throw new DomainError(409, "correction_already_pending", "每羽只允许一条待审更正");
  }
  if (values.oldFatherRing !== (pigeon.fatherRing || "") || values.oldMotherRing !== (pigeon.motherRing || "")) {
    throw new DomainError(409, "original_parent_mismatch", "原父母与档案现状不一致");
  }
  // 新父母缺失：留空或档案中不存在
  if (!values.newFatherRing || !values.newMotherRing ||
      !findPigeon(db, values.newFatherRing) || !findPigeon(db, values.newMotherRing)) {
    throw new DomainError(409, "new_parent_missing", "新父母缺失或未登记");
  }
  if (createsCycle(db, ringNo, values.newFatherRing, values.newMotherRing)) {
    throw new DomainError(409, "descendant_cycle", "新关系会形成后代环");
  }

  db.correctionSeq += 1;
  const correction = {
    id: `CR-${String(db.correctionSeq).padStart(4, "0")}`,
    ringNo,
    status: "pending",
    ...values,
    affectedRings: [],
    recomputedRings: [],
    createdAt: now(),
    approvedAt: null,
    revokedAt: null
  };
  db.corrections.push(correction);
  return correction;
}

// —— 通过更正：冻结旧结论，按新关系生成版本，重算三代内子代 ——
export function approveCorrection(db, correctionId) {
  const corr = db.corrections.find(item => item.id === correctionId);
  if (!corr) throw new DomainError(404, "correction_not_found");
  if (corr.status !== "pending") throw new DomainError(409, "correction_not_pending", "该更正不是待审状态");
  const pigeon = findPigeon(db, corr.ringNo);
  if (!pigeon) throw new DomainError(404, "pigeon_not_found");

  // 通过前按最新档案重新校验，任何一项不满足都整体不生效
  if (corr.oldFatherRing !== (pigeon.fatherRing || "") || corr.oldMotherRing !== (pigeon.motherRing || "")) {
    throw new DomainError(409, "original_parent_mismatch", "原父母与档案现状不一致");
  }
  if (!findPigeon(db, corr.newFatherRing) || !findPigeon(db, corr.newMotherRing)) {
    throw new DomainError(409, "new_parent_missing", "新父母缺失或未登记");
  }
  if (createsCycle(db, corr.ringNo, corr.newFatherRing, corr.newMotherRing)) {
    throw new DomainError(409, "descendant_cycle", "新关系会形成后代环");
  }

  // 变更前求冻结范围（本羽 + 全部后代）与重算范围（三代内，含本羽）
  const allDescendants = descendantsByDepth(db, corr.ringNo);
  const withinThree = descendantsByDepth(db, corr.ringNo, 3);
  const freezeRings = [corr.ringNo, ...allDescendants.keys()];
  const recomputeRings = [corr.ringNo, ...[...withinThree.keys()]];

  // 1. 旧血统结论立即冻结（未建版本的先补登初版，保证旧结论被原样留存）
  for (const ringNo of freezeRings) {
    const target = findPigeon(db, ringNo);
    const versions = ensureInitialVersion(db, target);
    const current = versions.at(-1);
    if (current.status === "active") {
      current.status = "frozen";
      current.frozenBy = corr.id;
      current.frozenAt = now();
    }
  }

  // 2. 切换为新关系
  pigeon.fatherRing = corr.newFatherRing;
  pigeon.motherRing = corr.newMotherRing;

  // 3. 本羽及三代内子代只按新关系生成新版本
  for (const ringNo of recomputeRings) {
    const target = findPigeon(db, ringNo);
    const versions = target.pedigreeVersions || [];
    versions.push({
      version: versions.length + 1,
      status: "active",
      reason: corr.ringNo === ringNo ? `血统更正通过：${corr.reason}` : `上游 ${corr.ringNo} 血统更正，按新关系重算`,
      createdByCorrection: corr.id,
      parents: { fatherRing: target.fatherRing || "", motherRing: target.motherRing || "" },
      conclusion: conclusionFor(db, ringNo),
      createdAt: now()
    });
  }

  corr.status = "approved";
  corr.approvedAt = now();
  corr.affectedRings = freezeRings;
  corr.recomputedRings = recomputeRings;
  return corr;
}

// —— 撤销更正：撤销待审申请；或撤销已通过更正以恢复前一有效版本（仅最近一次）——
export function revokeCorrection(db, correctionId) {
  const corr = db.corrections.find(item => item.id === correctionId);
  if (!corr) throw new DomainError(404, "correction_not_found");

  // 撤销待审申请：不触碰任何血统版本，直接作废，释放该羽的申请名额
  if (corr.status === "pending") {
    corr.status = "revoked";
    corr.revokedAt = now();
    return corr;
  }
  if (corr.status !== "approved") throw new DomainError(409, "correction_not_approved", "该更正未处于通过状态");

  const newerApproved = db.corrections
    .filter(item => item.status === "approved" && item.id !== corr.id)
    .some(item => item.approvedAt && corr.approvedAt && item.approvedAt > corr.approvedAt);
  if (newerApproved) throw new DomainError(409, "newer_correction_exists", "请先撤销更新的已通过更正");

  // 1. 本次生成的新版本作废；本次冻结的旧版本恢复为有效
  for (const ringNo of corr.affectedRings) {
    const target = findPigeon(db, ringNo);
    if (!target) continue;
    for (const version of target.pedigreeVersions || []) {
      if (version.createdByCorrection === corr.id) {
        version.status = "revoked";
        version.revokedBy = corr.id;
        version.revokedAt = now();
      }
      if (version.frozenBy === corr.id) {
        version.status = "active";
        delete version.frozenBy;
        version.reactivatedAt = now();
      }
    }
  }

  // 2. 父母指针恢复到更正前
  const pigeon = findPigeon(db, corr.ringNo);
  if (pigeon) {
    pigeon.fatherRing = corr.oldFatherRing;
    pigeon.motherRing = corr.oldMotherRing;
  }

  corr.status = "revoked";
  corr.revokedAt = now();
  return corr;
}

// —— 对外视图数据（列表、详情、刷新后同一口径）——
export function pigeonSummary(db, pigeon) {
  const state = pedigreeState(db, pigeon.ringNo);
  const pending = db.corrections.find(c => c.ringNo === pigeon.ringNo && c.status === "pending") || null;
  return {
    ringNo: pigeon.ringNo,
    owner: pigeon.owner,
    fatherRing: pigeon.fatherRing || "",
    motherRing: pigeon.motherRing || "",
    color: pigeon.color,
    loft: pigeon.loft,
    frozen: state.frozen,
    activeVersion: state.version,
    hasPendingCorrection: Boolean(pending),
    pendingCorrectionId: pending ? pending.id : null
  };
}

export function pigeonDetail(db, ringNo) {
  const rel = relation(db, ringNo);
  if (!rel) return null;
  const state = pedigreeState(db, ringNo);
  const corrections = db.corrections
    .filter(c => c.ringNo === ringNo)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    ...rel,
    frozen: state.frozen,
    activeVersion: state.version,
    pedigree: state.conclusion,
    versions: state.versions,
    corrections
  };
}
