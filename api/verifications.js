import { getDb } from "./_db.js";
import { requireSession, isNonEmptyString } from "./_authz.js";

// Admin-only. TODA staff use this to review the government ID photo and
// selfie that a new passenger submitted, then approve (account becomes
// permanent) or reject (with a reason, so the passenger can resubmit).
//
// If the passenger asked for a fare discount (student / senior / PWD), they
// also sent a photo of that ID. When approving, staff choose which discount to
// grant - or "none" to approve the account but deny the discount.
//
// Privacy: the photos are deleted as soon as a decision is made. Only the
// decision, who made it, and when stay on the passenger record.

const DISCOUNT_CHOICES = ["none", "student", "senior", "pwd"];

export default async function handler(req, res) {
  try {
    const session = requireSession(req, res, ["admin"]);
    if (!session) return;

    const db = await getDb();
    const passengers = db.collection("passengers");
    const verifications = db.collection("verifications");
    const { id, action } = req.query;

    // GET /api/verifications - list passengers waiting for review (no photos)
    if (req.method === "GET" && !id) {
      const docs = await passengers
        .find(
          { status: "pending" },
          {
            projection: {
              name: 1,
              username: 1,
              phone: 1,
              address: 1,
              discountClaim: 1,
              verificationSubmittedAt: 1,
            },
          },
        )
        .sort({ verificationSubmittedAt: 1 })
        .toArray();
      return res.status(200).json(docs);
    }

    if (!isNonEmptyString(id)) {
      return res.status(400).json({ error: "id is required" });
    }

    // GET /api/verifications?id=P-001 - the photos for one passenger
    if (req.method === "GET") {
      const passenger = await passengers.findOne(
        { _id: id },
        {
          projection: {
            name: 1,
            username: 1,
            phone: 1,
            address: 1,
            status: 1,
            discountClaim: 1,
          },
        },
      );
      if (!passenger)
        return res.status(404).json({ error: "Passenger not found" });
      const photos = await verifications.findOne({ _id: id });
      if (!photos) {
        return res
          .status(404)
          .json({ error: "No photos on file for this passenger" });
      }
      return res.status(200).json({
        passenger,
        idPhoto: photos.idPhoto,
        selfie: photos.selfie,
        discountIdPhoto: photos.discountIdPhoto || null,
        submittedAt: photos.submittedAt,
      });
    }

    // POST /api/verifications?id=P-001&action=approve|reject
    if (
      req.method === "POST" &&
      (action === "approve" || action === "reject")
    ) {
      const passenger = await passengers.findOne({ _id: id });
      if (!passenger)
        return res.status(404).json({ error: "Passenger not found" });
      if (passenger.status !== "pending") {
        return res
          .status(409)
          .json({ error: "This submission is not pending review" });
      }

      const nowIso = new Date().toISOString();
      let grantedDiscount = null;
      if (action === "approve") {
        // If the passenger asked for a discount, staff must make an explicit
        // choice so a discount is never granted (or skipped) by accident.
        const { discountType } = req.body || {};
        let choice = discountType;
        if (choice == null || choice === "") {
          if (passenger.discountClaim) {
            return res.status(400).json({
              error:
                "Choose which discount to grant, or 'none' to deny the discount",
            });
          }
          choice = "none";
        }
        if (typeof choice !== "string" || !DISCOUNT_CHOICES.includes(choice)) {
          return res.status(400).json({ error: "Invalid discount choice" });
        }
        grantedDiscount = choice === "none" ? null : choice;

        await passengers.updateOne(
          { _id: id },
          {
            $set: {
              status: "verified",
              discountType: grantedDiscount,
              reviewedBy: session.sub,
              reviewedAt: nowIso,
            },
            $unset: { rejectionReason: "" },
          },
        );
      } else {
        const { reason } = req.body || {};
        if (!isNonEmptyString(reason) || reason.length > 300) {
          return res.status(400).json({
            error: "A reason (up to 300 characters) is required to reject",
          });
        }
        await passengers.updateOne(
          { _id: id },
          {
            $set: {
              status: "rejected",
              discountType: null,
              rejectionReason: reason.trim(),
              reviewedBy: session.sub,
              reviewedAt: nowIso,
            },
          },
        );
      }
      // Decision made - delete the photos (including the discount ID).
      await verifications.deleteOne({ _id: id });
      return res.status(200).json({
        id,
        status: action === "approve" ? "verified" : "rejected",
        discountType: grantedDiscount,
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
