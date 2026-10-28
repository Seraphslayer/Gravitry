import { createFakeDb, cookie, call, load } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const { default: reports } = await load("api/reports.js");

test("SOS and incident reports", async (t) => {
  const { T } = createFakeDb();
  T("passengers").push({ _id: "P1", name: "Juan", phone: "0917" });
  T("drivers").push({
    _id: "D1",
    name: "Rolando",
    contact: "0918",
    unit: "M1",
  });
  T("requests").push(
    { _id: "R1", passengerId: "P1", driverId: "D1", status: "dispatched" },
    { _id: "R2", passengerId: "P9", driverId: "D9", status: "dispatched" },
  );
  const P = await cookie("passenger", { passengerId: "P1" });
  const D = await cookie("driver", { driverId: "D1" });
  const A = await cookie("admin");
  const post = (query, body, c) =>
    call(reports, { method: "POST", query, body, cookie: c });

  await t.test("needs a login", async () => {
    assert.equal(
      (await post({ action: "create" }, { kind: "sos" })).status,
      401,
    );
  });
  await t.test("SOS works with or without a location", async () => {
    const r = await post(
      { action: "create" },
      { kind: "sos", requestId: "R1", lat: 14.356, lng: 120.917 },
      P,
    );
    assert.equal(r.status, 201);
    assert.equal(
      (await post({ action: "create" }, { kind: "sos", lat: 1, lng: 2 }, P))
        .status,
      201,
    );
  });
  await t.test("incident needs a category and a description", async () => {
    assert.equal(
      (
        await post(
          { action: "create" },
          { kind: "incident", description: "hello there" },
          P,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          { action: "create" },
          { kind: "incident", category: "accident", description: "a" },
          P,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          { action: "create" },
          {
            kind: "incident",
            category: "refused_to_pay",
            description: "hello there",
          },
          P,
        )
      ).status,
      400,
      "driver-only category",
    );
    assert.equal(
      (
        await post(
          { action: "create" },
          {
            kind: "incident",
            category: "overcharging",
            description: "Sobra singil",
          },
          P,
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await post(
          { action: "create" },
          {
            kind: "incident",
            category: "refused_to_pay",
            description: "Hindi nagbayad",
          },
          D,
        )
      ).status,
      201,
    );
  });
  await t.test("only the reporter's own ride is attached", async () => {
    await post(
      { action: "create" },
      {
        kind: "incident",
        category: "accident",
        description: "Someone else's ride",
        requestId: "R2",
      },
      P,
    );
    const all = (await call(reports, { cookie: A })).body;
    assert.equal(all.at(0).ride, null);
  });
  await t.test("admin only: list, alerts, ack, resolve", async () => {
    assert.equal((await call(reports, { cookie: P })).status, 403);
    assert.equal(
      (await call(reports, { query: { action: "alerts" }, cookie: P })).status,
      403,
    );
    const alerts = (
      await call(reports, { query: { action: "alerts" }, cookie: A })
    ).body;
    assert.ok(
      alerts.length > 0 && alerts.every((a) => a.status !== "resolved"),
    );
    const id = alerts.find((a) => a.kind === "sos")._id;
    assert.equal((await post({ id, action: "ack" }, {}, P)).status, 403);
    assert.equal((await post({ id, action: "ack" }, {}, A)).status, 200);
    assert.equal(
      (await post({ id, action: "resolve" }, { note: "ok na" }, A)).status,
      200,
    );
    assert.equal((await post({ id, action: "resolve" }, {}, A)).status, 409);
    assert.equal(
      (await post({ id: "IR-999", action: "ack" }, {}, A)).status,
      404,
    );
  });
  await t.test("rate limit (6 per 10 min)", async () => {
    let last;
    for (let i = 0; i < 8; i++)
      last = await post({ action: "create" }, { kind: "sos" }, P);
    assert.equal(last.status, 429);
  });
});
