import { createFakeDb, cookie, call, load } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const { default: drivers } = await load("api/drivers.js");
const { default: tricycles } = await load("api/tricycles.js");
const { default: requests } = await load("api/requests.js");

function seed() {
  const { T } = createFakeDb();
  T("users").push(
    { _id: "A1", username: "ana", level: "admin", active: true },
    { _id: "A2", username: "gone", level: "admin", active: true },
  );
  T("drivers").push({
    _id: "D1",
    name: "Rolando",
    unit: "M1",
    nfcId: "1111111111",
    license: "L-123",
    contact: "0917",
    status: "available",
  });
  T("tricycles").push({
    _id: "M1",
    driverId: "D1",
    rental: { who: "Juan" },
    status: "available",
  });
  T("requests").push({
    _id: "DR-1",
    status: "completed",
    origin: "T1",
    passengerId: "P1",
    passengerName: "Maria",
    ts: new Date().toISOString(),
  });
  return T;
}
const staff = (id) => cookie("admin", { sub: id, level: "admin" });

test("a disabled admin's old cookie stops seeing staff-only data at once", async () => {
  const T = seed();
  const c = await staff("A2");
  const d = () => call(drivers, { cookie: c });
  const t = () => call(tricycles, { cookie: c });
  const r = () => call(requests, { cookie: c });
  assert.equal(
    (await d()).body[0].nfcId,
    "1111111111",
    "active admin sees the card number",
  );
  assert.ok((await t()).body[0].rental);
  assert.equal((await r()).body[0].passengerName, "Maria");

  T("users").find((u) => u._id === "A2").active = false;
  assert.equal((await d()).body[0].nfcId, undefined);
  assert.equal((await d()).body[0].license, undefined);
  assert.equal((await t()).body[0].rental, undefined);
  assert.equal((await r()).body[0].passengerName, undefined);
  const one = await call(requests, { query: { id: "DR-1" }, cookie: c });
  assert.equal(one.body.passengerName, undefined);

  // a deleted account too
  T("users").splice(
    T("users").findIndex((u) => u._id === "A2"),
    1,
  );
  assert.equal((await d()).body[0].nfcId, undefined);
  // and the other, still active admin is unaffected
  assert.equal(
    (await call(drivers, { cookie: await staff("A1") })).body[0].nfcId,
    "1111111111",
  );
});

test("the ride list is capped to the newest rides", async () => {
  const T = seed();
  for (let i = 0; i < 520; i++)
    T("requests").push({
      _id: `DR-X${i}`,
      status: "completed",
      origin: "T1",
      ts: new Date(Date.now() - i * 1000).toISOString(),
    });
  const r = await call(requests, { cookie: await staff("A1") });
  assert.equal(r.body.length, 500);
  assert.equal(
    r.body[0]._id === "DR-1" || r.body[0]._id === "DR-X0",
    true,
    "newest first",
  );
});
