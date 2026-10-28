// Test helpers: an in-memory stand-in for MongoDB plus a tiny way to call the
// /api handlers the way Vercel would. No real database or network is touched.
// Import this FIRST in a test file (it sets the env vars the API code reads).
process.env.JWT_SECRET = "t".repeat(40);
process.env.MONGODB_URI = "mongodb://test";

import { pathToFileURL } from "node:url";

// api/_db.js grabs this object when it is first imported, so it must exist
// before any handler is loaded; createFakeDb() later swaps in a fresh database.
global._gravitryMongo = { client: null, promise: null };
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
export const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);

const get = (d, k) => k.split(".").reduce((o, x) => o?.[x], d);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const m1 = (v, c) =>
  v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)
    ? Object.entries(v).every(([op, x]) =>
        op === "$in"
          ? x.includes(c)
          : op === "$lt"
            ? c < x
            : op === "$gte"
              ? c >= x
              : op === "$ne"
                ? c !== x
                : op === "$exists"
                  ? (c !== undefined) === x
                  : true,
      )
    : c === v;
const match = (d, q) =>
  (q.$or ? q.$or.some((s) => match(d, s)) : true) &&
  Object.entries(q).every(([k, v]) => k === "$or" || m1(v, get(d, k)));
const apply = (d, u) => {
  Object.assign(d, u.$set || {});
  for (const k of Object.keys(u.$unset || {})) delete d[k];
  for (const [k, v] of Object.entries(u.$inc || {})) d[k] = (d[k] || 0) + v;
};
const sorter = (spec) => (a, b) => {
  for (const [k, dir] of Object.entries(spec || {})) {
    const c = cmp(get(a, k), get(b, k));
    if (c) return c * dir;
  }
  return 0;
};

export function createFakeDb() {
  const store = {};
  const T = (n) => (store[n] ??= []);
  const col = (n) => ({
    findOne: async (q = {}, o) => {
      const rows = T(n).filter((d) => match(d, q));
      if (o?.sort) rows.sort(sorter(o.sort));
      return rows[0] || null;
    },
    find: (q = {}) => {
      let rows = T(n).filter((d) => match(d, q));
      const c = {
        sort(s) {
          rows = [...rows].sort(sorter(s));
          return c;
        },
        limit(k) {
          rows = rows.slice(0, k);
          return c;
        },
        toArray: async () => rows,
      };
      return c;
    },
    countDocuments: async (q = {}) => T(n).filter((d) => match(d, q)).length,
    insertOne: async (d) => {
      T(n).push(d);
      return {};
    },
    updateOne: async (q, u, o) => {
      let d = T(n).find((x) => match(x, q));
      if (!d && o?.upsert) {
        d = { ...q };
        T(n).push(d);
      }
      if (d) apply(d, u);
      return {};
    },
    updateMany: async (q, u) => {
      T(n)
        .filter((d) => match(d, q))
        .forEach((d) => apply(d, u));
      return {};
    },
    deleteOne: async (q) => {
      const i = T(n).findIndex((d) => match(d, q));
      if (i >= 0) T(n).splice(i, 1);
      return {};
    },
    deleteMany: async () => ({}),
    findOneAndUpdate: async (q, u, o) => {
      let d = T(n).find((x) => match(x, q));
      if (!d && o?.upsert) {
        d = { ...q };
        T(n).push(d);
      }
      if (d) apply(d, u);
      return d || null;
    },
    createIndex: async () => {},
  });
  // Every handler gets its database through global._gravitryMongo (see api/_db.js).
  global._gravitryMongo.client = { db: () => ({ collection: col }) };
  return { T, store };
}

// Session cookie for a logged-in user, e.g. cookie("admin") or cookie("driver", { driverId: "D1" })
export async function cookie(role, extra = {}) {
  const auth = await load("api/_auth.js");
  return `gv_session=${auth.signSession({ sub: "u", role, name: "Test", ...extra })}`;
}

// Calls an API handler like Vercel would -> { status, body }
export async function call(
  handler,
  { method = "GET", query = {}, body, cookie = "", headers = {} } = {},
) {
  let out;
  const res = {
    status(c) {
      this.c = c;
      return this;
    },
    json(j) {
      out = { status: this.c ?? 200, body: j };
    },
    setHeader() {},
  };
  await handler({ method, query, body, headers: { cookie, ...headers } }, res);
  return out;
}
