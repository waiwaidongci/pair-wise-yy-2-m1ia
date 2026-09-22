// 请求入口模块：HTTP 路由、请求解析、统一错误响应；业务规则在血统判定模块，读写走档案存储模块。
import http from "node:http";
import { loadDb, saveDb } from "./src/store.js";
import {
  HttpError,
  listPigeons,
  createPigeon,
  relation,
  versionsOf,
  submitCorrection,
  listCorrections,
  approveCorrection,
  revokeCorrection,
  appendPigeonRecord
} from "./src/pedigree.js";
import { page } from "./src/page.js";

const port = Number(process.env.PORT || 3024);

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(page);
    }
    const db = await loadDb();
    if (req.method === "GET" && url.pathname === "/api/pigeons") return sendJson(res, 200, listPigeons(db));
    if (req.method === "POST" && url.pathname === "/api/pigeons") {
      const pigeon = createPigeon(db, await body(req));
      await saveDb(db);
      return sendJson(res, 201, pigeon);
    }
    const relationMatch = url.pathname.match(/^\/api\/pigeons\/(.+)\/relation$/);
    if (relationMatch && req.method === "GET") {
      const data = relation(db, decodeURIComponent(relationMatch[1]));
      return data ? sendJson(res, 200, data) : sendJson(res, 404, { error: "pigeon_not_found", message: "鸽只不存在" });
    }
    const versionsMatch = url.pathname.match(/^\/api\/pigeons\/(.+)\/versions$/);
    if (versionsMatch && req.method === "GET") {
      const ringNo = decodeURIComponent(versionsMatch[1]);
      if (!db.pigeons.some(item => item.ringNo === ringNo)) return sendJson(res, 404, { error: "pigeon_not_found", message: "鸽只不存在" });
      return sendJson(res, 200, versionsOf(db, ringNo));
    }
    const correctionMatch = url.pathname.match(/^\/api\/pigeons\/(.+)\/corrections$/);
    if (correctionMatch && req.method === "POST") {
      const correction = submitCorrection(db, decodeURIComponent(correctionMatch[1]), await body(req));
      await saveDb(db);
      return sendJson(res, 201, correction);
    }
    if (req.method === "GET" && url.pathname === "/api/corrections") {
      return sendJson(res, 200, listCorrections(db, url.searchParams.get("status")));
    }
    const decisionMatch = url.pathname.match(/^\/api\/corrections\/(.+)\/(approve|revoke)$/);
    if (decisionMatch && req.method === "POST") {
      const id = decodeURIComponent(decisionMatch[1]);
      const correction = decisionMatch[2] === "approve" ? approveCorrection(db, id) : revokeCorrection(db, id);
      await saveDb(db);
      return sendJson(res, 200, correction);
    }
    const actionMatch = url.pathname.match(/^\/api\/pigeons\/(.+)\/(transfers|races|vaccines)$/);
    if (actionMatch && req.method === "POST") {
      const pigeon = appendPigeonRecord(db, decodeURIComponent(actionMatch[1]), actionMatch[2], await body(req));
      await saveDb(db);
      return sendJson(res, 200, pigeon);
    }
    sendJson(res, 404, { error: "not_found", message: "接口不存在" });
  } catch (error) {
    if (error instanceof HttpError) return sendJson(res, error.status, { error: error.code, message: error.message });
    sendJson(res, 500, { error: "internal_error", message: error.message });
  }
});

server.listen(port, () => console.log(`Racing pigeon pedigree correction app listening on http://localhost:${port}`));
