// 档案存储模块：只负责赛鸽档案与更正单的落盘/读取，不做任何血统判定。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

export const seed = {
  pigeons: [
    { ringNo: "CHN-2026-001", owner: "北岸棚", fatherRing: "CHN-2022-188", motherRing: "CHN-2023-512", color: "灰", loft: "北岸A棚", vaccines: [{ date: "2026-04-01", name: "新城疫" }], transfers: [{ date: "2026-04-15", from: "育种棚", to: "北岸棚" }], races: [{ date: "2026-06-01", event: "120公里训放", distance: 120, returnTime: "10:42", rank: 18 }] },
    { ringNo: "CHN-2022-188", owner: "育种棚", fatherRing: "", motherRing: "", color: "雨点", loft: "种鸽棚", vaccines: [], transfers: [], races: [] },
    { ringNo: "CHN-2023-512", owner: "育种棚", fatherRing: "", motherRing: "", color: "红轮", loft: "种鸽棚", vaccines: [], transfers: [], races: [] }
  ],
  corrections: [],
  correctionSeq: 0
};

export function createStore(dbPath) {
  function normalize(db) {
    db.pigeons ??= [];
    db.corrections ??= [];
    db.correctionSeq ??= 0;
    for (const pigeon of db.pigeons) {
      pigeon.vaccines ??= [];
      pigeon.transfers ??= [];
      pigeon.races ??= [];
      // 血统版本履历：append-only，旧结论冻结后永不删除
      pigeon.pedigreeVersions ??= [];
    }
    return db;
  }

  return {
    // 每次请求读取一份最新档案；所有业务校验通过后才调用 write，保证整段不保存
    async read() {
      if (!existsSync(dbPath)) {
        await mkdir(dirname(dbPath), { recursive: true });
        await writeFile(dbPath, JSON.stringify(seed, null, 2));
      }
      return normalize(JSON.parse(await readFile(dbPath, "utf8")));
    },
    async write(db) {
      await writeFile(dbPath, JSON.stringify(db, null, 2));
    }
  };
}
