# 赛鸽血统更正与后代冻结台

运行：

```bash
npm start
```

访问 `http://localhost:3024`。支持档案、血统查询、转让、归巢成绩，以及血统更正审批、后代冻结与版本恢复。

测试：

```bash
npm test
```

## 业务模块

- `server.js` —— 请求入口：HTTP 路由、请求解析、统一错误响应，不含业务规则。
- `src/pedigree.js` —— 血统判定：血统版本链、更正单校验、通过/撤销、三代内子代重算。
- `src/store.js` —— 档案存储：JSON 档案读写与规范化（为老档案补“登记”血统版本）。
- `src/page.js` —— 页面视图，由请求入口返回。

## 血统更正规则

- 每羽只允许一条**待审**更正；提交须填原父母、新父母和原因。
- 以下情况返回 `409` 且整段不保存：新父母缺失或未登记、新父母为本羽或其后代（后代环）、该羽已有待审更正；原父母与当前生效血统不一致同样 `409`。
- **通过**后：该羽及全部后代的旧血统结论立即冻结，只按新关系生成生效版本，并重算三代内子代（第四代起保持冻结结论）。
- **撤销**后：作废本次生成的版本，恢复前一有效版本；撤销待审单不影响任何版本。
- 列表、详情与刷新后的状态一致：均取自同一套血统版本判定，且每次请求从档案重新加载。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/pigeons` | 列表（含生效血统、冻结/待审状态） |
| POST | `/api/pigeons` | 建档（自动生成登记版本） |
| GET | `/api/pigeons/:ringNo/relation` | 血统详情（父母、子代、冻结标记、待审单） |
| GET | `/api/pigeons/:ringNo/versions` | 血统版本史 |
| POST | `/api/pigeons/:ringNo/corrections` | 提交血统更正 |
| GET | `/api/corrections` | 更正单列表（可按 `?status=` 过滤） |
| POST | `/api/corrections/:id/approve` | 通过更正 |
| POST | `/api/corrections/:id/revoke` | 撤销更正 |
| POST | `/api/pigeons/:ringNo/transfers` `/races` `/vaccines` | 转让 / 成绩 / 疫苗记录 |
