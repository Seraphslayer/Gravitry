import { createFakeDb, cookie, call, load } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const { default: requests } = await load("api/requests.js");
const { default: queue } = await load("api/queue.js");
const fare = await load("api/_fare.js");

const T1 = { lat: 14.354615812078766, lng: 120.92335026772189 };
const quote = (pickup) =>
  fare.signQuote({
    pickup: { ...pickup, label: "A" },
    dropoff: { lat: 14.3601, lng: 120.921, label: "B" },
    meters: 1500,
    estimated: false,
    regularFare: fare.regularFareForMeters(1500),
  });

test("terminal line and priority", async (t) => {
  const { T } = createFakeDb();
  const drv = (id, nfc, extra = {}) => ({
    _id: id,
    name: `Driver ${id}`,
    unit: `M${id}`,
    plate: "P",
    status: "available",
    nfcId: nfc,
    ...extra,
  });
  T("drivers").push(
    drv("D1", "1111111111"),
    drv("D2", "2222222222"),
    drv("D3", "3333333333"),
    drv("D4", "4444444444", { licenseStatus: "expired" }),
  );
  T("passengers").push(
    { _id: "P1", status: "verified" },
    { _id: "P2", status: "verified" },
  );
  const P1 = await cookie("passenger", { passengerId: "P1", name: "P1" });
  const P2 = await cookie("passenger", { passengerId: "P2", name: "P2" });
  const A = await cookie("admin");
  const tap = (nfcId) =>
    call(requests, {
      method: "POST",
      query: { action: "nfc-accept" },
      body: { nfcId, origin: "T1" },
    });
  const book = (c, pickup, extra = {}) =>
    call(requests, {
      method: "POST",
      body: {
        origin: "T1",
        destination: "T2",
        quoteToken: quote(pickup),
        ...extra,
      },
      cookie: c,
    });
  const snap = async () =>
    (await call(queue, { query: { terminal: "T1" } })).body;

  await t.test("taps join the line in order", async () => {
    assert.equal((await tap("1111111111")).body.position, 1);
    assert.equal((await tap("2222222222")).body.position, 2);
    assert.equal(
      (await tap("1111111111")).body.position,
      1,
      "tapping again keeps your place",
    );
    assert.equal((await tap("3333333333")).body.position, 3);
    const s = await snap();
    assert.deepEqual(
      s.drivers.map((d) => d.driverId),
      ["D1", "D2", "D3"],
    );
  });

  await t.test("expired driver cannot join or take rides", async () => {
    assert.equal((await tap("4444444444")).status, 403);
  });

  await t.test(
    "passenger counts: at terminal vs app from elsewhere",
    async () => {
      const far = { lat: 14.3601, lng: 120.9215 };
      const a = await book(P1, far); // app, not at the terminal
      const b = await book("", T1, { source: "kiosk" }); // kiosk
      const c = await book(P2, T1); // app, but standing at the terminal
      assert.equal(a.body.priority, 1);
      assert.equal(b.body.priority, 0);
      assert.equal(c.body.priority, 0);
      assert.equal(c.body.atTerminal, true);
      const s = await snap();
      assert.deepEqual(s.passengers, { total: 3, atTerminal: 2, app: 1 });
    },
  );

  await t.test(
    "only the driver at the front may take the next ride",
    async () => {
      const second = await tap("2222222222");
      assert.equal(second.status, 409);
      assert.match(second.body.error, /#2/);
    },
  );

  await t.test(
    "terminal passengers are served first, oldest first, then app",
    async () => {
      const r1 = await tap("1111111111");
      assert.equal(r1.status, 200);
      assert.equal(
        r1.body.source,
        "kiosk",
        "kiosk booked before the at-terminal app ride",
      );
      assert.equal(
        (await tap("2222222222")).body.source,
        "app",
        "the at-terminal app passenger next",
      );
      assert.equal(
        (await tap("3333333333")).body.priority,
        1,
        "the far-away app booking last",
      );
    },
  );

  await t.test("a driver who took a ride left the line", async () => {
    const s = await snap();
    assert.equal(s.drivers.length, 0);
    assert.equal(s.passengers.total, 0);
  });

  await t.test(
    "app drivers in line must serve terminal passengers first",
    async () => {
      await tap("1111111111"); // D1 joins
      const far = await book(P1, { lat: 14.3601, lng: 120.9215 });
      const here = await book("", T1, { source: "kiosk" });
      const D1 = await cookie("driver", { driverId: "D1" });
      const D2 = await cookie("driver", { driverId: "D2" });
      const acc = (id, c) =>
        call(requests, {
          method: "POST",
          query: { id, action: "accept" },
          cookie: c,
        });
      assert.equal(
        (await acc(far.body._id, D1)).status,
        409,
        "in line + terminal passenger waiting",
      );
      assert.equal(
        (await acc(far.body._id, D2)).status,
        200,
        "a driver not in the line is free to take it",
      );
      await call(requests, {
        method: "POST",
        query: { id: here.body._id, action: "cancel" },
      });
    },
  );

  await t.test(
    "join from the Driver app needs to be near a terminal",
    async () => {
      const D3 = await cookie("driver", { driverId: "D3" });
      const join = (lat, lng, c = D3) =>
        call(queue, {
          method: "POST",
          query: { action: "join" },
          body: { lat, lng },
          cookie: c,
        });
      assert.equal((await join(14.4, 120.9)).status, 403, "too far");
      assert.equal((await join(undefined, undefined)).status, 400);
      assert.equal((await join(T1.lat, T1.lng, "")).status, 401);
      const ok = await join(T1.lat + 0.0002, T1.lng);
      assert.equal(ok.status, 200);
      assert.equal(ok.body.terminal, "T1");
      const mine = await call(queue, { query: { action: "mine" }, cookie: D3 });
      assert.equal(mine.body.terminal, "T1");
      await call(queue, {
        method: "POST",
        query: { action: "leave" },
        cookie: D3,
      });
      assert.equal(
        (await call(queue, { query: { action: "mine" }, cookie: D3 })).body,
        null,
      );
    },
  );

  await t.test("admin overview", async () => {
    const all = await call(queue, { query: { action: "all" }, cookie: A });
    assert.equal(all.body.length, 3);
    assert.equal((await call(queue, { query: { action: "all" } })).status, 401);
  });
});
