import { getDb } from "./_db.js";
import { requireSession, isNonEmptyString } from "./_authz.js";
import { getSessionFromReq } from "./_auth.js";

// ---------------------------------------------------------------------------
// "All-rounder" units
//
// Most tricycles belong to the driver who operates them. A few units (1-2) are
// all-rounders: they have NO owner and are owned by the TODA, which lends them
// out to drivers who don't have a tricycle of their own. Nobody knows up front
// how long a driver will need one, so the rental is open-ended and revolving
// by the MONTH: it simply keeps rolling over until the admin ends it.
//
// Shape of an all-rounder document (regular units are unchanged):
//   { _id, plate, allRounder: true, driverId, driver, status, terminal,
//     rental: null | { driverId, driverName, startedAt, months, renewalDate },
//     rentalHistory: [{ driverId, driverName, startedAt, endedAt, months }] }
//
// While rented, driverId / driver / status / terminal are kept in sync with the
// renter, so the trip logic in api/requests.js (which finds a driver's unit by
// driverId) works for rented units with no changes. Dates are "YYYY-MM-DD".
// ---------------------------------------------------------------------------

const DEFAULT_TERMINAL = "T1"; // matches HOME_TERMINAL in src/DriverView.jsx

// Today's date in the Philippines (the TODA's timezone), as YYYY-MM-DD.
function todayManila() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

function isIsoDate(s) {
  return (
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !isNaN(new Date(s))
  );
}

