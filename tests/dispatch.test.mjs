import { createFakeDb, cookie, call, load } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const { default: requests } = await load("api/requests.js");
const { default: staff } = await load("api/staff.js");

test("NFC tap, attendance, manual override, staff card", async (t) => {
  const { T } = createFakeDb();
  T("drivers").push(
    {
      _id: "D1",
      name: "Rolando",
      unit: "M1",
      plate: "A",
      status: "available",
      nfcId: "1111111111",
    },
    {
      _id: "D2",
      name: "Expired",
      unit: "M2",
      status: "available",
      licenseStatus: "expired",
      nfcId: "2222222222",
    },
    { _id: "D3", name: "Busy", unit: "M3", status: "on_trip" },
  );
  T("tricycles").push({ _id: "M1", driverId: "D1", status: "available" });
  const A = await cookie("admin");
  const D = await cookie("driver", { driverId: "D1" });
  const tap = (nfcId) =>
    call(requests, {
      method: "POST",
      query: { action: "nfc-accept" },
      body: { nfcId, origin: "T1" },
    });
  const S = (action, body, extra = {}) =>
    call(staff, { method: "POST", query: { action }, body, ...extra });

  await t.test(
    "a tap with nothing waiting is a check-in (attendance)",
    async () => {
      const a = await tap("1111111111");
      assert.equal(a.status, 200);
      assert.equal(a.body.checkedIn, true);
      assert.equal(a.body.first, true);
      assert.equal((await tap("1111111111")).body.first, false);
    },
  );
  await t.test("expired / unknown cards are refused", async () => {
    assert.equal((await tap("2222222222")).status, 403);
    assert.equal((await tap("5555555555")).status, 404);
  });
  await t.test("admin can read attendance, others cannot", async () => {
    const r = await call(staff, { query: { action: "attendance" }, cookie: A });
    assert.equal(r.body.rows.length, 1);
    assert.equal(r.body.rows[0].taps, 2);
    assert.equal(
      (await call(staff, { query: { action: "attendance" }, cookie: D }))
        .status,
      403,
    );
  });
  await t.test("kiosk rides are served before app rides", async () => {
    T("requests").push(
      {
        _id: "APP",
        status: "pending",
        source: "app",
        passengerId: "P1",
        origin: "T1",
        destination: "T2",
        ts: "2026-01-01T00:00:00Z",
      },
      {
        _id: "KIOSK",
        status: "pending",
        source: "kiosk",
        origin: "T1",
        destination: "T2",
        ts: "2026-01-01T00:05:00Z",
      },
    );
    assert.equal((await tap("1111111111")).body._id, "KIOSK");
    T("requests").length = 0;
  });

  await t.test("manual override by admin", async () => {
    T("requests").push(
      {
        _id: "R1",
        status: "pending",
        source: "kiosk",
        origin: "T1",
        destination: "T2",
        discountClaim: "pwd",
      },
      {
        _id: "R2",
        status: "pending",
        source: "kiosk",
        origin: "T1",
        destination: "T2",
      },
    );
    const ov = (id, body, c) =>
      call(requests, {
        method: "POST",
        query: { id, action: "override" },
        body,
        cookie: c,
      });
    assert.equal(
      (await ov("R1", { driverId: "D1", reason: "lost card" }, D)).status,
      403,
      "drivers can't",
    );
    assert.equal(
      (await ov("R1", { driverId: "D1" }, A)).status,
      400,
      "reason required",
    );
    assert.equal(
      (await ov("R1", { driverId: "D2", reason: "lost card" }, A)).status,
      403,
      "expired",
    );
    assert.equal(
      (await ov("R1", { driverId: "D3", reason: "lost card" }, A)).status,
      409,
      "on a trip",
    );
    const ok = await ov("R1", { driverId: "D1", reason: "lost card" }, A);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.status, "completed");
    assert.equal(ok.body.discountApplied, true);
    assert.equal(ok.body.manualOverride.reason, "lost card");
    assert.equal(
      (await ov("R1", { driverId: "D1", reason: "again" }, A)).status,
      409,
    );
  });

  await t.test("staff card + PIN", async () => {
    assert.equal(
      (
        await S("card-create", {
          name: "Ana",
          nfcId: "9999999999",
          pin: "1234",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await S(
          "card-create",
          { name: "Ana", nfcId: "9999999999", pin: "12" },
          { cookie: A },
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await S(
          "card-create",
          { name: "Ana", nfcId: "1111111111", pin: "1234" },
          { cookie: A },
        )
      ).status,
      409,
      "a driver's card",
    );
    assert.equal(
      (
        await S(
          "card-create",
          { name: "Ana", nfcId: "9999999999", pin: "1234" },
          { cookie: A },
        )
      ).status,
      201,
    );

    assert.equal((await tap("9999999999")).body.staffCard, true);
    assert.equal(
      (await S("login", { nfcId: "9999999999", pin: "0000" })).status,
      401,
    );
    const login = await S("login", { nfcId: "9999999999", pin: "1234" });
    assert.equal(login.status, 200);
    const H = { headers: { "x-staff-token": login.body.token } };

    assert.equal(
      (await call(staff, { query: { action: "drivers" } })).status,
      401,
      "no token",
    );
    const asCookieToken = await cookie("admin");
    assert.equal(
      (
        await call(staff, {
          query: { action: "drivers" },
          headers: { "x-staff-token": asCookieToken.split("=")[1] },
        })
      ).status,
      401,
      "a login session is not a staff token",
    );
    const list = await call(staff, { query: { action: "drivers" }, ...H });
    assert.equal(list.status, 200);
    assert.equal(list.body.find((d) => d.id === "D2").eligible, false);

    assert.equal(
      (await S("assign", { requestId: "R2", driverId: "D2" }, H)).status,
      403,
    );
    assert.equal(
      (await S("assign", { requestId: "R2", driverId: "D1" }, H)).status,
      200,
    );
    T("requests").push({
      _id: "R3",
      status: "pending",
      source: "kiosk",
      origin: "T1",
      destination: "T2",
    });
    assert.equal((await S("cancel", { requestId: "R3" }, H)).status, 200);
    assert.equal((await S("cancel", { requestId: "R3" }, H)).status, 409);
    assert.equal((await S("checkin", { driverId: "D3" }, H)).status, 200);
    assert.equal(
      (await S("checkin", { driverId: "D2" }, H)).status,
      403,
      "expired",
    );
  });

  await t.test("wrong PINs lock the card; reset PIN unlocks", async () => {
    let r;
    for (let i = 0; i < 6; i++)
      r = await S("login", { nfcId: "9999999999", pin: "0000" });
    assert.equal(r.status, 429);
    assert.equal(
      (await S("login", { nfcId: "9999999999", pin: "1234" })).status,
      429,
      "right PIN still locked",
    );
    assert.equal(
      (
        await S(
          "card-update",
          { pin: "5678" },
          { query: { action: "card-update", id: "9999999999" }, cookie: A },
        )
      ).status,
      200,
    );
    assert.equal(
      (await S("login", { nfcId: "9999999999", pin: "5678" })).status,
      200,
    );
    await S(
      "card-update",
      { active: false },
      { query: { action: "card-update", id: "9999999999" }, cookie: A },
    );
    assert.equal(
      (await tap("9999999999")).status,
      404,
      "disabled card is just unknown",
    );
  });
});
