// Run once to populate the database: node --env-file=.env scripts/seed.js
import dns from "node:dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]); // Windows/Node SRV lookup fix — see api/_db.js

import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error(
    "Missing MONGODB_URI. Set it in your environment or .env file.",
  );
  process.exit(1);
}

const hash = (p) => bcrypt.hashSync(p, 10);
const DEMO_DRIVER_PASSWORD = "toda2026"; // ⚠️ change before real deployment
const DEMO_ADMIN_PASSWORD = "admin2026"; // ⚠️ change before real deployment

const drivers = [
  {
    _id: "D1",
    name: "Rolando Dela Cruz",
    license: "N01-23-456789",
    contact: "0917 123 4567",
    unit: "MCC-001",
    plate: "ABL-1234",
    status: "available",
    rating: 4.9,
    tripsCompleted: 214,
    licenseExpiry: "2027-03-15",
    franchiseExpiry: "2026-11-02",
    username: "rolando",
    passwordHash: hash(DEMO_DRIVER_PASSWORD),
  },
  {
    _id: "D2",
    name: "Eduardo Santos",
    license: "N01-23-567890",
    contact: "0918 234 5678",
    unit: "MCC-002",
    plate: "ABL-2345",
    status: "on_trip",
    rating: 4.7,
    tripsCompleted: 189,
    licenseExpiry: "2026-08-20",
    franchiseExpiry: "2026-08-05",
    username: "eduardo",
    passwordHash: hash(DEMO_DRIVER_PASSWORD),
  },
  {
    _id: "D3",
    name: "Marlon Reyes",
    license: "N01-23-678901",
    contact: "0919 345 6789",
    unit: "MCC-003",
    plate: "ABL-3456",
    status: "available",
    rating: 4.8,
    tripsCompleted: 301,
    licenseExpiry: "2028-01-10",
    franchiseExpiry: "2027-04-18",
    username: "marlon",
    passwordHash: hash(DEMO_DRIVER_PASSWORD),
  },
  {
    _id: "D4",
    name: "Danilo Bautista",
    license: "N01-23-789012",
    contact: "0920 456 7890",
    unit: "MCC-004",
    plate: "ABL-4567",
    status: "available",
    rating: 4.6,
    tripsCompleted: 98,
    licenseExpiry: "2026-07-30",
    franchiseExpiry: "2026-12-01",
    username: "danilo",
    passwordHash: hash(DEMO_DRIVER_PASSWORD),
  },
  {
    _id: "D5",
    name: "Felix Villanueva",
    license: "N01-23-890123",
    contact: "0921 567 8901",
    unit: "MCC-005",
    plate: "ABL-5678",
    status: "off_duty",
    rating: 4.3,
    tripsCompleted: 47,
    licenseExpiry: "2026-06-01",
    franchiseExpiry: "2026-06-15",
    username: "felix",
    passwordHash: hash(DEMO_DRIVER_PASSWORD),
  },
];

const tricycles = [
  {
    _id: "MCC-001",
    plate: "ABL-1234",
    driverId: "D1",
    driver: "Rolando Dela Cruz",
    status: "available",
    terminal: "T1",
  },
  {
    _id: "MCC-002",
    plate: "ABL-2345",
    driverId: "D2",
    driver: "Eduardo Santos",
    status: "on_trip",
    terminal: null,
  },
  {
    _id: "MCC-003",
    plate: "ABL-3456",
    driverId: "D3",
    driver: "Marlon Reyes",
    status: "available",
    terminal: "T1",
  },
  {
    _id: "MCC-004",
    plate: "ABL-4567",
    driverId: "D4",
    driver: "Danilo Bautista",
    status: "available",
    terminal: "T2",
  },
  {
    _id: "MCC-005",
    plate: "ABL-5678",
    driverId: "D5",
    driver: "Felix Villanueva",
    status: "off_duty",
    terminal: "T3",
  },
];

// ⚠️ Placeholder fares for the 3 real terminals — replace with the actual
// TODA-approved rates for these routes before real deployment.
const fareEntries = [
  ["T1", "T2", 15],
  ["T1", "T3", 18],
  ["T2", "T1", 15],
  ["T2", "T3", 12],
  ["T3", "T1", 18],
  ["T3", "T2", 12],
].map(([origin, destination, fare]) => ({
  _id: `${origin}-${destination}`,
  origin,
  destination,
  fare,
  updatedAt: new Date(),
  history: [{ fare, changedAt: new Date() }],
}));

const admins = [
  {
    _id: "U1",
    username: "admin",
    name: "TODA Admin",
    passwordHash: hash(DEMO_ADMIN_PASSWORD),
  },
];

async function seed() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("gravitry");

  // Clean out old T4-pair fare entries left over from the placeholder terminal set
  await db.collection("fares").deleteMany({
    $or: [{ origin: "T4" }, { destination: "T4" }],
  });

  for (const [name, docs] of [
    ["drivers", drivers],
    ["tricycles", tricycles],
    ["fares", fareEntries],
    ["users", admins],
  ]) {
    const col = db.collection(name);
    for (const doc of docs) {
      await col.updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
    }
    console.log(`Seeded ${docs.length} ${name}`);
  }

  await db
    .collection("counters")
    .updateOne(
      { _id: "requests" },
      { $setOnInsert: { seq: 0 } },
      { upsert: true },
    );

  console.log("Done.");
  console.log(
    `Driver login (all 5): username as listed, password "${DEMO_DRIVER_PASSWORD}"`,
  );
  console.log(
    `Admin login: username "admin", password "${DEMO_ADMIN_PASSWORD}"`,
  );
  await client.close();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
