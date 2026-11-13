import { createFakeDb, cookie, call, load } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const { default: reports } = await load("api/reports.js");
const { default: admin } = await load("api/admin.js");

process.env.PUSH_TEST = "1";
const log = () => (global._gravitryPushLog ??= []);

function seed() {
  const { T } = createFakeDb();
  global._gravitryPushLog = [];
  const user = (_id, name, level, extra = {}) =>
    T("users").push({
      _id,
      username: name.toLowerCase(),
      name,
      level,
      active: true,
      ...extra,
    });
  user("S1", "Boss", "super_admin");
  user("A1", "Ana", "admin");
  user("A2", "Mario", "admin");
  user("A3", "Gone", "admin", { active: false });
  user("A4", "Maria", "admin");
  T("passengers").push({ _id: "P1", name: "Lola", status: "verified" });
  T("push_subscriptions").push({
    _id: "ps1",
    role: "passenger",
    userId: "P1",
    subscription: {
      endpoint: "https://fcm.googleapis.com/fcm/send/x",
      keys: { p256dh: "a", auth: "b" },
    },
    createdAt: "x",
  });
  return T;
}
const asMario = () =>
  cookie("admin", { sub: "A2", level: "admin", name: "Mario" });
const asAdmin = () =>
  cookie("admin", { sub: "A1", level: "admin", name: "Ana" });
const asPassenger = () =>
  cookie("passenger", { passengerId: "P1", name: "Lola" });

const sos = async () => {
  const r = await call(reports, {
    method: "POST",
    query: { action: "create" },
    body: { kind: "sos" },
    cookie: await asPassenger(),
  });
  assert.equal(r.status, 201);
  return r.body.id;
};
const act = async (id, action, body = {}, c) =>
  call(reports, {
    method: "POST",
    query: { id, action },
    body,
    cookie: c ?? (await asMario()),
  });
const get = async (id) =>
  (await call(reports, { cookie: await asAdmin() })).body.find(
    (r) => r._id === id,
  );

test("a new report starts a timeline; older reports get one built from their fields", async () => {
  const T = seed();
  const id = await sos();
  const r = await get(id);
  assert.deepEqual(
    r.timeline.map((e) => e.type),
    ["created"],
  );
  assert.equal(r.overdue, false);
  T("reports").push({
    _id: "IR-OLD",
    kind: "incident",
    status: "resolved",
    ts: "2026-01-01T00:00:00.000Z",
    acknowledgedAt: "2026-01-01T00:05:00.000Z",
    resolvedAt: "2026-01-01T00:10:00.000Z",
    resolutionNote: "ok na",
    reporter: { name: "Old" },
  });
  const old = await get("IR-OLD");
  assert.deepEqual(
    old.timeline.map((e) => e.type),
    ["created", "acknowledged", "resolved"],
  );
});

test("acknowledge once, and the reporter hears about it", async () => {
  seed();
  const id = await sos();
  const a = await act(id, "ack", { note: "On the way" });
  assert.equal(a.status, 200);
  assert.equal(a.body.status, "acknowledged");
  assert.equal(a.body.timeline.at(-1).by.name, "Mario");
  assert.equal(a.body.timeline.at(-1).note, "On the way");
  assert.deepEqual(log().at(-1).to, ["passenger:P1"]);
  assert.equal((await act(id, "ack")).status, 409, "already acknowledged");
});

test("take a report, or hand it to a colleague", async () => {
  seed();
  const id = await sos();
  const took = await act(id, "assign");
  assert.equal(took.status, 200);
  assert.equal(took.body.assignedTo.name, "Mario");
  assert.equal(
    took.body.status,
    "acknowledged",
    "owning it counts as answering it",
  );
  assert.deepEqual(
    took.body.timeline.map((e) => e.type),
    ["created", "assigned", "acknowledged"],
  );

  const other = await act(id, "assign", { userId: "A4" });
  assert.equal(other.body.assignedTo.name, "Maria");
  assert.equal(other.body.timeline.at(-1).type, "assigned");
  assert.equal(
    (await act(id, "assign", { userId: "A3" })).status,
    404,
    "disabled",
  );
  assert.equal((await act(id, "assign", { userId: "NOPE" })).status, 404);

  const status = await call(reports, {
    query: { id, action: "status" },
    cookie: await asPassenger(),
  });
  assert.equal(
    status.body.assignedTo,
    "Maria",
    "the reporter sees who is helping",
  );
});

test("progress notes go in the timeline, even after it is resolved", async () => {
  seed();
  const id = await sos();
  assert.equal((await act(id, "note", {})).status, 400, "empty note");
  const n = await act(id, "note", { note: "Called the barangay" });
  assert.equal(n.body.timeline.at(-1).type, "note");
  assert.equal(n.body.status, "open", "a note does not change the status");
  await act(id, "resolve", { note: "done" });
  assert.equal(
    (await act(id, "note", { note: "Followed up next day" })).status,
    200,
  );
});

