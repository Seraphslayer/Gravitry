import { createFakeDb, cookie, call, load } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const { default: admin } = await load("api/admin.js");
const { default: drivers } = await load("api/drivers.js");
const { default: auth } = await load("api/auth.js");
const { hashPassword } = await load("api/_auth.js");

function seed() {
  const { T } = createFakeDb();
  T("drivers").push({
    _id: "D1",
    name: "Rolando",
    username: "rolando",
    passwordHash: hashPassword("OldPass1!"),
    nfcId: "1234567890",
  });
  T("passengers").push({
    _id: "P1",
    name: 'Maria, "Mia" Santos',
    username: "maria",
    passwordHash: "secret",
    createdAt: "2026-10-20T01:00:00.000Z",
  });
  T("requests").push(
    { _id: "DR-001", ts: "2026-10-20T10:00:00.000Z", note: "=HYPERLINK(1)" },
    { _id: "DR-002", ts: "2026-10-25T10:00:00.000Z" },
  );
  T("staff_cards").push({ _id: "9999999999", name: "Ana", pinHash: "h" });
  // the test cookie's user ("u") is a super admin (an older account with no
  // level counts as one)
  T("users").push({ _id: "u", username: "boss", passwordHash: "h" });
  return T;
}
const exp = async (q, who = "admin") =>
  call(admin, {
    query: { action: "export", ...q },
    cookie: who ? await cookie(who) : "",
  });

test("export is admin-only and never leaks secrets", async () => {
  seed();
  assert.equal((await exp({ collection: "drivers" }, null)).status, 401);
  assert.equal((await exp({ collection: "drivers" }, "driver")).status, 403);
  assert.equal((await exp({ collection: "nope" })).status, 400);
  assert.equal((await exp({ collection: "verifications" })).status, 400);
  for (const [c, secret] of [
    ["drivers", "passwordHash"],
    ["passengers", "passwordHash"],
    ["staff_cards", "pinHash"],
  ]) {
    const r = await exp({ collection: c });
    assert.equal(r.status, 200);
    assert.ok(r.body.rows.length);
    assert.equal(r.body.rows[0][secret], undefined, `${c} hides ${secret}`);
  }
});

test("export by date range, and as CSV that is safe for Excel", async () => {
  seed();
  const r = await exp({
    collection: "requests",
    from: "2026-10-24",
    to: "2026-10-25",
  });
  assert.deepEqual(
    r.body.rows.map((x) => x._id),
    ["DR-002"],
  );
  const all = await exp({ collection: "requests", to: "2026-10-20" });
  assert.deepEqual(
    all.body.rows.map((x) => x._id),
    ["DR-001"],
    "to includes that whole day",
  );
  assert.equal(
    (await exp({ collection: "requests", from: "yesterday" })).status,
    400,
  );

  const csv = await exp({ collection: "requests", format: "csv" });
  assert.equal(csv.headers["Content-Type"], "text/csv; charset=utf-8");
  assert.ok(csv.body.startsWith("﻿_id,ts,note"));
  assert.ok(csv.body.includes("'=HYPERLINK(1)"), "formulas are defused");
  const pax = await exp({ collection: "passengers", format: "csv" });
  assert.ok(
    pax.body.includes('"Maria, ""Mia"" Santos"'),
    "quotes and commas escaped",
  );
});

test("admin can reset a driver's password; old one stops working", async () => {
  const T = seed();
  T("login_attempts").push({
    _id: "login:rolando",
    lockUntil: new Date(Date.now() + 9e5),
  });
  assert.equal(
    (
      await call(drivers, {
        method: "POST",
        query: { id: "D1", action: "reset-password" },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call(drivers, {
        method: "POST",
        query: { id: "D1", action: "reset-password" },
        cookie: await cookie("driver", { driverId: "D1" }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(drivers, {
        method: "POST",
        query: { id: "NOPE", action: "reset-password" },
        cookie: await cookie("admin"),
      })
    ).status,
    404,
  );
  const r = await call(drivers, {
    method: "POST",
    query: { id: "D1", action: "reset-password" },
    cookie: await cookie("admin"),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.username, "rolando");
  assert.ok(r.body.password.length >= 8);
  assert.equal(T("login_attempts").length, 0, "lockout cleared");

  const login = (password) =>
    call(auth, {
      method: "POST",
      query: { action: "login" },
      body: { username: "rolando", password },
    });
  assert.equal((await login("OldPass1!")).status, 401);
  assert.equal((await login(r.body.password)).status, 200);
});
