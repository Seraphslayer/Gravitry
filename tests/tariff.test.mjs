import { createFakeDb, cookie, call, load } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const fare = await load("api/_fare.js");
const { default: fares } = await load("api/fares.js");
const { default: quoteApi } = await load("api/quote.js");
const { default: requests } = await load("api/requests.js");

const good = {
  firstKm: 1,
  firstKmFare: 20,
  stepKm: 2,
  stepFare: 10,
  discountPercent: 30,
  specialMultiplier: 3,
};
const patch = async (body, who = "admin") =>
  call(fares, {
    method: "PATCH",
    body,
    cookie: who ? await cookie(who) : "",
  });

test("default tariff matches the posted TODA numbers", () => {
  const f = (m) => fare.regularFareForMeters(m);
  assert.equal(f(900), 15);
  assert.equal(f(2500), 20);
  assert.equal(f(4000), 25);
  assert.equal(fare.discountedFare(15), 12);
  assert.equal(fare.discountedFare(20), 16);
  const rows = fare.tariffTable();
  assert.deepEqual(
    [rows[0].regular, rows[0].special, rows[0].discounted],
    [15, 45, 12],
  );
  assert.equal(rows[1].regular, 20);
});

test("only an admin can change the tariff, and it is validated", async () => {
  createFakeDb();
  assert.equal((await patch(good, null)).status, 401);
  assert.equal((await patch(good, "passenger")).status, 403);
  assert.equal((await patch({ ...good, firstKmFare: -5 })).status, 400);
  assert.equal((await patch({ ...good, discountPercent: 90 })).status, 400);
  assert.equal((await patch({ ...good, stepKm: "2" })).status, 400);
  assert.equal((await patch({ ...good, stepKm: 0 })).status, 400);
  const ok = await patch(good);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.tariff.firstKmFare, 20);
  assert.equal(ok.body.rows[0].regular, 20);
});

test("a saved tariff changes the quote, the booking and the discount", async () => {
  const { T } = createFakeDb();
  await patch(good);
  const pub = await call(fares);
  assert.equal(pub.body.tariff.discountPercent, 30, "public can read it");

  // 500 m is within the first km -> the new first-km fare
  const q = await call(quoteApi, {
    method: "POST",
    body: {
      pickup: { lat: 14.3561, lng: 120.9173, label: "A" },
      dropoff: { lat: 14.3563, lng: 120.9174, label: "B" },
    },
  });
  assert.equal(q.status, 200);
  assert.equal(q.body.regularFare, 20);
  assert.equal(q.body.discountPercent, 30);

  const booked = await call(requests, {
    method: "POST",
    body: {
      origin: "T1",
      destination: "T2",
      quoteToken: q.body.quoteToken,
      source: "kiosk",
      discountClaim: "student",
    },
  });
  assert.equal(booked.status, 201);
  assert.equal(booked.body.regularFare, 20);
  assert.equal(booked.body.fare, 14, "30% off 20");
  assert.equal(T("settings").length, 1);
});
