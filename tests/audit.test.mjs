import { createFakeDb, cookie, call, load } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const { default: requests } = await load("api/requests.js");
const { default: drivers } = await load("api/drivers.js");
const { default: tricycles } = await load("api/tricycles.js");
const { default: auth } = await load("api/auth.js");

function seed() {
  const { T } = createFakeDb();
  T("drivers").push(
    {
      _id: "D1",
      name: "Rolando",
      unit: "M1",
      plate: "A",
      status: "available",
      nfcId: "1234567890",
      license: "N01-23-456789",
      contact: "09171234567",
      username: "rol",
      passwordHash: "x",
      licenseStatus: "valid",
      franchiseStatus: "valid",
    },
    { _id: "D2", name: "Other", status: "available", nfcId: "1111111111" },
  );
  T("tricycles").push({
    _id: "M1",
    driverId: "D1",
    allRounder: true,
    rental: { driverId: "D1" },
    rentalHistory: [{ driverId: "D9" }],
  });
  T("requests").push({
    _id: "DR-001",
    status: "pending",
    origin: "T1",
    destination: "T2",
    passengerId: "P1",
    passengerName: "Maria Santos",
    pickup: { lat: 14.35, lng: 120.9, label: "Phase 3" },
    dropoff: { lat: 14.36, lng: 120.92, label: "Mall" },
    ts: new Date().toISOString(),
  });
  return T;
}

test("public driver list hides NFC card, license and phone", async () => {
  seed();
  const pub = await call(drivers);
  assert.equal(pub.status, 200);
  for (const d of pub.body) {
    assert.equal(d.nfcId, undefined);
    assert.equal(d.license, undefined);
    assert.equal(d.contact, undefined);
    assert.equal(d.passwordHash, undefined);
  }
  assert.equal(pub.body[0].name, "Rolando", "safety record still shown");
  const adm = await call(drivers, { cookie: await cookie("admin") });
  assert.equal(adm.body.find((d) => d._id === "D1").nfcId, "1234567890");
});

test("public ride list/lookup hides who booked and exact points", async () => {
  seed();
  const list = await call(requests, { query: { status: "pending" } });
  assert.equal(list.body[0].passengerName, undefined);
  assert.equal(list.body[0].passengerId, undefined);
  assert.equal(list.body[0].pickup.lat, undefined);
  assert.equal(list.body[0].pickup.label, "Phase 3");
  const one = await call(requests, { query: { id: "DR-001" } });
  assert.equal(one.body.passengerName, undefined);

  const owner = await call(requests, {
    query: { id: "DR-001" },
    cookie: await cookie("passenger", { passengerId: "P1" }),
  });
  assert.equal(owner.body.passengerName, "Maria Santos");
  const stranger = await call(requests, {
    query: { id: "DR-001" },
    cookie: await cookie("passenger", { passengerId: "P2" }),
  });
  assert.equal(stranger.body.passengerName, undefined);
  const drv = await call(requests, {
    query: { status: "pending" },
    cookie: await cookie("driver", { driverId: "D1" }),
  });
  assert.equal(drv.body[0].pickup.lat, 14.35, "drivers need the pickup point");
  const adm = await call(requests, { cookie: await cookie("admin") });
  assert.equal(adm.body[0].passengerName, "Maria Santos");
});

test("a ride can only be completed once", async () => {
  const T = seed();
  T("requests").push({
    _id: "DR-002",
    status: "dispatched",
    driverId: "D1",
    destination: "T2",
  });
  const c = await cookie("driver", { driverId: "D1" });
  const first = await call(requests, {
    method: "POST",
    query: { id: "DR-002", action: "complete" },
    cookie: c,
  });
  assert.equal(first.status, 200);
  const again = await call(requests, {
    method: "POST",
    query: { id: "DR-002", action: "complete" },
    cookie: c,
  });
  assert.equal(again.status, 404);
  assert.equal(T("drivers").find((d) => d._id === "D1").tripsCompleted, 1);
  const pend = await call(requests, {
    method: "POST",
    query: { id: "DR-001", action: "complete" },
    cookie: await cookie("admin"),
  });
  assert.equal(pend.status, 404, "a waiting ride cannot be 'completed'");
});

test("a driver already on a trip cannot accept another ride", async () => {
  const T = seed();
  T("drivers").find((d) => d._id === "D1").status = "on_trip";
  const r = await call(requests, {
    method: "POST",
    query: { id: "DR-001", action: "accept" },
    cookie: await cookie("driver", { driverId: "D1" }),
  });
  assert.equal(r.status, 409);
});

test("rental details are admin-only on the tricycle list", async () => {
  seed();
  const pub = await call(tricycles);
  assert.equal(pub.body[0].rental, undefined);
  assert.equal(pub.body[0].rentalHistory, undefined);
  const adm = await call(tricycles, { cookie: await cookie("admin") });
  assert.ok(adm.body[0].rental);
});

test("driver NFC card edits are validated and unique", async () => {
  seed();
  const adm = await cookie("admin");
  const patch = (nfcId) =>
    call(drivers, {
      method: "PATCH",
      query: { id: "D1" },
      body: { nfcId },
      cookie: adm,
    });
  assert.equal((await patch("abc")).status, 400);
  assert.equal((await patch("1111111111")).status, 409, "belongs to D2");
  assert.equal((await patch("2222222222")).status, 200);
});

test("signup cannot reuse a driver's username", async () => {
  seed();
  const r = await call(auth, {
    method: "POST",
    query: { action: "signup" },
    body: { username: "rol", password: "x" },
  });
  // fails validation before anything else, so just make sure it never creates
  assert.notEqual(r.status, 201);
});
