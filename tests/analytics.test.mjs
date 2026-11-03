import { createFakeDb, cookie, call, load } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const { default: admin } = await load("api/admin.js");
const { default: queue } = await load("api/queue.js");

// Philippine time = UTC+8, so 2026-10-20T17:00Z is already 10-21 in the Philippines.
function seed() {
  const { T } = createFakeDb();
  T("requests").push(
    {
      _id: "R1",
      status: "completed",
      fare: 20,
      origin: "T1",
      source: "kiosk",
      driverId: "D1",
      driver: "Rolando",
      unit: "M1",
      ts: "2026-10-20T02:00:00.000Z",
      acceptedAt: "2026-10-20T02:04:00.000Z",
      rating: { stars: 5 },
    },
    {
      _id: "R2",
      status: "completed",
      fare: 15,
      origin: "T1",
      source: "app",
      discountType: "student",
      driverId: "D1",
      driver: "Rolando",
      unit: "M1",
      ts: "2026-10-20T17:00:00.000Z",
      acceptedAt: "2026-10-20T17:20:00.000Z",
      rating: { stars: 3 },
    },
    {
      _id: "R3",
      status: "cancelled",
      fare: 20,
      origin: "T2",
      source: "app",
      ts: "2026-10-21T02:00:00.000Z",
    },
    {
      _id: "R4",
      status: "pending",
      fare: 20,
      origin: "T2",
      source: "kiosk",
      ts: "2026-10-22T02:00:00.000Z",
    },
    {
      _id: "OLD",
      status: "completed",
      fare: 999,
      origin: "T1",
      ts: "2026-09-01T02:00:00.000Z",
    },
  );
  T("reports").push({
    _id: "IR-001",
    kind: "sos",
    status: "resolved",
    ts: "2026-10-20T03:00:00.000Z",
    acknowledgedAt: "2026-10-20T03:02:00.000Z",
  });
  T("attendance").push({ _id: "a", date: "2026-10-20", driverId: "D1" });
  return T;
}
const get = async (q, who = "admin") =>
  call(admin, { query: q, cookie: who ? await cookie(who) : "" });

test("analytics is admin-only", async () => {
  seed();
  assert.equal((await get({ action: "analytics" }, null)).status, 401);
  assert.equal((await get({ action: "analytics" }, "passenger")).status, 403);
  assert.equal((await get({ action: "status" }, "driver")).status, 403);
});

test("analytics numbers", async () => {
  seed();
  const r = await get({
    action: "analytics",
    from: "2026-10-19",
    to: "2026-10-23",
  });
  assert.equal(r.status, 200);
  const b = r.body;
  assert.equal(b.totals.booked, 4, "the September ride is out of range");
  assert.equal(b.totals.completed, 2);
  assert.equal(b.totals.cancelled, 1);
  assert.equal(b.totals.stillWaiting, 1);
  assert.equal(b.totals.income, 35);
  assert.equal(b.totals.averageFare, 17.5);
  assert.equal(b.totals.kiosk, 1);
  assert.equal(b.totals.app, 1);
  assert.equal(b.totals.discounted, 1);
  assert.equal(b.totals.averageStars, 4);
  assert.equal(b.waitMinutes.average, 12);
  assert.equal(b.waitMinutes.median, 12);
  assert.equal(b.waitMinutes.over10, 1);
  assert.equal(b.perDay.length, 5, "a bucket for every day, even quiet ones");
  const day = (d) => b.perDay.find((x) => x.date === d);
  assert.equal(day("2026-10-20").rides, 1);
  assert.equal(
    day("2026-10-21").rides,
    1,
    "17:00Z is already the 21st in the Philippines",
  );
  assert.equal(b.perHour[10].rides, 1, "02:00Z = 10:00 PH");
  assert.equal(b.perHour[1].rides, 1, "17:00Z = 01:00 PH");
  assert.deepEqual(b.perTerminal, [{ terminal: "T1", rides: 2, income: 35 }]);
  assert.equal(b.topDrivers[0].name, "Rolando");
  assert.equal(b.topDrivers[0].rides, 2);
  assert.equal(b.incidents.sos, 1);
  assert.equal(b.incidents.averageResponseMinutes, 2);
  assert.equal(b.attendance.distinctDrivers, 1);
});

test("analytics rejects bad dates quietly and caps the range", async () => {
  seed();
  const bad = await get({ action: "analytics", from: "nonsense" });
  assert.equal(bad.status, 200, "falls back to the last 30 days");
  assert.equal(bad.body.perDay.length, 30);
  const swapped = await get({
    action: "analytics",
    from: "2026-10-23",
    to: "2026-10-19",
  });
  assert.equal(swapped.body.from, "2026-10-19");
  const huge = await get({
    action: "analytics",
    from: "2020-01-01",
    to: "2026-10-23",
  });
  assert.equal(huge.status, 400);
});

test("kiosk ping and the status page", async () => {
  const T = seed();
  const before = await get({ action: "status" });
  assert.equal(
    before.body.checks.find((c) => c.key === "kiosk").ok,
    false,
    "never reported",
  );
  assert.equal(before.body.ok, false);

  const ping = await call(queue, {
    method: "POST",
    query: { action: "kiosk-ping" },
    body: { apiErrors: 3 },
  });
  assert.equal(ping.status, 200);
  const after = await get({ action: "status" });
  const kiosk = after.body.checks.find((c) => c.key === "kiosk");
  assert.equal(kiosk.ok, true);
  assert.equal(kiosk.apiErrors, 3);
  assert.equal(after.body.checks.find((c) => c.key === "database").ok, true);

  // a ride waiting too long, and an SOS, are flagged
  T("requests").length = 0;
  T("requests").push({
    _id: "W",
    status: "pending",
    ts: new Date(Date.now() - 15 * 60000).toISOString(),
  });
  T("reports").push({ _id: "IR-9", kind: "sos", status: "open" });
  const bad = await get({ action: "status" });
  assert.equal(bad.body.checks.find((c) => c.key === "waiting").ok, false);
  assert.equal(bad.body.checks.find((c) => c.key === "sos").ok, false);
  assert.equal(bad.body.numbers.pendingRides, 1);
  assert.equal(
    T("settings").some((d) => d._id === "kiosk-heartbeat"),
    true,
  );
});
