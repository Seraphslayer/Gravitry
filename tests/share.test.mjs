import { createFakeDb, cookie, call, load } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const { default: requests } = await load("api/requests.js");

function seed() {
  const { T } = createFakeDb();
  T("drivers").push({
    _id: "D1",
    name: "Rolando",
    appLocation: { lat: 14.356, lng: 120.917, at: new Date().toISOString() },
  });
  T("requests").push(
    {
      _id: "DR-001",
      status: "dispatched",
      passengerId: "P1",
      passengerName: "Maria Santos",
      driverId: "D1",
      driver: "Rolando",
      unit: "M1",
      plate: "ABC 123",
      pickup: { lat: 14.35, lng: 120.9, label: "Phase 3" },
      dropoff: { lat: 14.36, lng: 120.92, label: "Mall" },
      ts: new Date().toISOString(),
      fare: 20,
    },
    {
      _id: "DR-002",
      status: "completed",
      passengerId: "P1",
      completedAt: new Date().toISOString(),
      ts: new Date().toISOString(),
    },
  );
  return T;
}
const post = async (id, action, who = { passengerId: "P1" }) =>
  call(requests, {
    method: "POST",
    query: { id, action },
    cookie: who ? await cookie("passenger", who) : "",
  });

test("only the passenger can make a share link, only while the ride is active", async () => {
  seed();
  assert.equal((await post("DR-001", "share", null)).status, 401);
  assert.equal(
    (await post("DR-001", "share", { passengerId: "P2" })).status,
    404,
  );
  assert.equal(
    (await post("DR-002", "share")).status,
    409,
    "ride already completed",
  );
  const a = await post("DR-001", "share");
  assert.equal(a.status, 200);
  assert.ok(a.body.token.length >= 20);
  const b = await post("DR-001", "share");
  assert.equal(b.body.token, a.body.token, "same link every time");
});

test("the share link shows the trip but not the passenger's account", async () => {
  seed();
  const { body } = await post("DR-001", "share");
  const r = await call(requests, { query: { share: body.token } });
  assert.equal(r.status, 200);
  assert.equal(r.body.driver, "Rolando");
  assert.equal(r.body.plate, "ABC 123");
  assert.equal(r.body.passengerFirstName, "Maria");
  assert.equal(r.body.driverLocation.lat, 14.356);
  assert.equal(r.body.pickup.label, "Phase 3");
  const text = JSON.stringify(r.body);
  for (const secret of [
    "P1",
    "Santos",
    "fare",
    "passengerId",
    "DR-001",
    body.token,
  ])
    assert.ok(!text.includes(secret), `leaks ${secret}`);
});

test("bad, stopped and expired links", async () => {
  const T = seed();
  assert.equal(
    (await call(requests, { query: { share: "short" } })).status,
    404,
  );
  assert.equal(
    (await call(requests, { query: { share: "x".repeat(24) } })).status,
    404,
  );

  const { body } = await post("DR-001", "share");
  assert.equal(
    (await post("DR-001", "unshare", { passengerId: "P2" })).status,
    404,
  );
  assert.equal((await post("DR-001", "unshare")).status, 200);
  assert.equal(
    (await call(requests, { query: { share: body.token } })).status,
    404,
    "turned off",
  );

  const again = await post("DR-001", "share");
  assert.notEqual(again.body.token, body.token, "a new link after turning off");
  const ride = T("requests").find((r) => r._id === "DR-001");
  ride.status = "completed";
  ride.completedAt = new Date().toISOString();
  assert.equal(
    (await call(requests, { query: { share: again.body.token } })).status,
    200,
    "still viewable just after the ride",
  );
  ride.completedAt = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  assert.equal(
    (await call(requests, { query: { share: again.body.token } })).status,
    410,
    "expires 2 h after",
  );
});

test("the private link never appears in other responses", async () => {
  seed();
  const { body } = await post("DR-001", "share");
  const has = (x) => JSON.stringify(x).includes(body.token);
  assert.ok(
    !has((await call(requests, { query: { id: "DR-001" } })).body),
    "public lookup",
  );
  assert.ok(!has((await call(requests, {})).body), "public list");
  assert.ok(
    !has(
      (
        await call(requests, {
          query: { status: "dispatched" },
          cookie: await cookie("driver", { driverId: "D1" }),
        })
      ).body,
    ),
    "driver list",
  );
  assert.ok(
    has(
      (
        await call(requests, {
          query: { id: "DR-001" },
          cookie: await cookie("passenger", { passengerId: "P1" }),
        })
      ).body,
    ),
    "owner sees it",
  );
  assert.ok(
    has(
      (
        await call(requests, {
          query: { id: "DR-001" },
          cookie: await cookie("admin"),
        })
      ).body,
    ),
    "admin sees it",
  );
});