test("resolve records how it ended; the reporter is told", async () => {
  seed();
  const id = await sos();
  assert.equal((await act(id, "resolve", { outcome: "nonsense" })).status, 400);
  assert.equal(
    (await act(id, "resolve", { outcome: "referred" })).status,
    400,
    "who was it referred to?",
  );
  const r = await act(id, "resolve", {
    outcome: "false_alarm",
    note: "Pressed by mistake",
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.outcome, "false_alarm");
  assert.equal(r.body.timeline.at(-1).outcome, "false_alarm");
  assert.equal(log().at(-1).title, "Naresolba na ang report mo");
  assert.equal((await act(id, "resolve")).status, 409, "already resolved");
  assert.equal((await act(id, "assign")).status, 409);
  const status = await call(reports, {
    query: { id, action: "status" },
    cookie: await asPassenger(),
  });
  assert.equal(status.body.outcome, "false_alarm");
  assert.equal(status.body.resolutionNote, "Pressed by mistake");
  // default outcome
  const id2 = await sos();
  assert.equal(
    (await act(id2, "resolve", { note: "ok" })).body.outcome,
    "resolved",
  );
});

test("a resolved report can be reopened, with a reason", async () => {
  seed();
  const id = await sos();
  assert.equal(
    (await act(id, "reopen", { note: "again" }, await asAdmin())).status,
    409,
    "not resolved yet",
  );
  await act(id, "resolve", { note: "ok" });
  assert.equal(
    (await act(id, "reopen", {}, await asAdmin())).status,
    400,
    "reason needed",
  );
  const r = await act(
    id,
    "reopen",
    { note: "Caller says it is not over" },
    await asAdmin(),
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "open");
  assert.equal(r.body.resolvedAt, undefined);
  assert.equal(r.body.outcome, undefined);
  assert.deepEqual(
    r.body.timeline.map((e) => e.type),
    ["created", "resolved", "reopened"],
  );
});

test("an SOS nobody answered for 3 minutes is flagged overdue", async () => {
  const T = seed();
  const id = await sos();
  const alerts = async () =>
    (
      await call(reports, {
        query: { action: "alerts" },
        cookie: await asAdmin(),
      })
    ).body;
  assert.equal((await alerts())[0].overdue, false);
  T("reports").find((r) => r._id === id).ts = new Date(
    Date.now() - 4 * 60000,
  ).toISOString();
  assert.equal((await alerts())[0].overdue, true);
  assert.equal((await get(id)).overdue, true);
  await act(id, "ack");
  assert.equal((await alerts())[0].overdue, false, "answered");
});

test("who can work reports; the staff list", async () => {
  seed();
  const id = await sos();
  for (const action of ["ack", "assign", "note", "resolve"])
    assert.equal(
      (await act(id, action, { note: "x" }, await asPassenger())).status,
      403,
      action,
    );
  assert.equal((await act(id, "ack", {}, "")).status, 401);
  const staff = await call(reports, {
    query: { action: "staff" },
    cookie: await asAdmin(),
  });
  assert.equal(staff.status, 200);
  assert.deepEqual(
    staff.body.map((s) => s.name),
    ["Ana", "Boss", "Maria", "Mario"],
  );
  assert.equal(
    (
      await call(reports, {
        query: { action: "staff" },
        cookie: await asPassenger(),
      })
    ).status,
    403,
  );
});

test("Reports tab: time to resolve and how reports ended", async () => {
  const T = seed();
  const now = Date.now();
  const iso = (m) => new Date(now - m * 60000).toISOString();
  T("reports").push(
    {
      _id: "R1",
      kind: "sos",
      status: "resolved",
      ts: iso(30),
      acknowledgedAt: iso(28),
      resolvedAt: iso(20),
      outcome: "false_alarm",
    },
    {
      _id: "R2",
      kind: "incident",
      status: "resolved",
      ts: iso(60),
      acknowledgedAt: iso(55),
      resolvedAt: iso(40),
      outcome: "resolved",
    },
    {
      _id: "R3",
      kind: "incident",
      status: "resolved",
      ts: iso(90),
      resolvedAt: iso(80),
    },
  );
  const r = await call(admin, {
    query: { action: "analytics" },
    cookie: await cookie("admin", { sub: "A1", level: "admin" }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.incidents.averageResolveMinutes, 13.33);
  assert.deepEqual(r.body.incidents.byOutcome, { false_alarm: 1, resolved: 2 });
});