// startedAt + n months, always counted from the START date (not from the last
// renewal) so a rental begun on the 31st doesn't drift: Jan 31 -> Feb 28 ->
// Mar 31, rather than Jan 31 -> Feb 28 -> Mar 28.
function addMonths(startIso, n) {
  const [y, m, d] = startIso.split("-").map(Number);
  const total = m - 1 + n;
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function tricycleStatusFor(driver) {
  if (driver.status === "on_trip") return "on_trip";
  if (driver.status === "off_duty") return "off_duty";
  return "available";
}

export default async function handler(req, res) {
  try {
    const db = await getDb();
    const col = db.collection("tricycles");
    const { id, action } = req.query;

    if (req.method === "GET") {
      const docs = await col.find({}).toArray();
      // Rental details (who rents a unit, for how long) are for TODA staff.
      if (getSessionFromReq(req)?.role === "admin")
        return res.status(200).json(docs);
      return res
        .status(200)
        .json(docs.map(({ rental: _r, rentalHistory: _h, ...rest }) => rest));
    }

    if (req.method === "POST") {
      // Every change here is admin-only.
      const session = requireSession(req, res, ["admin"]);
      if (!session) return;
      const body = req.body || {};

      // POST /api/tricycles?action=create  { unit, plate, terminal? }
      // Registers a new ownerless all-rounder unit, waiting to be rented out.
      if (action === "create") {
        if (!isNonEmptyString(body.unit) || !isNonEmptyString(body.plate)) {
          return res
            .status(400)
            .json({ error: "Unit number and plate number are required" });
        }
        const unit = body.unit.trim().toUpperCase();
        const plate = body.plate.trim().toUpperCase();
        if (await col.findOne({ _id: unit })) {
          return res
            .status(409)
            .json({ error: `Unit ${unit} is already registered` });
        }
        const doc = {
          _id: unit,
          plate,
          allRounder: true,
          driverId: null,
          driver: null,
          status: "unassigned",
          terminal: null,
          rental: null,
          rentalHistory: [],
        };
        await col.insertOne(doc);
        return res.status(201).json(doc);
      }

      if (!isNonEmptyString(id)) {
        return res.status(400).json({ error: "id query param is required" });
      }
      const unit = await col.findOne({ _id: id });
      if (!unit) return res.status(404).json({ error: "Tricycle not found" });
      if (!unit.allRounder) {
        return res
          .status(400)
          .json({ error: "Only all-rounder (TODA-owned) units can be rented" });
      }

      // POST /api/tricycles?action=rent&id=MCC-006  { driverId, startedAt? }
      // Hands the unit to a driver who has no tricycle. Starts a monthly,
      // open-ended rental.
      if (action === "rent") {
        if (!isNonEmptyString(body.driverId)) {
          return res.status(400).json({ error: "driverId is required" });
        }
        if (unit.rental) {
          return res.status(409).json({ error: "This unit is already rented" });
        }
        const startedAt = body.startedAt ?? todayManila();
        if (!isIsoDate(startedAt)) {
          return res
            .status(400)
            .json({ error: "startedAt must be a date like 2026-10-14" });
        }
        const driver = await db
          .collection("drivers")
          .findOne({ _id: body.driverId });
        if (!driver) return res.status(404).json({ error: "Driver not found" });
        // One driver, one tricycle: trip logic finds a driver's unit by driverId.
        const alreadyHas =
          driver.unit || (await col.findOne({ driverId: driver._id }));
        if (alreadyHas) {
          return res
            .status(409)
            .json({ error: `${driver.name} already has a tricycle assigned` });
        }

        const status = tricycleStatusFor(driver);
        const rental = {
          driverId: driver._id,
          driverName: driver.name,
          startedAt,
          months: 1,
          renewalDate: addMonths(startedAt, 1),
        };
        const result = await col.findOneAndUpdate(
          { _id: unit._id, allRounder: true, rental: null },
          {
            $set: {
              rental,
              driverId: driver._id,
              driver: driver.name,
              status,
              terminal: status === "available" ? DEFAULT_TERMINAL : null,
            },
          },
          { returnDocument: "after" },
        );
        const doc = result?.value ?? result;
        if (!doc) {
          return res.status(409).json({ error: "This unit was just rented" });
        }
        await db
          .collection("drivers")
          .updateOne(
            { _id: driver._id },
            { $set: { unit: unit._id, plate: unit.plate } },
          );
        return res.status(200).json(doc);
      }

      // POST /api/tricycles?action=renew&id=MCC-006
      // Rolls the rental over for one more month.
      if (action === "renew") {
        if (!unit.rental) {
          return res.status(409).json({ error: "This unit is not rented" });
        }
        const months = (unit.rental.months || 1) + 1;
        const result = await col.findOneAndUpdate(
          { _id: unit._id, "rental.months": unit.rental.months || 1 },
          {
            $set: {
              "rental.months": months,
              "rental.renewalDate": addMonths(unit.rental.startedAt, months),
            },
          },
          { returnDocument: "after" },
        );
        const doc = result?.value ?? result;
        if (!doc) {
          return res
            .status(409)
            .json({ error: "Rental was just updated. Refresh and try again." });
        }
        return res.status(200).json(doc);
      }

      // POST /api/tricycles?action=release&id=MCC-006
      // Ends the rental: the unit goes back to the TODA and the driver is left
      // without a tricycle until they are given one.
      if (action === "release") {
        if (!unit.rental) {
          return res.status(409).json({ error: "This unit is not rented" });
        }
        if (unit.status === "on_trip") {
          return res.status(409).json({
            error: "This unit is on a trip. End the rental after it finishes.",
          });
        }
        const entry = {
          driverId: unit.rental.driverId,
          driverName: unit.rental.driverName,
          startedAt: unit.rental.startedAt,
          endedAt: todayManila(),
          months: unit.rental.months || 1,
        };
        const result = await col.findOneAndUpdate(
          { _id: unit._id, rental: { $ne: null }, status: { $ne: "on_trip" } },
          {
            $set: {
              rental: null,
              driverId: null,
              driver: null,
              status: "unassigned",
              terminal: null,
            },
            $push: { rentalHistory: entry },
          },
          { returnDocument: "after" },
        );
        const doc = result?.value ?? result;
        if (!doc) {
          return res.status(409).json({
            error: "Couldn't end the rental. Refresh and try again.",
          });
        }
        await db
          .collection("drivers")
          .updateOne(
            { _id: entry.driverId, unit: unit._id },
            { $set: { unit: null, plate: null } },
          );
        return res.status(200).json(doc);
      }

      return res.status(400).json({ error: "Unknown action" });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
