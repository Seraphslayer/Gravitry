import { createFakeDb, cookie, call, load } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const { default: requests } = await load("api/requests.js");
const { default: staff } = await load("api/staff.js");
const { hashPassword, signStaffToken } = await load("api/_auth.js");
const fare = await load("api/_fare.js");

const T1 = { lat: 14.354615812078766, lng: 120.92335026772189 };
// drop-off right next to terminal T3
const nearT3 = { lat: 14.3567, lng: 120.9168 };
const quote = (meters = 1500) =>
  fare.signQuote({
    pickup: { ...T1, label: "Main Terminal" },
    dropoff: { ...nearT3, label: "Sitio Uno" },
    meters,
    estimated: false,
    regularFare: fare.regularFareForMeters(meters),
  });

function seed() {
  const { T } = createFakeDb();
  T("users").push({
    _id: "M1",
    username: "mario",
    name: "Mario",
    level: "marshal",
    active: true,
    passwordHash: hashPassword("x"),
  });
  T("drivers").push({
    _id: "D1",
    name: "Rolando",
    unit: "M1",
    plate: "ABC",
    status: "available",
    nfcId: "1111111111",
    licenseStatus: "valid",
    franchiseStatus: "valid",
  });
  return T;
}
const marshal = () =>
  cookie("marshal", { sub: "M1", level: "marshal", name: "Mario" });
const walkup = async (body, c) =>
  call(requests, {
    method: "POST",
    query: { action: "walkup" },
    body: { origin: "T1", quoteToken: quote(), ...body },
    cookie: c ?? (await marshal()),
  });

test("a marshal books a ride for a walk-in passenger", async () => {
  const T = seed();
  const r = await walkup({
    passengerName: "Lola Rosa",
    contact: "0917 123 4567",
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.status, "pending");
  assert.equal(r.body.source, "kiosk", "behaves like a kiosk ride");
  assert.equal(r.body.walkup, true);
  assert.equal(r.body.priority, 0, "served before app bookings");
  assert.equal(r.body.origin, "T1");
  assert.equal(
    r.body.destination,
    "T3",
    "drop-off snapped to the nearest terminal",
  );
  assert.equal(r.body.bookedBy, "M1");
  assert.equal(r.body.passengerName, "Lola Rosa");
  assert.equal(r.body.fare, fare.regularFareForMeters(1500));
  assert.equal(T("requests").length, 1);
});

test("walk-up: who may book, and bad input", async () => {
  seed();
  assert.equal((await walkup({}, "")).status, 401, "not logged in");
  assert.equal(
    (await walkup({}, await cookie("passenger", { passengerId: "P1" }))).status,
    403,
  );
  assert.equal(
    (await walkup({}, await cookie("driver", { driverId: "D1" }))).status,
    403,
  );
  assert.equal(
    (await walkup({ origin: "T9" })).status,
    400,
    "unknown terminal",
  );
  assert.equal(
    (await walkup({ quoteToken: "nope" })).status,
    400,
    "forged quote",
  );
  assert.equal((await walkup({ discountClaim: "vip" })).status, 400);
  assert.equal((await walkup({ contact: "call me maybe" })).status, 400);
});

test("walk-up: a disabled marshal is refused at once", async () => {
  const T = seed();
  const c = await marshal();
  assert.equal((await walkup({}, c)).status, 201);
  T("users")[0].active = false;
  assert.equal((await walkup({}, c)).status, 401);
});

test("walk-up: the kiosk staff panel (card + PIN) can book too", async () => {
  seed();
  const token = signStaffToken({ staffId: "9999999999", name: "Ana" });
  const r = await call(requests, {
    method: "POST",
    query: { action: "walkup" },
    body: { origin: "T1", quoteToken: quote() },
    headers: { "x-staff-token": token },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.bookedByName, "Ana");
});

test("walk-up with a discount claim: the driver's NFC tap confirms it", async () => {
  seed();
  const r = await walkup({ discountClaim: "senior" });
  assert.equal(r.status, 201);
  assert.equal(r.body.discountClaim, "senior");
  assert.equal(
    r.body.discountPending,
    true,
    "applied only after the ID is checked",
  );
  const tap = await call(requests, {
    method: "POST",
    query: { action: "nfc-accept" },
    body: { nfcId: "1111111111", origin: "T1" },
  });
  assert.equal(tap.status, 200);
  assert.equal(tap.body.status, "completed");
  assert.equal(tap.body.discountApplied, true);
  assert.equal(tap.body.driver, "Rolando");
});

test("walk-up ride can be handed over by the marshal (override) and cancelled", async () => {
  seed();
  const a = await walkup({});
  const done = await call(requests, {
    method: "POST",
    query: { id: a.body._id, action: "override" },
    body: { driverId: "D1", reason: "Lola can't wait" },
    cookie: await marshal(),
  });
  assert.equal(done.status, 200);
  assert.equal(done.body.status, "completed");
  const b = await walkup({});
  const cancelled = await call(requests, {
    method: "POST",
    query: { id: b.body._id, action: "cancel" },
    cookie: await marshal(),
  });
  assert.equal(cancelled.status, 200);
});

test("walk-up: phone number and who booked never reach the public screens", async () => {
  seed();
  const a = await walkup({
    passengerName: "Lola Rosa",
    contact: "09171234567",
  });
  const pub = await call(requests, { query: { id: a.body._id } });
  assert.equal(pub.status, 200);
  assert.equal(pub.body.walkupContact, undefined);
  assert.equal(pub.body.bookedBy, undefined);
  assert.equal(pub.body.passengerName, undefined);
  const list = await call(requests, { query: { status: "pending" } });
  assert.equal(list.body[0].walkupContact, undefined);
  // staff and drivers do see it
  const staffView = await call(requests, {
    query: { id: a.body._id },
    cookie: await marshal(),
  });
  assert.equal(staffView.body.walkupContact, "09171234567");
});

test("walk-up: the waiting-rides limit applies", async () => {
  seed();
  for (let i = 0; i < 5; i++) assert.equal((await walkup({})).status, 201);
  assert.equal((await walkup({})).status, 409);
});
