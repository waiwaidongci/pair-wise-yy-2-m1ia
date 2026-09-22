// 请求入口模块：HTTP 路由、请求体解析与响应封装。业务判定委托 pedigree，落盘委托 store。
import {
  DomainError,
  findPigeon,
  pigeonSummary,
  pigeonDetail,
  listCorrections,
  createCorrection,
  approveCorrection,
  revokeCorrection
} from "./pedigree.js";
import { page } from "./page.js";

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

const today = () => new Date().toISOString().slice(0, 10);

export function createRouter(store) {
  return async function router(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method;

    if (method === "GET" && path === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(page);
    }

    // 除首页外，每次请求先取最新档案；业务模块校验失败抛 DomainError，不落盘。
    const db = await store.read();

    if (method === "GET" && path === "/api/pigeons") {
      return sendJson(res, 200, db.pigeons.map(pigeon => pigeonSummary(db, pigeon)));
    }

    if (method === "POST" && path === "/api/pigeons") {
      const input = await readBody(req);
      if (!input.ringNo || !input.owner || !input.color || !input.loft) {
        throw new DomainError(400, "missing_required_fields");
      }
      if (findPigeon(db, input.ringNo)) throw new DomainError(409, "ring_exists");
      const pigeon = {
        ringNo: input.ringNo,
        owner: input.owner,
        fatherRing: input.fatherRing || "",
        motherRing: input.motherRing || "",
        color: input.color,
        loft: input.loft,
        vaccines: [],
        transfers: [],
        races: [],
        pedigreeVersions: []
      };
      db.pigeons.unshift(pigeon);
      await store.write(db);
      return sendJson(res, 201, pigeonSummary(db, pigeon));
    }

    const correctionListMatch = path.match(/^\/api\/corrections$/);
    if (method === "GET" && correctionListMatch) {
      return sendJson(res, 200, listCorrections(db, url.searchParams.get("status") || undefined));
    }

    const correctionActionMatch = path.match(/^\/api\/corrections\/(.+)\/(approve|revoke)$/);
    if (correctionActionMatch && method === "POST") {
      const id = decodeURIComponent(correctionActionMatch[1]);
      const corr = correctionActionMatch[2] === "approve"
        ? approveCorrection(db, id)
        : revokeCorrection(db, id);
      await store.write(db);
      return sendJson(res, 200, corr);
    }

    const correctionCreateMatch = path.match(/^\/api\/pigeons\/(.+)\/corrections$/);
    if (correctionCreateMatch && method === "POST") {
      const input = await readBody(req);
      const corr = createCorrection(db, decodeURIComponent(correctionCreateMatch[1]), input);
      await store.write(db);
      return sendJson(res, 201, corr);
    }

    const relationMatch = path.match(/^\/api\/pigeons\/(.+)\/relation$/);
    if (relationMatch && method === "GET") {
      const data = pigeonDetail(db, decodeURIComponent(relationMatch[1]));
      if (!data) throw new DomainError(404, "pigeon_not_found");
      return sendJson(res, 200, data);
    }

    const actionMatch = path.match(/^\/api\/pigeons\/(.+)\/(transfers|races|vaccines)$/);
    if (actionMatch && method === "POST") {
      const pigeon = findPigeon(db, decodeURIComponent(actionMatch[1]));
      if (!pigeon) throw new DomainError(404, "pigeon_not_found");
      const input = await readBody(req);
      if (actionMatch[2] === "transfers") {
        if (!input.to) throw new DomainError(400, "missing_required_fields");
        pigeon.transfers.push({ date: input.date || today(), from: pigeon.owner, to: input.to });
        pigeon.owner = input.to;
      }
      if (actionMatch[2] === "races") {
        pigeon.races.push({ date: input.date || today(), event: input.event, distance: Number(input.distance || 0), returnTime: input.returnTime || "", rank: Number(input.rank || 0) });
      }
      if (actionMatch[2] === "vaccines") {
        pigeon.vaccines.push({ date: input.date || today(), name: input.name });
      }
      await store.write(db);
      return sendJson(res, 200, pigeonDetail(db, pigeon.ringNo));
    }

    throw new DomainError(404, "not_found");
  };
}

export function handleError(res, error) {
  if (error instanceof DomainError) return sendJson(res, error.status, { error: error.code, message: error.message });
  return sendJson(res, 500, { error: "internal_error", message: error.message });
}
