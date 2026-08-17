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
  return client.db("gravitry");
}
