import { createFakeDb, cookie, call, load } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const fare = await load("api/_fare.js");
const { default: requests } = await load("api/requests.js");

const pickup = { lat: 14.35612, lng: 120.91735, label: "A" };
const dropoff = { lat: 14.3601, lng: 120.921, label: "B" };
const quote = (meters) =>
  fare.signQuote({
    pickup,
    dropoff,
    meters,
    estimated: false,
    regularFare: fare.regularFareForMeters(meters),
  });

test("fare tariff", () => {
  const f = (m) => fare.regularFareForMeters(m);
  assert.ok(
    f(500) <= f(1000) && f(1000) <= f(2500) && f(2500) <= f(5000),
    "never gets cheaper with distance",
  );
  assert.equal(fare.discountedFare(100), 80);
  assert.equal(fare.discountedFare(33), 26, "rounds to whole pesos");
});

test("booking and discounts", async (t) => {
  const { T } = createFakeDb();
  T("passengers").push(
    { _id: "P1", status: "verified", discountType: "student" },
    { _id: "P3", status: "verified", discountType: null },
  );
  T("drivers").push({
    _id: "D1",
    name: "Rolando",
    unit: "M1",
    plate: "A",
    status: "available",
    nfcId: "1234567890",
  });
  T("tricycles").push({ _id: "M1", driverId: "D1", status: "available" });
  const book = async (c, body = {}) =>
    call(requests, {
      method: "POST",
      body: {
        origin: "T1",
        destination: "T2",
        quoteToken: quote(2500),
        ...body,
      },
      cookie: c,
    });
  const regular = fare.regularFareForMeters(2500);

  await t.test("verified student gets 20% off automatically", async () => {
    const r = await book(await cookie("passenger", { passengerId: "P1" }));
    assert.equal(r.status, 201);
    assert.equal(r.body.fare, fare.discountedFare(regular));
    assert.equal(r.body.discountApplied, true);
  });
  await t.test("verified passenger with no discount pays full", async () => {
    const r = await book(await cookie("passenger", { passengerId: "P3" }));
    assert.equal(r.body.fare, regular);
  });
  await t.test(
    "kiosk claim shows the discounted fare but stays pending until the driver's tap",
    async () => {
      T("requests").length = 0;
      const r = await book("", { source: "kiosk", discountClaim: "pwd" });
      assert.equal(r.status, 201);
      assert.equal(r.body.fare, fare.discountedFare(regular));
      assert.equal(r.body.regularFare, regular);
      assert.equal(r.body.discountPending, true);
      assert.notEqual(r.body.discountApplied, true);
      const tap = await call(requests, {
        method: "POST",
        query: { action: "nfc-accept" },
        body: { nfcId: "1234567890", origin: "T1" },
      });
      assert.equal(tap.body.fare, fare.discountedFare(regular));
      assert.equal(tap.body.discountApplied, true);
      assert.equal(tap.body.discountPending, false);
    },
  );
  await t.test("a made-up discount type is refused", async () => {
    const r = await book("", { source: "kiosk", discountClaim: "vip" });
    assert.notEqual(r.status, 201);
  });
});

test("ratings", async (t) => {
  const { T } = createFakeDb();
  T("drivers").push({ _id: "D1", name: "Rolando", rating: 5 });
  T("requests").push(
    { _id: "R1", passengerId: "P1", status: "completed", driverId: "D1" },
    { _id: "R2", passengerId: "P1", status: "dispatched", driverId: "D1" },
    { _id: "R3", passengerId: "P3", status: "completed", driverId: "D1" },
    { _id: "R4", passengerId: "P1", status: "completed", driverId: "D1" },
  );
  const P1 = await cookie("passenger", { passengerId: "P1" });
  const rate = (id, body, c = P1) =>
    call(requests, {
      method: "POST",
      query: { id, action: "rate" },
      body,
      cookie: c,
    });

  await t.test("must be 1-5 stars, on your own finished ride", async () => {
    assert.equal((await rate("R1", { stars: 0 })).status, 400);
    assert.equal((await rate("R1", { stars: 6 })).status, 400);
    assert.notEqual((await rate("R2", { stars: 5 })).status, 200, "unfinished");
    assert.notEqual(
      (await rate("R3", { stars: 5 })).status,
      200,
      "someone else's",
    );
    assert.equal((await rate("R1", { stars: 5 }, "")).status, 401);
  });
  await t.test("once per ride; driver average updates", async () => {
    assert.equal(
      (await rate("R1", { stars: 4, comment: "Maayos" })).status,
      200,
    );
    assert.notEqual(
      (await rate("R1", { stars: 1 })).status,
      200,
      "already rated",
    );
    assert.equal((await rate("R4", { stars: 5 })).status, 200);
    const d = T("drivers")[0];
    assert.equal(d.ratingCount, 2);
    assert.equal(d.rating, 4.5);
  });
});
