// Validation for verification photos (government ID + selfie).
//
// The browser always compresses captures to JPEG before upload, so the server
// only accepts JPEG data URLs. Checking the JPEG signature ("/9j/" is the
// base64 form of the JPEG magic bytes) and a hard size cap stops someone from
// using the signup endpoint to store arbitrary files or huge payloads.

const JPEG_PREFIX = "data:image/jpeg;base64,/9j/";
const MAX_CHARS = 1_500_000; // roughly 1.1 MB of image data per photo
const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;

export function isValidPhoto(dataUrl) {
  if (typeof dataUrl !== "string") return false;
  if (dataUrl.length > MAX_CHARS) return false;
  if (!dataUrl.startsWith(JPEG_PREFIX)) return false;
  const body = dataUrl.slice("data:image/jpeg;base64,".length);
  return body.length > 1000 && BASE64_BODY.test(body);
}

// Simple global rate limiter backed by MongoDB (serverless functions have no
// shared memory). Returns true if the call is allowed.
export async function withinRate(db, key, max, windowMs) {
  const now = new Date();
  const col = db.collection("rate_limits");
  const doc = await col.findOne({ _id: key });
  if (!doc || now - new Date(doc.windowStart) > windowMs) {
    await col.updateOne(
      { _id: key },
      { $set: { windowStart: now, count: 1 } },
      { upsert: true },
    );
    return true;
  }
  if (doc.count >= max) return false;
  await col.updateOne({ _id: key }, { $inc: { count: 1 } });
  return true;
}
