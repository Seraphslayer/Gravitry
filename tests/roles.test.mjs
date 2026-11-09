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

// Staff accounts: S1 super admin, A1 admin, M1 marshal.
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
  user("M1", "mario", "marshal");
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
  cookie(level === "marshal" ? "marshal" : "admin", {
    sub: id,
    level,
  });
const asSuper = () => as("S1", "super_admin");
const asAdmin = () => as("A1", "admin");
const asMarshal = () => as("M1", "marshal");

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
  const m = await login("mario");
  assert.equal(m.status, 200);
  assert.equal(m.body.role, "marshal");
  assert.equal(m.body.level, "marshal");
  assert.match(m.headers["Set-Cookie"], /gv_session=/);
  // staff stay signed in for one shift (12 h), not a week
  assert.match(m.headers["Set-Cookie"], /Max-Age=43200/);
  const a = await login("ana");
  assert.deepEqual([a.body.role, a.body.level], ["admin", "admin"]);
  const o = await login("oldadmin");
  assert.deepEqual([o.body.role, o.body.level], ["admin", "super_admin"]);
});

test("a marshal can run the terminal but nothing else", async () => {
  seed();
  const c = await asMarshal();
  const ok = async (h, query, method = "GET", body) =>
    (await call(h, { method, query, body, cookie: c })).status;

  // allowed
  assert.equal(await ok(queue, { action: "all" }), 200);
  assert.equal(await ok(staff, { action: "drivers", terminal: "T1" }), 200);
  assert.equal(await ok(staff, { action: "attendance" }), 200);
  assert.equal(await ok(reports, { action: "alerts" }), 200);
  assert.equal(await ok(reports, {}), 200);
  const override = await call(requests, {
    method: "POST",
    query: { id: "DR-001", action: "override" },
    body: { driverId: "D1", reason: "card lost" },
    cookie: c,
  });
  assert.equal(override.status, 200);
  assert.match(override.body.manualOverride.by, /M1/);

  // refused
  assert.equal(await ok(staff, { action: "cards" }), 403);
  assert.equal(await ok(admin, { action: "analytics" }), 403);
  assert.equal(await ok(admin, { action: "status" }), 403);
  assert.equal(await ok(admin, { action: "accounts" }), 403);
  assert.equal(
    await ok(admin, { action: "export", collection: "requests" }),
    403,
  );
  assert.equal(await ok(verifications, {}), 403);
  assert.equal(await ok(fares, {}, "PATCH", { tariff: {} }), 403);
  assert.equal(
    await ok(drivers, { action: "create" }, "POST", { name: "X" }),
    403,
  );
  assert.equal(
    await ok(drivers, { id: "D1", action: "reset-password" }, "POST"),
    403,
  );
  assert.equal(
    await ok(tricycles, { action: "create" }, "POST", {
      unit: "X",
      plate: "Y",
    }),
    403,
  );
});

test("a marshal sees a ride without the admin-only fields", async () => {
  const T = seed();
  T("requests").find((r) => r._id === "DR-001").shareToken = "secret-token";
  const list = await call(requests, { cookie: await asMarshal() });
  assert.equal(list.status, 200);
  assert.equal(list.body[0].shareToken, undefined);
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
  assert.equal(list.body.length, 3);
  assert.equal(list.body[0].passwordHash, undefined);

  const made = await post("account-create", {
    username: "newmarshal",
    name: "New Marshal",
    level: "marshal",
  });
  assert.equal(made.status, 201);
  assert.equal(made.body.level, "marshal");
  assert.ok(made.body.password.length >= 10);
  assert.equal(made.body.passwordHash, undefined);

  // the generated password really logs in, as a marshal
  const login = await call(auth, {
    method: "POST",
    query: { action: "login" },
    body: { username: "newmarshal", password: made.body.password },
  });
  assert.equal(login.body.role, "marshal");

  // validation
  const bad = (b) =>
    post("account-create", {
      username: "okname",
      name: "Okay",
      level: "marshal",
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
    { level: "admin", name: "Mario R." },
    "M1",
  );
  assert.equal(up.status, 200);
  assert.equal(up.body.level, "admin");
  const reset = await post("account-reset", {}, "M1");
  assert.equal(reset.status, 200);
  assert.ok(reset.body.password);
  assert.equal((await post("account-update", {}, "M1")).status, 400);
  assert.equal(
    (await post("account-update", { level: "x" }, "M1")).status,
    400,
  );
  assert.equal(
    (await post("account-update", { active: "no" }, "M1")).status,
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
  const marshal = await asMarshal();
  const adminC = await asAdmin();
  assert.equal(
    (await call(queue, { query: { action: "all" }, cookie: marshal })).status,
    200,
  );
  assert.equal((await call(verifications, { cookie: adminC })).status, 200);

  // disable the marshal
  T("users").find((u) => u._id === "M1").active = false;
  assert.equal(
    (await call(queue, { query: { action: "all" }, cookie: marshal })).status,
    401,
  );
  const blocked = await call(auth, {
    method: "POST",
    query: { action: "login" },
    body: { username: "mario", password: "Pass1234!" },
  });
  assert.equal(blocked.status, 403);

  // demote the admin: the old admin cookie stops working on admin pages
  T("users").find((u) => u._id === "A1").level = "marshal";
  assert.equal((await call(verifications, { cookie: adminC })).status, 403);
  assert.equal(
    (await call(queue, { query: { action: "all" }, cookie: adminC })).status,
    200,
  );
});

test("SOS reaches marshals' phones too", async () => {
  const T = seed();
  global._gravitryPushLog = [];
  process.env.PUSH_TEST = "1";
  const sub = (id) => ({
    endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
    keys: { p256dh: "k", auth: "a" },
  });
  T("push_subscriptions").push(
    {
      _id: "s1",
      role: "marshal",
      userId: "M1",
      subscription: sub("1"),
      createdAt: "x",
    },
    {
      _id: "s2",
      role: "admin",
      userId: "A1",
      subscription: sub("2"),
      createdAt: "x",
    },
    {
      _id: "s3",
      role: "driver",
      userId: "D1",
      subscription: sub("3"),
      createdAt: "x",
    },
  );
  T("passengers").push({ _id: "P1", name: "Maria", status: "verified" });
  const sos = await call(reports, {
    method: "POST",
    query: { action: "create" },
    body: { kind: "sos" },
    cookie: await cookie("passenger", { passengerId: "P1" }),
  });
  assert.equal(sos.status, 201);
  assert.deepEqual(global._gravitryPushLog[0].to.sort(), [
    "admin:A1",
    "marshal:M1",
  ]);
});

test("/me tells the page the account's real level, and drops disabled accounts", async () => {
  const T = seed();
  // a login made before levels existed (no level in the cookie)
  const old = await cookie("admin", { sub: "S1" });
  const me = await call(auth, { query: { action: "me" }, cookie: old });
  assert.deepEqual([me.body.role, me.body.level], ["admin", "super_admin"]);
  T("users").find((u) => u._id === "S1").level = "marshal";
  const demoted = await call(auth, { query: { action: "me" }, cookie: old });
  assert.deepEqual(
    [demoted.body.role, demoted.body.level],
    ["marshal", "marshal"],
  );
  T("users").find((u) => u._id === "S1").active = false;
  assert.equal(
    (await call(auth, { query: { action: "me" }, cookie: old })).status,
    401,
  );
});
