import { createFakeDb, cookie, call, load } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const { default: requests } = await load("api/requests.js");
const { default: admin } = await load("api/admin.js");
const { default: queue } = await load("api/queue.js");

function seed() {
  const { T } = createFakeDb();
  const driver = (_id, name, nfcId, extra = {}) =>
    T("drivers").push({
      _id,
      name,
      unit: `MCC-${_id}`,
      plate: `PL-${_id}`,
      nfcId,
      status: "available",
      tripsCompleted: 0,
      licenseStatus: "valid",
      franchiseStatus: "valid",
      ...extra,
    });
  driver("D1", "Rolando", "1111111111");
  driver("D2", "Berto", "2222222222");
  T("tricycles").push(
    { _id: "MCC-D1", driverId: "D1", status: "available", terminal: "T1" },
    { _id: "MCC-D2", driverId: "D2", status: "available", terminal: "T1" },
  );
  return T;
}
const start = (origin = "T1") =>
  call(requests, {
    method: "POST",
    query: { action: "optout" },
    body: { origin },
  });
const tap = (nfcId, optOutId, origin = "T1") =>
  call(requests, {
    method: "POST",
    query: { action: "optout-tap" },
    body: { nfcId, origin, optOutId },
  });

test("pressing the button gives a one-use ticket", async () => {
  const T = seed();
  const r = await start();
  assert.equal(r.status, 201);
  assert.match(r.body.id, /^OO-/);
  assert.ok(new Date(r.body.expiresAt) > new Date());
  assert.equal(T("optouts").length, 1);
  assert.equal(
    T("requests").length,
    0,
    "nothing is booked, nothing waits for a driver",
  );
  assert.equal((await start("T9")).status, 400, "unknown terminal");
});

test("the button is rate limited", async () => {
  seed();
  for (let i = 0; i < 12; i++) assert.equal((await start()).status, 201);
  assert.equal((await start()).status, 429);
});

test("the driver's tap puts the trip on record", async () => {
  const T = seed();
  const { body: t } = await start();
  // another driver is first in line: the passenger may still pick D1
  T("terminal_line").push(
    {
      _id: "D2",
      terminal: "T1",
      driverName: "Berto",
      joinedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      _id: "D1",
      terminal: "T1",
      driverName: "Rolando",
      joinedAt: "2026-01-01T00:01:00.000Z",
    },
  );
  const r = await tap("1111111111", t.id);
  assert.equal(r.status, 200);
  assert.deepEqual(
    [r.body.driver, r.body.unit, r.body.plate],
    ["Rolando", "MCC-D1", "PL-D1"],
  );

  const ride = T("requests")[0];
  assert.equal(ride.optOut, true);
  assert.equal(ride.status, "completed");
  assert.equal(ride.driverId, "D1");
  assert.equal(ride.fare, 0);
  assert.equal(ride.destination, null);
  assert.equal(ride.origin, "T1");
  assert.ok(ride.completedAt);

  // the driver left: out of the line, tricycle away, counted present today
  assert.deepEqual(
    T("terminal_line").map((l) => l._id),
    ["D2"],
  );
  assert.equal(T("tricycles").find((x) => x._id === "MCC-D1").terminal, null);
  assert.equal(T("attendance").length, 1);
  // not a verified trip: not added to the driver's completed trips
  assert.equal(T("drivers").find((d) => d._id === "D1").tripsCompleted, 0);
});

test("a ticket works once, in its terminal, before it expires", async () => {
  const T = seed();
  const { body: t } = await start();
  assert.equal(
    (await tap("1111111111", "OO-nope")).status,
    410,
    "unknown ticket",
  );
  assert.equal(
    (await tap("1111111111", t.id, "T2")).status,
    410,
    "other terminal",
  );
  assert.equal((await tap("1111111111", t.id)).status, 200);
  assert.equal((await tap("2222222222", t.id)).status, 410, "already used");
  assert.equal(T("requests").length, 1);

  const { body: old } = await start();
  T("optouts").find((x) => x._id === old.id).expiresAt = new Date(
    Date.now() - 1000,
  ).toISOString();
  assert.equal((await tap("2222222222", old.id)).status, 410, "expired");
  assert.equal(T("requests").length, 1);
});

test("the usual driver safety rules still apply", async () => {
  const T = seed();
  T("drivers").push({
    _id: "D3",
    name: "Busy",
    nfcId: "3333333333",
    status: "on_trip",
    licenseStatus: "valid",
    franchiseStatus: "valid",
  });
  T("drivers").push({
    _id: "D4",
    name: "Expired",
    nfcId: "4444444444",
    status: "available",
    licenseStatus: "expired",
    franchiseStatus: "valid",
  });
  T("staff_cards").push({ _id: "5555555555", name: "Ana", active: true });
  const { body: t } = await start();
  assert.equal(
    (await tap("3333333333", t.id)).status,
    409,
    "already on a trip",
  );
  assert.equal((await tap("4444444444", t.id)).status, 403, "expired license");
  assert.equal(
    (await tap("5555555555", t.id)).status,
    404,
    "staff cards cannot record a trip",
  );
  assert.equal((await tap("9999999999", t.id)).status, 404, "unknown card");
  assert.equal((await tap("abc", t.id)).status, 400);
  assert.equal(T("requests").length, 0, "none of those used the ticket");
  assert.equal(
    (await tap("1111111111", t.id)).status,
    200,
    "so a real driver still can",
  );
});

test("an unknown card is counted and eventually locked, like a normal tap", async () => {
  seed();
  const { body: t } = await start();
  for (let i = 0; i < 5; i++)
    assert.equal((await tap("9999999999", t.id)).status, 404);
  assert.equal((await tap("9999999999", t.id)).status, 429);
});

test("a waiting ride and the driver line are not touched", async () => {
  const T = seed();
  T("requests").push({
    _id: "DR-100",
    status: "pending",
    origin: "T1",
    destination: "T2",
    source: "kiosk",
    priority: 0,
    ts: new Date().toISOString(),
  });
  const { body: t } = await start();
  await tap("1111111111", t.id);
  assert.equal(T("requests").find((r) => r._id === "DR-100").status, "pending");
  const snap = await call(queue, {
    query: { action: "all" },
    cookie: await cookie("admin", { sub: "u" }),
  });
  assert.equal(snap.status, 200);
  const t1 =
    snap.body.find((x) => x.terminal === "T1") ||
    snap.body.terminals?.find((x) => x.terminal === "T1");
  assert.equal(t1.passengers.total, 1, "only the real ride is waiting");
});

test("Reports: these trips are counted on their own, not in income", async () => {
  const T = seed();
  const { body: t } = await start();
  await tap("1111111111", t.id);
  T("requests").push({
    _id: "DR-200",
    status: "completed",
    origin: "T1",
    destination: "T2",
    source: "kiosk",
    fare: 20,
    driverId: "D2",
    driver: "Berto",
    ts: new Date().toISOString(),
    acceptedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  });
  const r = await call(admin, {
    query: { action: "analytics" },
    cookie: await cookie("admin", { sub: "u" }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.totals.noSystem, 1);
  assert.equal(r.body.totals.booked, 1);
  assert.equal(r.body.totals.completed, 1);
  assert.equal(r.body.totals.income, 20);
});
