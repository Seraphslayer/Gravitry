// Updates ONLY the fares to the official TODA fare matrix. Safe to run on the
// live database: it does not touch drivers, passengers, requests, or passwords
// (unlike seed.js, which resets demo accounts).
//
// Run: node --env-file=.env scripts/update-fares.js
import dns from "node:dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]); // Windows/Node SRV lookup fix - see api/_db.js

import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error(
    "Missing MONGODB_URI. Set it in your environment or .env file.",
  );
  process.exit(1);
}

// Regular per-person fare per route (see api/fares.js for how the special /
// discounted columns are derived). All three Mary Cris Complex terminals are
// within the first kilometer of each other, so every route is the first-km
// fare of PHP 15. If a route turns out to be longer than 1 km, set it to 20
// here (or in the admin Fares tab).
const FIRST_KM = 15;
const ROUTES = [
  ["T1", "T2", FIRST_KM],
  ["T1", "T3", FIRST_KM],
  ["T2", "T1", FIRST_KM],
  ["T2", "T3", FIRST_KM],
  ["T3", "T1", FIRST_KM],
  ["T3", "T2", FIRST_KM],
];

async function run() {
  const client = new MongoClient(uri);
  await client.connect();
  const col = client.db("gravitry").collection("fares");

  for (const [origin, destination, fare] of ROUTES) {
    await col.updateOne(
      { _id: `${origin}-${destination}` },
      {
        $set: { origin, destination, fare, updatedAt: new Date() },
        $push: {
          history: {
            fare,
            changedAt: new Date(),
            changedBy: "update-fares-script",
          },
        },
      },
      { upsert: true },
    );
    console.log(`${origin} -> ${destination}: PHP ${fare}`);
  }

  console.log("Done.");
  await client.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
