import { getDb } from "./_db.js";
import { getSessionFromReq, getStaffFromReq } from "./_auth.js";
import { requireSession, isNonEmptyString } from "./_authz.js";
import { tempAccessDeadline } from "./_settings.js";
import { verifyQuote, buildPricing, DISCOUNT_TYPES } from "./_fare.js";
import {
  expiredDocsOf,
  driverAppActive,
  recordAttendance,
  assignRide,
  joinLine,
  leaveLine,
  getLine,
  ridePriority,
} from "./_dispatch.js";
import {
  terminalById,
  distanceMeters,
  AT_TERMINAL_METERS,
} from "./_terminals.js";

// true  = only the driver at the front of the terminal line may take the next
//         ride at that terminal (others see their place in line).
// false = any checked-in driver may take it.
const LINE_STRICT = true;

// Policy switch: may a passenger whose account is still pending staff
// verification book rides? true = yes (temporary account works, flagged on the
// request). false = they must wait until TODA staff approve them.
// Rejected accounts can never book until they resubmit and get approved.
const PENDING_CAN_BOOK = true;

// Kiosk rides must be accepted by an NFC card tap. Only one may be pending per
// kiosk at a time; stale ones expire so the kiosk can never get stuck.
const KIOSK_PENDING_TTL_MIN = 10;
// There is only one kiosk, so passengers queue up: several kiosk rides may wait
// for a driver at once. Each NFC tap accepts the oldest one first.
const KIOSK_MAX_WAITING = 5;

async function nextId(db, name, prefix) {
  const result = await db
    .collection("counters")
    .findOneAndUpdate(
      { _id: name },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after" },
    );
  const seq = result.value?.seq ?? result.seq ?? 1;
  return `${prefix}-${String(seq).padStart(3, "0")}`;
}

// --- NFC tap rate limiting -------------------------------------------------
// The nfc-accept endpoint has no secret key protecting it, since the browser
// calls it directly and any key embedded in frontend JS could be read from
// dev tools. The card ID itself is the only "credential", so this endpoint
// leans harder on validation and rate limiting than most others.
const NFC_MAX_ATTEMPTS = 5;
const NFC_LOCK_MINUTES = 15;
const NFC_GLOBAL_MAX_PER_MINUTE = 30;

async function isNfcIdLocked(db, nfcId) {
  const doc = await db.collection("nfc_attempts").findOne({ _id: nfcId });
  return !!(doc?.lockUntil && new Date(doc.lockUntil) > new Date());
}

async function recordNfcIdFailure(db, nfcId) {
  const now = new Date();
  const doc = await db.collection("nfc_attempts").findOne({ _id: nfcId });
  const count = (doc?.count || 0) + 1;
  const update = { count, lastAttempt: now };
  if (count >= NFC_MAX_ATTEMPTS) {
    update.lockUntil = new Date(now.getTime() + NFC_LOCK_MINUTES * 60000);
    update.count = 0;
  }
  await db
    .collection("nfc_attempts")
    .updateOne({ _id: nfcId }, { $set: update }, { upsert: true });
}

// Blunt global circuit-breaker: caps total nfc-accept calls per minute
// across all callers, so a script cycling through many card IDs quickly
// gets shut down even before any single ID's lockout kicks in.
async function withinGlobalNfcRate(db) {
  const now = new Date();
  const doc = await db.collection("nfc_rate_limit").findOne({ _id: "global" });
  if (!doc || now - new Date(doc.windowStart) > 60000) {
    await db
      .collection("nfc_rate_limit")
      .updateOne(
        { _id: "global" },
        { $set: { windowStart: now, count: 1 } },
        { upsert: true },
      );
    return true;
  }
  if (doc.count >= NFC_GLOBAL_MAX_PER_MINUTE) return false;
  await db
    .collection("nfc_rate_limit")
    .updateOne({ _id: "global" }, { $inc: { count: 1 } });
  return true;
}

