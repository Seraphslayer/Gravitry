import dns from "node:dns";
import { MongoClient } from "mongodb";

// Windows/Node sometimes ignores the system DNS config for SRV lookups
// (querySrv ECONNREFUSED even though the OS resolver works fine). Forcing
// Node's own resolver to use Google's DNS directly sidesteps that entirely.
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const uri = process.env.MONGODB_URI;

let cached = global._gravitryMongo;
if (!cached) {
  cached = global._gravitryMongo = { client: null, promise: null };
}

// Indexes the polling queries need. Created once per warm instance; createIndex
// does nothing if the index already exists. Failures are ignored on purpose.
const INDEXES = [
  ["requests", { status: 1, origin: 1, ts: -1 }],
  ["requests", { ts: -1 }],
  ["requests", { passengerId: 1, ts: -1 }],
  ["requests", { driverId: 1, status: 1 }],
  ["terminal_line", { terminal: 1, joinedAt: 1 }],
  ["attendance", { date: 1 }],
  ["reports", { status: 1, ts: -1 }],
];
async function ensureIndexes(db) {
  if (cached.indexed) return;
  cached.indexed = true;
  for (const [name, keys, opts] of INDEXES) {
    try {
      await db.collection(name).createIndex(keys, opts);
    } catch {
      /* ignore: an index is an optimisation, never a reason to fail */
    }
  }
}

export async function getDb() {
  if (!uri) throw new Error("Missing MONGODB_URI environment variable");
  if (cached.client) return cached.client.db("gravitry");
  if (!cached.promise) {
    const client = new MongoClient(uri);
    cached.promise = client.connect().then((c) => {
      cached.client = c;
      return c;
    });
  }
  const client = await cached.promise;
  const db = client.db("gravitry");
  ensureIndexes(db); // fire and forget
  return db;
}
