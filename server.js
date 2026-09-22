import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "./src/store.js";
import { createRouter, handleError } from "./src/routes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "pigeons.json");
const port = Number(process.env.PORT || 3024);

const store = createStore(dbPath);
const router = createRouter(store);

const server = http.createServer(async (req, res) => {
  try {
    await router(req, res);
  } catch (error) {
    if (!res.headersSent) handleError(res, error);
    else res.end();
  }
});

server.listen(port, () => console.log(`Racing pigeon pedigree station listening on http://localhost:${port}`));
