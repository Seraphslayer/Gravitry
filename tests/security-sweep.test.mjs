import { createFakeDb, cookie, call, load } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
const mods = {};
for (const n of [
  "admin",
  "auth",
  "drivers",
  "fares",
  "queue",
  "quote",
  "reports",
  "requests",
  "staff",
  "tricycles",
  "verifications",
])
  mods[n] = (await load(`api/${n}.js`)).default;

// 1) Every route, anonymous: anything that is not obviously public must not return 200
const probes = [
  ["admin", { action: "analytics" }],
  ["admin", { action: "status" }],
  ["admin", { action: "collections" }],
  ["admin", { action: "export", collection: "users" }],
  ["admin", { action: "accounts" }],
  ["drivers", { action: "locations" }],
  ["queue", { action: "all" }],
  ["queue", { action: "mine" }],
  ["reports", {}],
  ["reports", { action: "alerts" }],
  ["reports", { action: "staff" }],
  ["staff", { action: "drivers" }],
  ["staff", { action: "attendance" }],
  ["staff", { action: "cards" }],
  ["verifications", {}],
  ["verifications", { action: "users" }],
  ["verifications", { action: "stats" }],
];
test("anonymous GETs to protected routes are refused", async () => {
  createFakeDb();
  for (const [m, q] of probes) {
    const r = await call(mods[m], { query: q });
    assert.ok(
      [401, 403].includes(r.status),
      `${m} ${JSON.stringify(q)} -> ${r.status}`,
    );
  }
});
const posts = [
  ["admin", { action: "account-create" }],
  ["admin", { action: "account-update", id: "x" }],
  ["admin", { action: "account-reset", id: "x" }],
  ["drivers", { action: "create" }],
  ["drivers", { action: "reset-password" }],
  ["drivers", { id: "x" }],
  ["fares", {}],
  ["tricycles", { action: "create" }],
  ["tricycles", { action: "rent" }],
  ["tricycles", { action: "release" }],
  ["requests", { id: "DR-1", action: "override" }],
  ["requests", { id: "DR-1", action: "complete" }],
  ["requests", { id: "DR-1", action: "accept" }],
  ["requests", { id: "DR-1", action: "pickup" }],
  ["requests", { id: "DR-1", action: "rate" }],
  ["queue", { action: "join" }],
  ["queue", { action: "leave" }],
  ["reports", { id: "IR-1", action: "resolve" }],
  ["reports", { action: "create" }],
  ["staff", { action: "assign" }],
  ["staff", { action: "cancel" }],
  ["staff", { action: "checkin" }],
  ["staff", { action: "line-remove" }],
  ["staff", { action: "card-create" }],
  ["verifications", { id: "x", action: "approve" }],
];
test("anonymous POST/PATCH to protected routes are refused", async () => {
  const { T } = createFakeDb();
  T("requests").push({
    _id: "DR-1",
    status: "pending",
    origin: "T1",
    source: "app",
  });
  for (const [m, q] of posts)
    for (const method of ["POST", "PATCH"]) {
      if (m === "fares" && method === "POST") continue;
      const r = await call(mods[m], { method, query: q, body: {} });
      assert.ok(
        [401, 403, 404, 405, 400].includes(r.status) &&
          r.status !== 200 &&
          r.status !== 201,
        `${method} ${m} ${JSON.stringify(q)} -> ${r.status}`,
      );
    }
});
// 2) hostile input shapes never crash with 500
test("hostile bodies and queries never 500", async () => {
  createFakeDb();
  const evil = [
    { $ne: null },
    ["a"],
    { $gt: "" },
    123,
    null,
    "x".repeat(10000),
    { __proto__: { admin: true } },
  ];
  for (const [m, q] of [...probes, ...posts])
    for (const e of evil) {
      for (const method of ["GET", "POST"]) {
        const r = await call(mods[m], {
          method,
          query: { ...q, id: e, status: e, origin: e, passengerId: e },
          body: {
            username: e,
            password: e,
            nfcId: e,
            origin: e,
            id: e,
            name: e,
          },
        });
        assert.ok(
          r.status < 500,
          `${method} ${m} ${JSON.stringify(q)} evil=${JSON.stringify(e).slice(0, 30)} -> ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`,
        );
      }
    }
});