// Who may see a ride's passenger details (name, id, exact map points)? TODA
// staff (admin), drivers, and the kiosk staff panel. Everyone else (the public
// kiosk screen, other passengers) gets the trimmed view below.
function canSeePassengerDetails(req) {
  if (getStaffFromReq(req)) return true;
  const s = getSessionFromReq(req);
  return s?.role === "admin" || s?.role === "driver";
}

// A ride without who booked it or where exactly they stand. Ride ids are
// sequential (DR-001, DR-002...), so the public lookup must not leak these.
function publicView(doc) {
  const {
    passengerId: _a,
    passengerName: _b,
    passengerStatus: _c,
    discountConfirmedBy: _d,
    manualOverride: _e,
    ...rest
  } = doc;
  if (rest.pickup) rest.pickup = { label: rest.pickup.label ?? null };
  if (rest.dropoff) rest.dropoff = { label: rest.dropoff.label ?? null };
  return rest;
}

export default async function handler(req, res) {
  try {
    const db = await getDb();
    const col = db.collection("requests");
    const { id, action, status, origin, passengerId } = req.query;

    // POST /api/requests  - kiosk or passenger app creates a pending ride request
    if (req.method === "POST" && !id && !action) {
      // origin / destination are the TERMINALS nearest to the pickup and
      // drop-off points. They only decide which terminal's queue the ride goes
      // to and where the tricycle ends up; the exact points and the fare come
      // from the signed quote below.
      const { origin: o, destination, quoteToken } = req.body || {};
      if (!isNonEmptyString(o) || !isNonEmptyString(destination)) {
        return res
          .status(400)
          .json({ error: "origin and destination are required" });
      }

      // The route and fare always come from a quote the server signed (see
      // /api/quote), never from the browser, so a tampered request can't set
      // its own distance, price or discount.
      const quote = verifyQuote(quoteToken);
      if (!quote) {
        return res.status(400).json({
          error: "Your fare quote expired. Please go back and try again.",
        });
      }
      const regularFare = quote.regularFare;

      // Passenger identity is derived from the session, never trusted from the
      // request body - otherwise anyone could tag a ride with someone else's
      // passengerId and pollute their ride history. Guests (no session) simply
      // get no passenger fields, same as before.
      const session = getSessionFromReq(req);

      // Where the ride was created. A logged-in passenger is always the app;
      // otherwise the caller says "kiosk" (the kiosk has no login).
      const source =
        session?.role !== "passenger" && req.body?.source === "kiosk"
          ? "kiosk"
          : "app";

      if (source === "kiosk") {
        const cutoff = new Date(
          Date.now() - KIOSK_PENDING_TTL_MIN * 60000,
        ).toISOString();
        await col.updateMany(
          {
            status: "pending",
            source: "kiosk",
            origin: o,
            ts: { $lt: cutoff },
          },
          {
            $set: {
              status: "cancelled",
              cancelReason: "expired",
              cancelledAt: new Date().toISOString(),
            },
          },
        );
        const waiting = await col.countDocuments({
          status: "pending",
          source: "kiosk",
          origin: o,
        });
        if (waiting >= KIOSK_MAX_WAITING) {
          return res.status(409).json({
            error: `The kiosk queue is full (${KIOSK_MAX_WAITING} rides waiting for a driver). Please try again in a moment.`,
          });
        }
      }

      let identity = {};
      let passengerDoc = null;
      let kioskClaim = null;

      if (session?.role === "passenger") {
        const p = await db.collection("passengers").findOne(
          { _id: session.passengerId },
          {
            projection: {
              status: 1,
              discountType: 1,
              verificationSubmittedAt: 1,
              createdAt: 1,
              tempAccessUntil: 1,
            },
          },
        );
        if (!p) {
          return res.status(401).json({ error: "Account not found" });
        }
        const status = p.status || "verified";
        if (status === "rejected") {
          return res.status(403).json({
            error:
              "Your account verification was rejected. Please resubmit your documents.",
          });
        }
        if (status === "pending" && !PENDING_CAN_BOOK) {
          return res.status(403).json({
            error: "Your account is still waiting for TODA staff verification.",
          });
        }
        // Temporary access (not yet verified) only lasts so long; the admin
        // time left can be set per account by the admin (Verify tab).
        if (status === "pending") {
          const until = tempAccessDeadline(p);
          if (until && new Date(until) < new Date()) {
            return res.status(403).json({
              error:
                "Your temporary access has expired. You can book rides again once TODA staff verify your account.",
            });
          }
        }
        identity = {
          passengerId: session.passengerId,
          passengerName: session.name,
          passengerStatus: status,
        };
        // A discount staff approved on the passenger's ID applies
        // automatically. Pending accounts pay the regular fare until then
        // (buildPricing checks the status).
        passengerDoc = p;
      } else if (source === "kiosk") {
        // At the kiosk the passenger only says which discount they are
        // claiming. It is not applied for real until the driver checks the ID
        // in person and taps their NFC card (see nfc-accept below).
        const claim = req.body?.discountClaim;
        if (claim != null && claim !== "") {
          if (typeof claim !== "string" || !DISCOUNT_TYPES.includes(claim)) {
            return res.status(400).json({ error: "Invalid discount type" });
          }
          kioskClaim = claim;
        }
      }

      const pricing = buildPricing(regularFare, {
        passenger: passengerDoc,
        source,
        claim: kioskClaim,
      });

      const term = terminalById(o);
      const atTerminal =
        source === "kiosk" ||
        (!!term &&
          !!quote.pickup &&
          distanceMeters(quote.pickup, term) <= AT_TERMINAL_METERS);

      const reqId = await nextId(db, "requests", "DR");
      const doc = {
        _id: reqId,
        origin: o,
        destination,
        // Exact points the passenger picked on the map (from the signed quote)
        pickup: quote.pickup,
        dropoff: quote.dropoff,
        distanceMeters: quote.meters,
        distanceEstimated: !!quote.estimated,
        ...pricing,
        status: "pending",
        source,
        // Passengers at the terminal (kiosk, or app pickup at the terminal) are
        // served before app bookings made from elsewhere.
        atTerminal,
        priority: ridePriority({ source, atTerminal }),
        ts: new Date().toISOString(),
        ...identity,
      };
      await col.insertOne(doc);
      return res.status(201).json(doc);
    }

    // POST /api/requests?action=nfc-accept  - driver taps their NFC card at a
    // terminal. The reader is a keyboard-emulation USB device, so the
    // browser itself calls this directly - there's no secret key involved
    // (see the rate-limiting helpers above for how this stays protected
    // without one). Dispatches the highest-priority pending request at that
    // terminal (kiosk-created first, then oldest) to the card's linked driver.
    //
    // EVERY ride accepted by a card tap is simply RECORDED as completed at the
    // moment of the tap: the kiosk exists for drivers who have no phone, so
    // they never open the Driver app (and can never get stuck as "on_trip").
    // For a kiosk ride with a discount claim, the tap is also the driver
    // confirming they checked the passenger's ID, so the discount is applied.
    // (Rides accepted inside the Driver app itself still use dispatched ->
    // complete, see action=accept below.)
    if (req.method === "POST" && !id && action === "nfc-accept") {
      const { nfcId, origin: term } = req.body || {};
      if (
        !isNonEmptyString(nfcId) ||
        !/^[0-9]{6,20}$/.test(nfcId) ||
        !isNonEmptyString(term)
      ) {
        return res.status(400).json({ error: "Invalid card or terminal" });
      }

      if (!(await withinGlobalNfcRate(db))) {
        return res.status(429).json({
          error: "Too many NFC requests right now. Try again shortly.",
        });
      }
      if (await isNfcIdLocked(db, nfcId)) {
        return res
          .status(429)
          .json({ error: "This card is temporarily locked. Try again later." });
      }

      const driver = await db.collection("drivers").findOne({ nfcId });
      if (!driver) {
        // An admin staff card opens the kiosk staff panel (PIN comes next).
        const staffCard = await db
          .collection("staff_cards")
          .findOne({ _id: nfcId, active: true });
        if (staffCard)
          return res
            .status(200)
            .json({ staffCard: true, name: staffCard.name });
        await recordNfcIdFailure(db, nfcId);
        return res.status(404).json({ error: "Card not recognized" });
      }
      if (driver.status === "on_trip") {
        return res
          .status(409)
          .json({ error: "You already have an active trip" });
      }
      const expiredNfc = expiredDocsOf(driver);
      if (expiredNfc.length) {
        return res.status(403).json({
          error: `Your ${expiredNfc.join(" and ")} has expired. Please renew it with TODA staff before accepting rides.`,
        });
      }

      // Tapping at the kiosk counts as attendance at this terminal today.
      const attendance = await recordAttendance(db, driver, term, "nfc");

      // Tapping also puts the driver in the terminal's line (if not already).
      let line = await getLine(db, term);
      if (!line.some((d) => d.driverId === driver._id)) {
        await joinLine(db, driver, term, "nfc");
        line = await getLine(db, term);
      }
      const position = line.findIndex((d) => d.driverId === driver._id) + 1;

      // Passengers at the terminal first (priority 0), then app bookings from
      // elsewhere; oldest first within each group. Old requests with no
      // priority field are treated as priority 0.
      const pendingReq = await col.findOne(
        { status: "pending", origin: term },
        { sort: { priority: 1, ts: 1 } },
      );
      if (!pendingReq)
        // Nothing to accept: the tap was a check-in.
        return res.status(200).json({
          checkedIn: true,
          first: attendance.first,
          at: attendance.at,
          driver: driver.name,
          unit: driver.unit || null,
          terminal: term,
          position,
          lineLength: line.length,
        });

      if (LINE_STRICT && position > 1)
        return res.status(409).json({
          error: `Hindi mo pa turn. Ikaw ay #${position} sa pila, uunahin si ${line[0].name}.`,
        });

      const nowIso = new Date().toISOString();

      // A passenger-app ride whose driver has the Driver app online stays
      // "dispatched": the passenger can then watch the driver come and the
      // driver finishes the trip in the app. Everything else (kiosk rides,
      // drivers without the app) is recorded as completed on the spot.
      const trackable =
        pendingReq.source !== "kiosk" &&
        !!pendingReq.passengerId &&
        driverAppActive(driver);

      const update = trackable
        ? {
            status: "dispatched",
            driver: driver.name,
            driverId: driver._id,
            unit: driver.unit,
            plate: driver.plate || "N/A",
            acceptedAt: nowIso,
            acceptedViaNfc: true,
          }
        : {
            status: "completed",
            driver: driver.name,
            driverId: driver._id,
            unit: driver.unit,
            plate: driver.plate || "N/A",
            acceptedAt: nowIso,
            completedAt: nowIso,
            recordedViaNfc: true,
          };
      // Kiosk discount claim: the driver's tap confirms they checked the ID.
      // (App rides already carry a staff-verified discount from creation.)
      if (pendingReq.discountClaim) {
        update.discountType = pendingReq.discountClaim;
        update.discountApplied = true;
        update.discountPending = false;
        update.discountConfirmedBy = driver._id;
      }

      const result = await col.findOneAndUpdate(
        { _id: pendingReq._id, status: "pending" },
        { $set: update },
        { returnDocument: "after" },
      );
      const doc = result?.value ?? result;
      if (!doc)
        return res
          .status(409)
          .json({ error: "That request was just taken. Try again." });

      // The driver took a ride, so they leave the line.
      await leaveLine(db, driver._id);

      if (trackable) {
        // Trip in progress: same bookkeeping as accepting in the Driver app.
        await db
          .collection("drivers")
          .updateOne({ _id: driver._id }, { $set: { status: "on_trip" } });
        await db
          .collection("tricycles")
          .updateOne(
            { driverId: driver._id },
            { $set: { status: "on_trip", terminal: null } },
          );
        return res.status(200).json(doc);
      }

      // Trip is already on record: the driver stays available and their
      // tricycle is now listed at the drop-off terminal.
      await db
        .collection("drivers")
        .updateOne({ _id: driver._id }, { $inc: { tripsCompleted: 1 } });
      await db
        .collection("tricycles")
        .updateOne(
          { driverId: driver._id },
          { $set: { status: "available", terminal: doc.destination } },
        );

      return res.status(200).json(doc);
    }

    // GET /api/requests?status=pending&origin=T1&passengerId=P-001  - list/filter
    if (req.method === "GET" && !id) {
      const filter = {};
      if (status) filter.status = status;
      if (origin) filter.origin = origin;

      if (passengerId) {
        // Ride history is private - only the passenger themself or an admin
        // may read it. Without this, sequential passenger IDs (P-001, P-002...)
        // would let anyone browse anyone else's trip history.
        const session = requireSession(req, res);
        if (!session) return;
        if (session.role !== "admin" && session.passengerId !== passengerId) {
          return res
            .status(403)
            .json({ error: "Not authorized to view this ride history" });
        }
        filter.passengerId = passengerId;
      }

      const docs = await col.find(filter).sort({ ts: -1 }).toArray();
      // Own history (passengerId) was already checked above; any other list is
      // trimmed unless staff or a driver is asking.
      const full = passengerId || canSeePassengerDetails(req);
      return res.status(200).json(full ? docs : docs.map(publicView));
    }

    // GET /api/requests?id=DR-001  - single lookup (used by kiosk/passenger
    // waiting screens; intentionally public since the requester may not be
    // logged in, and the safety-record contents are meant to be shown here)
    if (req.method === "GET" && id && !action) {
      const doc = await col.findOne({ _id: id });
      if (!doc) return res.status(404).json({ error: "Request not found" });
      const me = getSessionFromReq(req);
      const owner =
        me?.role === "passenger" && me.passengerId === doc.passengerId;
      return res
        .status(200)
        .json(owner || canSeePassengerDetails(req) ? doc : publicView(doc));
    }

    // GET /api/requests?id=DR-001&action=track
    // Lets the passenger who booked a ride watch their driver approach: the
    // request plus the driver's live position, only while the ride is
    // "dispatched" and only if the position is fresh. Owner (or admin) only.
    if (req.method === "GET" && id && action === "track") {
      const session = requireSession(req, res, ["passenger", "admin"]);
      if (!session) return;
      const doc = await col.findOne({ _id: id });
      if (!doc) return res.status(404).json({ error: "Request not found" });
      if (
        session.role === "passenger" &&
        doc.passengerId !== session.passengerId
      ) {
        return res.status(403).json({ error: "Not your request" });
      }
      let driverLocation = null;
      if (doc.status === "dispatched" && doc.driverId) {
        const d = await db
          .collection("drivers")
          .findOne({ _id: doc.driverId }, { projection: { appLocation: 1 } });
        const loc = d?.appLocation;
        if (loc && Date.now() - new Date(loc.at).getTime() < 60 * 1000) {
          driverLocation = { lat: loc.lat, lng: loc.lng, at: loc.at };
        }
      }
      return res.status(200).json({ request: doc, driverLocation });
    }

    // POST /api/requests?id=DR-001&action=pickup
    // The driver has reached the passenger. Tells the passenger's screen to
    // switch from "driver is coming" to "on the way to the drop-off".
    if (req.method === "POST" && id && action === "pickup") {
      const session = requireSession(req, res, ["driver"]);
      if (!session) return;
      const result = await col.findOneAndUpdate(
        {
          _id: id,
          driverId: session.driverId,
          status: "dispatched",
          pickedUpAt: { $exists: false },
        },
        { $set: { pickedUpAt: new Date().toISOString() } },
        { returnDocument: "after" },
      );
      const doc = result?.value ?? result;
      if (!doc)
        return res
          .status(404)
          .json({ error: "Trip not found, or already marked picked up" });
      return res.status(200).json(doc);
    }

    // POST /api/requests?id=DR-001&action=accept
    // POST /api/requests?id=DR-001&action=override   { driverId, reason }
    // MANUAL OVERRIDE (admin only): TODA staff assign a waiting ride to a
    // driver by hand, for when the NFC tap can't happen (lost card, reader or
    // kiosk offline). Same safety rules as a tap: expired license/franchise or
    // a driver already on a trip is still refused. The ride is stamped with who
    // did it and why, so it shows in the audit trail.
    if (req.method === "POST" && id && action === "override") {
      const session = requireSession(req, res, ["admin"]);
      if (!session) return;
      const { driverId, reason } = req.body || {};
      if (!isNonEmptyString(driverId))
        return res.status(400).json({ error: "Choose a driver" });
      const why = typeof reason === "string" ? reason.trim().slice(0, 200) : "";
      if (why.length < 3)
        return res.status(400).json({ error: "Please give a short reason" });
      const out = await assignRide(db, {
        id,
        driverId,
        reason: why,
        by: session.sub || "admin",
      });
      return res.status(out.code).json(out.body);
    }

    if (req.method === "POST" && id && action === "accept") {
      // Only an authenticated driver can accept, and only as themself - the
      // driverId always comes from the session, never the request body, so
      // one driver can't accept a trip "as" another driver.
      const session = requireSession(req, res, ["driver"]);
      if (!session) return;
      const driverId = session.driverId;

      // Kiosk rides are NFC-only: the driver must physically tap their card
      // at the kiosk. (Remove this block to also allow the Driver app.)
      const target = await col.findOne({ _id: id });
      if (target?.source === "kiosk") {
        return res.status(403).json({
          error:
            "Kiosk rides must be accepted by tapping your NFC card at the kiosk.",
        });
      }

      const driver = await db.collection("drivers").findOne({ _id: driverId });
      if (!driver) return res.status(404).json({ error: "Driver not found" });
      if (driver.status === "on_trip")
        return res
          .status(409)
          .json({ error: "You already have an active trip" });

      // Passengers at the terminal come first: a driver who is waiting in that
      // terminal's line must serve them (by NFC tap) before an app booking from
      // elsewhere. Drivers not in that line are not held back.
      if (target && (target.priority ?? 0) === 1) {
        const myLine = await db
          .collection("terminal_line")
          .findOne({ _id: driverId });
        if (myLine && myLine.terminal === target.origin) {
          const waitingHere = await col.countDocuments({
            status: "pending",
            origin: target.origin,
            priority: 0,
          });
          if (waitingHere > 0)
            return res.status(409).json({
              error:
                "May pasahero sa terminal na uunahin. I-tap ang NFC card mo sa kiosk.",
            });
        }
      }

      // Block drivers whose license or franchise has expired.
      const expiredDocs = expiredDocsOf(driver);
      if (expiredDocs.length) {
        return res.status(403).json({
          error: `Your ${expiredDocs.join(" and ")} has expired. Please renew it with TODA staff before accepting rides.`,
        });
      }

      const update = {
        status: "dispatched",
        driver: driver.name,
        driverId: driver._id,
        unit: driver.unit,
        plate: driver.plate || "N/A",
        acceptedAt: new Date().toISOString(),
      };
      const result = await col.findOneAndUpdate(
        { _id: id, status: "pending" },
        { $set: update },
        { returnDocument: "after" },
      );
      const doc = result?.value ?? result;
      if (!doc)
        return res
          .status(409)
          .json({ error: "Request already accepted or not found" });

      await db
        .collection("drivers")
        .updateOne({ _id: driverId }, { $set: { status: "on_trip" } });
      await leaveLine(db, driverId);
      await db
        .collection("tricycles")
        .updateOne(
          { driverId },
          { $set: { status: "on_trip", terminal: null } },
        );

      return res.status(200).json(doc);
    }

    // POST /api/requests?id=DR-001&action=cancel
    // Kiosk rides can be cancelled from the kiosk itself (no login there);
    // app rides only by the owning passenger or an admin.
    if (req.method === "POST" && id && action === "cancel") {
      const target = await col.findOne({ _id: id });
      if (!target) return res.status(404).json({ error: "Request not found" });
      if (target.status !== "pending") {
        return res.status(409).json({ error: "Request is no longer pending" });
      }
      if (target.source !== "kiosk") {
        const session = requireSession(req, res, ["passenger", "admin"]);
        if (!session) return;
        if (
          session.role === "passenger" &&
          session.passengerId !== target.passengerId
        ) {
          return res.status(403).json({ error: "Not your request" });
        }
      }
      const result = await col.findOneAndUpdate(
        { _id: id, status: "pending" },
        {
          $set: { status: "cancelled", cancelledAt: new Date().toISOString() },
        },
        { returnDocument: "after" },
      );
      const doc = result?.value ?? result;
      if (!doc)
        return res.status(409).json({ error: "Request was just accepted" });
      return res.status(200).json(doc);
    }

    // POST /api/requests?id=DR-001&action=rate  { stars: 1-5, comment? }
    // The passenger who took a completed ride rates it, once. The driver's
    // rating becomes the average of all their rated rides.
    if (req.method === "POST" && id && action === "rate") {
      const session = requireSession(req, res, ["passenger"]);
      if (!session) return;
      const stars = Number(req.body?.stars);
      if (!Number.isInteger(stars) || stars < 1 || stars > 5)
        return res.status(400).json({ error: "Rating must be 1 to 5 stars" });
      const rawComment = req.body?.comment;
      if (rawComment != null && typeof rawComment !== "string")
        return res.status(400).json({ error: "Invalid comment" });
      const comment = (rawComment || "").trim().slice(0, 300);

      const target = await col.findOne({ _id: id });
      if (!target || target.passengerId !== session.passengerId)
        return res.status(404).json({ error: "Ride not found" });
      if (target.status !== "completed")
        return res
          .status(409)
          .json({ error: "You can rate a ride once it is completed" });
      if (!target.driverId)
        return res
          .status(409)
          .json({ error: "This ride has no driver to rate" });

      // Only the first rating counts (the filter makes this safe against a
      // double tap).
      const result = await col.findOneAndUpdate(
        { _id: id, rating: { $exists: false } },
        {
          $set: {
            rating: { stars, comment, at: new Date().toISOString() },
          },
        },
        { returnDocument: "after" },
      );
      const doc = result?.value ?? result;
      if (!doc)
        return res.status(409).json({ error: "You already rated this ride" });

      const drivers = db.collection("drivers");
      await drivers.updateOne(
        { _id: target.driverId },
        { $inc: { ratingSum: stars, ratingCount: 1 } },
      );
      const d = await drivers.findOne(
        { _id: target.driverId },
        { projection: { ratingSum: 1, ratingCount: 1 } },
      );
      if (d?.ratingCount) {
        await drivers.updateOne(
          { _id: target.driverId },
          {
            $set: {
              rating: Math.round((d.ratingSum / d.ratingCount) * 10) / 10,
            },
          },
        );
      }
      return res.status(200).json(doc);
    }

    // POST /api/requests?id=DR-001&action=complete
    if (req.method === "POST" && id && action === "complete") {
      // Only the driver who accepted this specific trip (or an admin) may
      // mark it complete - otherwise any caller could free up a tricycle
      // mid-trip or tamper with another driver's dispatch record.
      const session = requireSession(req, res, ["driver", "admin"]);
      if (!session) return;

      // Only a ride in progress can be completed - otherwise a second tap (or a
      // cancelled / already recorded ride) would count the trip twice.
      const filter =
        session.role === "admin"
          ? { _id: id, status: "dispatched" }
          : { _id: id, driverId: session.driverId, status: "dispatched" };
      const result = await col.findOneAndUpdate(
        filter,
        {
          $set: { status: "completed", completedAt: new Date().toISOString() },
        },
        { returnDocument: "after" },
      );
      const doc = result?.value ?? result;
      if (!doc)
        return res
          .status(404)
          .json({
            error: "Trip not found, not assigned to you, or already finished",
          });

      if (doc.driverId) {
        await db
          .collection("drivers")
          .updateOne(
            { _id: doc.driverId },
            { $set: { status: "available" }, $inc: { tripsCompleted: 1 } },
          );
        await db
          .collection("tricycles")
          .updateOne(
            { driverId: doc.driverId },
            { $set: { status: "available", terminal: doc.destination } },
          );
      }
      return res.status(200).json(doc);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
