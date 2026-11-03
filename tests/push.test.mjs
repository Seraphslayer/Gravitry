import { createFakeDb, cookie, call, load } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const { default: auth } = await load("api/auth.js");
const { default: requests } = await load("api/requests.js");
const { default: reports } = await load("api/reports.js");
const fare = await load("api/_fare.js");

const sub = (host = "fcm.googleapis.com", id = "abc") => ({
  endpoint: `https://${host}/fcm/send/${id}`,
  keys: { p256dh: "BKey", auth: "authkey" },
});
const subscribe = async (body, c) =>
  call(auth, {
    method: "POST",
    query: { action: "push-subscribe" },
    body,
    cookie: c,
  });
const log = () => (global._gravitryPushLog ??= []);

function seed() {
  const { T } = createFakeDb();
  global._gravitryPushLog = [];
  T("drivers").push(
    {
      _id: "D1",
      name: "Rolando",
      unit: "M1",
      plate: "ABC",
      status: "available",
      appOnline: true,
      appLastSeen: new Date().toISOString(),
      licenseStatus: "valid",
      franchiseStatus: "valid",
    },
    { _id: "D2", name: "Other", status: "available" },
  );
  T("passengers").push({ _id: "P1", name: "Maria", status: "verified" });
  return T;
}

test("subscribing: login needed, only real push services, own devices only", async () => {
  const T = seed();
  assert.equal((await subscribe({ subscription: sub() }, "")).status, 401);
  const c = await cookie("passenger", { passengerId: "P1" });
  assert.equal(
    (await subscribe({ subscription: sub("evil.example.com") }, c)).status,
    400,
    "not a push service",
  );
  assert.equal(
    (
      await subscribe(
        {
          subscription: {
            endpoint: "http://fcm.googleapis.com/x",
            keys: { p256dh: "a", auth: "b" },
          },
        },
        c,
      )
    ).status,
    400,
    "must be https",
  );
  assert.equal(
    (await subscribe({ subscription: { endpoint: sub().endpoint } }, c)).status,
    400,
    "needs keys",
  );
  assert.equal((await subscribe({ subscription: sub() }, c)).status, 200);
  assert.equal(
    (await subscribe({ subscription: sub() }, c)).status,
    200,
    "same device twice is one entry",
  );
  assert.equal(T("push_subscriptions").length, 1);
  assert.equal(
    T("push_subscriptions")[0].userId,
    "P1",
    "identity comes from the session",
  );
  const gone = await call(auth, {
    method: "POST",
    query: { action: "push-unsubscribe" },
    body: { endpoint: sub().endpoint },
    cookie: c,
  });
  assert.equal(gone.status, 200);
  assert.equal(T("push_subscriptions").length, 0);
});

test("max 5 devices per person", async () => {
  const T = seed();
  const c = await cookie("driver", { driverId: "D1" });
  for (let i = 0; i < 7; i++)
    await subscribe({ subscription: sub("fcm.googleapis.com", "dev" + i) }, c);
  assert.equal(T("push_subscriptions").length, 5);
});

test("ride notifications reach the right people", async () => {
  const T = seed();
  for (const [role, userId, id] of [
    ["driver", "D1", "d1"],
    ["driver", "D2", "d2"],
    ["passenger", "P1", "p1"],
    ["admin", "A1", "a1"],
  ])
    T("push_subscriptions").push({
      _id: id,
      role,
      userId,
      subscription: sub(),
      createdAt: "2026-01-01",
    });
  T("terminal_line").push({
    _id: "D1",
    terminal: "T1",
    joinedAt: new Date().toISOString(),
  });

  const token = fare.signQuote({
    pickup: { lat: 14.356, lng: 120.917, label: "A" },
    dropoff: { lat: 14.36, lng: 120.92, label: "B" },
    meters: 1500,
    estimated: false,
    regularFare: 20,
  });
  const pc = await cookie("passenger", { passengerId: "P1" });
  const booked = await call(requests, {
    method: "POST",
    body: { origin: "T1", destination: "T2", quoteToken: token },
    cookie: pc,
  });
  assert.equal(booked.status, 201);
  assert.equal(log().length, 1);
  assert.deepEqual(
    log()[0].to,
    ["driver:D1"],
    "only the driver lined up at T1, not D2",
  );
  assert.equal(log()[0].title, "May pasahero!");

  const rid = booked.body._id;
  const dc = await cookie("driver", { driverId: "D1" });
  await call(requests, {
    method: "POST",
    query: { id: rid, action: "accept" },
    cookie: dc,
  });
  assert.deepEqual(log()[1].to, ["passenger:P1"]);
  assert.match(log()[1].body, /Rolando/);

  await call(requests, {
    method: "POST",
    query: { id: rid, action: "pickup" },
    cookie: dc,
  });
  assert.equal(log()[2].title, "Dumating na ang driver");
  await call(requests, {
    method: "POST",
    query: { id: rid, action: "complete" },
    cookie: dc,
  });
  assert.equal(log()[3].title, "Nakarating ka na");
  assert.equal(log().length, 4);
});

test("SOS notifies every admin; acknowledging notifies the reporter", async () => {
  const T = seed();
  T("push_subscriptions").push(
    {
      _id: "a1",
      role: "admin",
      userId: "A1",
      subscription: sub(),
      createdAt: "x",
    },
    {
      _id: "a2",
      role: "admin",
      userId: "A2",
      subscription: sub(),
      createdAt: "x",
    },
    {
      _id: "p1",
      role: "passenger",
      userId: "P1",
      subscription: sub(),
      createdAt: "x",
    },
  );
  const sos = await call(reports, {
    method: "POST",
    query: { action: "create" },
    body: { kind: "sos" },
    cookie: await cookie("passenger", { passengerId: "P1" }),
  });
  assert.equal(sos.status, 201);
  assert.deepEqual(log()[0].to.sort(), ["admin:A1", "admin:A2"]);
  assert.equal(log()[0].title, "SOS!");
  assert.equal(log()[0].urgent, true);
  await call(reports, {
    method: "POST",
    query: { id: sos.body.id, action: "ack" },
    body: {},
    cookie: await cookie("admin"),
  });
  assert.deepEqual(log()[1].to, ["passenger:P1"]);
});

test("no subscribers = nothing happens, and booking still works", async () => {
  seed();
  const token = fare.signQuote({
    pickup: { lat: 14.356, lng: 120.917, label: "A" },
    dropoff: { lat: 14.36, lng: 120.92, label: "B" },
    meters: 900,
    estimated: false,
    regularFare: 15,
  });
  const r = await call(requests, {
    method: "POST",
    body: {
      origin: "T1",
      destination: "T2",
      quoteToken: token,
      source: "kiosk",
    },
  });
  assert.equal(r.status, 201);
  assert.equal(log().length, 0);
});
