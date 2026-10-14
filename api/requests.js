import { getDb } from "./_db.js";
import { getSessionFromReq } from "./_auth.js";
import { requireSession, isNonEmptyString } from "./_authz.js";
import { verifyQuote, buildPricing, DISCOUNT_TYPES } from "./_fare.js";

// Policy switch: may a passenger whose account is still pending staff
// verification book rides? true = yes (temporary account works, flagged on the
// request). false = they must wait until TODA staff approve them.
// Rejected accounts can never book until they resubmit and get approved.
const PENDING_CAN_BOOK = true;

// Returns the names of a driver's expired documents (license / franchise).
// The admin marks each one Valid or Expired (licenseStatus / franchiseStatus).
// Older records without that fall back to their expiry date. A driver with ANY
// expired document cannot take trips.
function expiredDocsOf(driver) {
  const today = new Date().toISOString().slice(0, 10);
  const isExpired = (status, date) =>
    status === "valid" || status === "expired"
      ? status === "expired"
      : !!date && date < today;
  const out = [];
  if (isExpired(driver.licenseStatus, driver.licenseExpiry))
    out.push("license");
  if (isExpired(driver.franchiseStatus, driver.franchiseExpiry))
    out.push("franchise");
  return out;
}

// Kiosk rides must be accepted by an NFC card tap. Only one may be pending per
// kiosk at a time; stale ones expire so the kiosk can never get stuck.
const KIOSK_PENDING_TTL_MIN = 10;

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
        const busy = await col.findOne({
          status: "pending",
          source: "kiosk",
          origin: o,
        });
        if (busy) {
          return res.status(409).json({
            error:
              "A ride is already waiting at this kiosk. A driver must tap their card to accept it first.",
          });
        }
      }

      let identity = {};
      let passengerDoc = null;
      let kioskClaim = null;

      if (session?.role === "passenger") {
        const p = await db
          .collection("passengers")
          .findOne(
            { _id: session.passengerId },
            { projection: { status: 1, discountType: 1 } },
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

      // "kiosk" sorts above "app" when descending, so kiosk rides come first,
      // then oldest first within each group. Old requests with no source
      // field sort last.
      const pendingReq = await col.findOne(
        { status: "pending", origin: term },
        { sort: { source: -1, ts: 1 } },
      );
      if (!pendingReq)
        return res.status(404).json({ error: "No pending requests right now" });

      const nowIso = new Date().toISOString();

      const update = {
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
      const doc = result.value ?? result;
      if (!doc)
        return res
          .status(409)
          .json({ error: "That request was just taken. Try again." });

      // Trip is already on record: the driver stays available and their
      // tricycle is now listed at the drop-off terminal.
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
      return res.status(200).json(docs);
    }

    // GET /api/requests?id=DR-001  - single lookup (used by kiosk/passenger
    // waiting screens; intentionally public since the requester may not be
    // logged in, and the safety-record contents are meant to be shown here)
    if (req.method === "GET" && id && !action) {
      const doc = await col.findOne({ _id: id });
      if (!doc) return res.status(404).json({ error: "Request not found" });
      return res.status(200).json(doc);
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
      const doc = result.value ?? result;
      if (!doc)
        return res
          .status(404)
          .json({ error: "Trip not found, or already marked picked up" });
      return res.status(200).json(doc);
    }

    // POST /api/requests?id=DR-001&action=accept
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
      const doc = result.value ?? result;
      if (!doc)
        return res
          .status(409)
          .json({ error: "Request already accepted or not found" });

      await db
        .collection("drivers")
        .updateOne({ _id: driverId }, { $set: { status: "on_trip" } });
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
      const doc = result.value ?? result;
      if (!doc)
        return res.status(409).json({ error: "Request was just accepted" });
      return res.status(200).json(doc);
    }

    // POST /api/requests?id=DR-001&action=complete
    if (req.method === "POST" && id && action === "complete") {
      // Only the driver who accepted this specific trip (or an admin) may
      // mark it complete - otherwise any caller could free up a tricycle
      // mid-trip or tamper with another driver's dispatch record.
      const session = requireSession(req, res, ["driver", "admin"]);
      if (!session) return;

      const filter =
        session.role === "admin"
          ? { _id: id }
          : { _id: id, driverId: session.driverId };
      const result = await col.findOneAndUpdate(
        filter,
        {
          $set: { status: "completed", completedAt: new Date().toISOString() },
        },
        { returnDocument: "after" },
      );
      const doc = result.value ?? result;
      if (!doc)
        return res
          .status(404)
          .json({ error: "Request not found, or not assigned to you" });

      if (doc.driverId) {
        await db
          .collection("drivers")
          .updateOne({ _id: doc.driverId }, { $set: { status: "available" } });
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
