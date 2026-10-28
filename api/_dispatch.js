// Shared dispatch rules, used by requests.js (NFC tap, admin override) and
// staff.js (kiosk staff panel). Files starting with "_" are not API routes.

// Names of a driver's expired documents (license / franchise). The admin marks
// each one Valid or Expired; older records without that fall back to the date.
export function expiredDocsOf(driver) {
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

// Is the driver's Driver app switched to Online and still reporting in?
export function driverAppActive(driver) {
  const lastSeen = driver.appLastSeen
    ? new Date(driver.appLastSeen).getTime()
    : 0;
  return driver.appOnline === true && Date.now() - lastSeen < 45 * 1000;
}

// Today's date in the Philippines (UTC+8), as YYYY-MM-DD.
export function phDate(ms = Date.now()) {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// Marks a driver present at a terminal for today (one record per driver per
// terminal per day). via: "nfc" (they tapped) or "manual" (staff did it).
// Returns { first } - whether this is their first check-in today.
export async function recordAttendance(
  db,
  driver,
  terminal,
  via = "nfc",
  by = null,
) {
  const date = phDate();
  const _id = `${date}|${terminal}|${driver._id}`;
  const col = db.collection("attendance");
  const existing = await col.findOne({ _id });
  const nowIso = new Date().toISOString();
  if (existing) {
    await col.updateOne(
      { _id },
      {
        $set: { lastTapAt: nowIso, unit: driver.unit || null },
        $inc: { taps: 1 },
      },
    );
    return { first: false, at: existing.firstTapAt };
  }
  await col.insertOne({
    _id,
    date,
    terminal,
    driverId: driver._id,
    driverName: driver.name,
    unit: driver.unit || null,
    firstTapAt: nowIso,
    lastTapAt: nowIso,
    taps: 1,
    via,
    markedBy: by,
  });
  return { first: true, at: nowIso };
}

// Hands a waiting ride to a chosen driver without an NFC tap (manual override).
// Same safety rules as a tap: expired documents or an active trip still block.
// -> { code, body }
export async function assignRide(db, { id, driverId, reason, by }) {
  const col = db.collection("requests");
  const driver = await db.collection("drivers").findOne({ _id: driverId });
  if (!driver) return { code: 404, body: { error: "Driver not found" } };
  if (driver.status === "on_trip")
    return { code: 409, body: { error: "That driver is already on a trip" } };
  const expired = expiredDocsOf(driver);
  if (expired.length)
    return {
      code: 403,
      body: {
        error: `${driver.name}'s ${expired.join(" and ")} has expired, so they cannot take rides.`,
      },
    };

  const pendingReq = await col.findOne({ _id: id });
  if (!pendingReq) return { code: 404, body: { error: "Request not found" } };
  if (pendingReq.status !== "pending")
    return { code: 409, body: { error: "That request is no longer waiting" } };

  const nowIso = new Date().toISOString();
  const trackable =
    pendingReq.source !== "kiosk" &&
    !!pendingReq.passengerId &&
    driverAppActive(driver);
  const update = {
    status: trackable ? "dispatched" : "completed",
    driver: driver.name,
    driverId: driver._id,
    unit: driver.unit,
    plate: driver.plate || "N/A",
    acceptedAt: nowIso,
    manualOverride: { by, reason, at: nowIso },
  };
  // Recorded on the spot, exactly like an NFC-recorded ride (the passenger
  // screens key off this flag).
  if (!trackable) {
    update.completedAt = nowIso;
    update.recordedViaNfc = true;
  }
  if (pendingReq.discountClaim) {
    // Staff checked the ID in person instead of the driver's tap.
    update.discountType = pendingReq.discountClaim;
    update.discountApplied = true;
    update.discountPending = false;
    update.discountConfirmedBy = "admin";
  }

  const result = await col.findOneAndUpdate(
    { _id: id, status: "pending" },
    { $set: update },
    { returnDocument: "after" },
  );
  const doc = result?.value ?? result;
  if (!doc)
    return { code: 409, body: { error: "That request was just taken" } };

  if (trackable) {
    await db
      .collection("drivers")
      .updateOne({ _id: driver._id }, { $set: { status: "on_trip" } });
    await db
      .collection("tricycles")
      .updateOne(
        { driverId: driver._id },
        { $set: { status: "on_trip", terminal: null } },
      );
  } else {
    await db
      .collection("drivers")
      .updateOne({ _id: driver._id }, { $inc: { tripsCompleted: 1 } });
    await db
      .collection("tricycles")
      .updateOne(
        { driverId: driver._id },
        { $set: { status: "available", terminal: doc.destination } },
      );
  }
  return { code: 200, body: doc };
}

// Cancels a waiting ride. -> { code, body }
export async function cancelPending(db, id) {
  const col = db.collection("requests");
  const target = await col.findOne({ _id: id });
  if (!target) return { code: 404, body: { error: "Request not found" } };
  if (target.status !== "pending")
    return { code: 409, body: { error: "Request is no longer pending" } };
  const result = await col.findOneAndUpdate(
    { _id: id, status: "pending" },
    { $set: { status: "cancelled", cancelledAt: new Date().toISOString() } },
    { returnDocument: "after" },
  );
  const doc = result?.value ?? result;
  if (!doc) return { code: 409, body: { error: "Request was just accepted" } };
  return { code: 200, body: doc };
}
