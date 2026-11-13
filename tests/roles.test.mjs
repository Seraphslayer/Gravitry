import { createFakeDb, cookie, call, load } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const { default: auth } = await load("api/auth.js");
const { default: admin } = await load("api/admin.js");
const { default: drivers } = await load("api/drivers.js");
const { default: fares } = await load("api/fares.js");
const { default: queue } = await load("api/queue.js");
const { default: staff } = await load("api/staff.js");
const { default: reports } = await load("api/reports.js");
const { default: requests } = await load("api/requests.js");
const { default: tricycles } = await load("api/tricycles.js");
const { default: verifications } = await load("api/verifications.js");
const { hashPassword } = await load("api/_auth.js");

// Staff accounts: S1 super admin, A1 admin.
function seed() {
  const { T } = createFakeDb();
  const user = (_id, username, level, extra = {}) =>
    T("users").push({
      _id,
      username,
      name: username,
      level,
      active: true,
      passwordHash: hashPassword("Pass1234!"),
      ...extra,
    });
  user("S1", "boss", "super_admin");
  user("A1", "ana", "admin");
  T("drivers").push({
    _id: "D1",
    name: "Rolando",
    unit: "M1",
    status: "available",
    licenseStatus: "valid",
    franchiseStatus: "valid",
  });
  T("requests").push({
    _id: "DR-001",
    status: "pending",
    origin: "T1",
    destination: "T2",
    source: "kiosk",
    priority: 0,
    ts: new Date().toISOString(),
  });
  return T;
}
const as = (id, level) =>
  cookie("admin", {
    sub: id,
    level,
  });
const asSuper = () => as("S1", "super_admin");
const asAdmin = () => as("A1", "admin");

test("login: role and level come from the account; old accounts stay super admin", async () => {
  const T = seed();
  T("users").push({
    _id: "U1",
    username: "oldadmin",
    passwordHash: hashPassword("Pass1234!"),
  });
  const login = (username) =>
    call(auth, {
      method: "POST",
      query: { action: "login" },
      body: { username, password: "Pass1234!" },
    });
  const a = await login("ana");
  assert.equal(a.status, 200);
  assert.match(a.headers["Set-Cookie"], /gv_session=/);
  // staff stay signed in for one shift (12 h), not a week
  assert.match(a.headers["Set-Cookie"], /Max-Age=43200/);
  assert.deepEqual([a.body.role, a.body.level], ["admin", "admin"]);
  const o = await login("oldadmin");
  assert.deepEqual([o.body.role, o.body.level], ["admin", "super_admin"]);
});

test("an admin does everything except staff accounts and export", async () => {
  seed();
  const c = await asAdmin();
  const ok = async (h, query, method = "GET", body) =>
    (await call(h, { method, query, body, cookie: c })).status;
  assert.equal(await ok(admin, { action: "analytics" }), 200);
  assert.equal(await ok(admin, { action: "status" }), 200);
  assert.equal(await ok(verifications, {}), 200);
  assert.equal(await ok(staff, { action: "cards" }), 200);
  assert.equal(await ok(admin, { action: "accounts" }), 403);
  assert.equal(await ok(admin, { action: "collections" }), 403);
  assert.equal(
    await ok(admin, { action: "export", collection: "requests" }),
    403,
  );
  assert.equal(
    await ok(admin, { action: "account-create" }, "POST", {
      username: "newone",
      name: "New One",
      level: "admin",
    }),
    403,
  );
});

