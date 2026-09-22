# 赛鸽血统更正与后代冻结台

运行：

```bash
npm start
```

访问 `http://localhost:3024`。

## 模块划分

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| 请求入口 | `src/routes.js`、`server.js` | HTTP 路由、请求体解析、响应码；不含血统规则 |
| 血统判定 | `src/pedigree.js` | 关系图、三代祖先/后代、后代环检测、版本与冻结、更正申请/通过/撤销 |
| 档案存储 | `src/store.js` | JSON 档案的读取与整盘写入；校验失败不落盘 |
| 页面 | `src/page.js` | 列表、详情、更正申请/通过/撤销界面，刷新后与接口状态一致 |

## 血统更正规则

- 每羽只允许一条待审更正，申请须填写原父母、新父母和原因。
- 以下任一情况返回 `409` 且整段不保存：
  - `correction_already_pending`：该羽已有待审更正；
  - `original_parent_mismatch`：原父母与档案现状不一致；
  - `new_parent_missing`：新父母留空或未在档案中登记；
  - `descendant_cycle`：新关系会形成后代环。
- 通过后：该羽及全部后代的旧血统结论立即冻结（版本状态 `frozen`），切换为新关系，仅对该羽及三代内子代按新关系生成新版本并重算。
- 撤销已通过更正：本次生成的版本作废，被冻结的前一版本恢复为有效，父母指针回滚；只允许撤销最近一次通过的更正。
- 版本履历 append-only：初版/有效/已冻结/已作废，旧结论永不删除。

## 接口

- `GET /api/pigeons`：列表（含冻结标记、有效版本号、待审标记）
- `GET /api/pigeons/:ringNo/relation`：详情（三代血统、版本履历、更正记录）
- `POST /api/pigeons`：创建档案
- `POST /api/pigeons/:ringNo/corrections`：申请血统更正
- `POST /api/corrections/:id/approve`：通过更正
- `POST /api/corrections/:id/revoke`：撤销待审申请或已通过更正
- `GET /api/corrections?status=pending`：更正单列表
- `POST /api/pigeons/:ringNo/transfers|races|vaccines`：沿用原有记录功能