test("super admin manages staff accounts", async () => {
  const T = seed();
  const c = await asSuper();
  const post = (action, body, id) =>
    call(admin, { method: "POST", query: { action, id }, body, cookie: c });

  const list = await call(admin, { query: { action: "accounts" }, cookie: c });
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 2);
  assert.equal(list.body[0].passwordHash, undefined);

  const made = await post("account-create", {
    username: "newmarshal",
    name: "New Marshal",
    level: "admin",
  });
  assert.equal(made.status, 201);
  assert.equal(made.body.level, "admin");
  assert.ok(made.body.password.length >= 10);
  assert.equal(made.body.passwordHash, undefined);

  // the generated password really logs in, as an admin
  const login = await call(auth, {
    method: "POST",
    query: { action: "login" },
    body: { username: "newmarshal", password: made.body.password },
  });
  assert.equal(login.body.role, "admin");

  // validation
  const bad = (b) =>
    post("account-create", {
      username: "okname",
      name: "Okay",
      level: "admin",
      ...b,
    });
  assert.equal((await bad({ username: "x" })).status, 400);
  assert.equal((await bad({ level: "god" })).status, 400);
  assert.equal((await bad({ name: "" })).status, 400);
  assert.equal((await bad({ username: "boss" })).status, 409, "taken by staff");
  T("drivers").push({ _id: "D9", username: "driverguy" });
  assert.equal(
    (await bad({ username: "driverguy" })).status,
    409,
    "taken by a driver",
  );

  // promote, rename, reset
  const up = await post(
    "account-update",
    { level: "super_admin", name: "Ana R." },
    "A1",
  );
  assert.equal(up.status, 200);
  assert.equal(up.body.level, "super_admin");
  const reset = await post("account-reset", {}, "A1");
  assert.equal(reset.status, 200);
  assert.ok(reset.body.password);
  assert.equal((await post("account-update", {}, "A1")).status, 400);
  assert.equal(
    (await post("account-update", { level: "x" }, "A1")).status,
    400,
  );
  assert.equal(
    (await post("account-update", { active: "no" }, "A1")).status,
    400,
  );
  assert.equal(
    (await post("account-update", { level: "admin" }, "NOPE")).status,
    404,
  );
});

test("you cannot lock yourself out; demoting a super admin takes effect at once", async () => {
  const T = seed();
  const c = await asSuper();
  const post = (body, id) =>
    call(admin, {
      method: "POST",
      query: { action: "account-update", id },
      body,
      cookie: c,
    });
  assert.equal(
    (await post({ active: false }, "S1")).status,
    409,
    "not yourself",
  );
  assert.equal(
    (await post({ level: "admin" }, "S1")).status,
    409,
    "not yourself",
  );

  // a second super admin can be demoted by the first, and loses the power at once
  T("users").push({
    _id: "S2",
    username: "boss2",
    level: "super_admin",
    active: true,
  });
  const c2 = await as("S2", "super_admin");
  const accounts = () =>
    call(admin, { query: { action: "accounts" }, cookie: c2 });
  assert.equal((await accounts()).status, 200);
  assert.equal((await post({ level: "admin" }, "S2")).status, 200);
  assert.equal((await accounts()).status, 403);
});

test("disabling or demoting an account works on an existing login at once", async () => {
  const T = seed();
  const adminC = await asAdmin();
  const superC = await asSuper();
  const accounts = () =>
    call(admin, { query: { action: "accounts" }, cookie: superC });
  assert.equal((await call(verifications, { cookie: adminC })).status, 200);
  assert.equal((await accounts()).status, 200);

  // demote the super admin: the old cookie stops working on super-admin pages
  T("users").find((u) => u._id === "S1").level = "admin";
  assert.equal((await accounts()).status, 403);

  // disable the admin: the old cookie is refused everywhere, and so is login
  T("users").find((u) => u._id === "A1").active = false;
  assert.equal((await call(verifications, { cookie: adminC })).status, 401);
  const blocked = await call(auth, {
    method: "POST",
    query: { action: "login" },
    body: { username: "ana", password: "Pass1234!" },
  });
  assert.equal(blocked.status, 403);
});

test("/me tells the page the account's real level, and drops disabled accounts", async () => {
  const T = seed();
  // a login made before levels existed (no level in the cookie)
  const old = await cookie("admin", { sub: "S1" });
  const me = await call(auth, { query: { action: "me" }, cookie: old });
  assert.deepEqual([me.body.role, me.body.level], ["admin", "super_admin"]);
  T("users").find((u) => u._id === "S1").level = "admin";
  const demoted = await call(auth, { query: { action: "me" }, cookie: old });
  assert.deepEqual([demoted.body.role, demoted.body.level], ["admin", "admin"]);
  T("users").find((u) => u._id === "S1").active = false;
  assert.equal(
    (await call(auth, { query: { action: "me" }, cookie: old })).status,
    401,
  );
});
