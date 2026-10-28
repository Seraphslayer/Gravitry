# Gravitry - notes for Claude Code

Kiosk-based tricycle terminal dispatch for the MCC TODA (Mary Cris Complex,
Brgy. Pasong Camachile II, General Trias, Cavite). CpE thesis project, NCST.

## Stack
- Frontend: React + Vite (`src/`), Leaflet + OpenStreetMap maps.
- Backend: Node serverless functions in `api/` on Vercel. MongoDB Atlas.
- Realtime is polling (3-8 s), not WebSockets (Vercel serverless).
- Roles are separate routes: `/` kiosk, `/driver`, `/admin`, passenger app.
- Sessions: JWT in the `gv_session` httpOnly cookie (`api/_auth.js`). Kiosk
  staff use a short-lived `x-staff-token` header instead (card + PIN).

## Commands (the user is on Windows / PowerShell, not bash)
- `npm run dev` - run locally
- `npm run check` - syntax-check every `api/*.js` and count serverless functions
- `npm test` - API tests (in-memory fake MongoDB, no network)
- `npm run build` - production build
Run `npm run check`, `npm test` and `npm run build` before saying a change works.

## Rules that came from real problems
- API files have plain names (`fares.js`, `drivers.js`, ...). NEVER use
  `[...path].js` style names; they broke deployment on Windows/git. Use query
  params (`?id=X&action=Y`) instead of dynamic path segments.
- Files in `api/` starting with `_` are shared code, not routes.
- Vercel Hobby allows 12 serverless functions. `npm run check` fails past 12.
  Prefer adding an `action` to an existing function over a new file.
- `api/_db.js` and `scripts/seed.js` set Node's DNS servers to Google DNS
  before the MongoDB import (SRV lookups fail on the user's machine otherwise).
  Keep that.
- MongoDB driver v6: `findOneAndUpdate` may return the doc or `{ value }`. Use
  `result?.value ?? result`.
- No auth shortcuts: the server decides who someone is from the session; never
  trust ids in the request body (see `api/_authz.js`).
- Kiosk rides can only be accepted by NFC tap (or admin / staff-panel manual
  override). Expired license or franchise blocks a driver everywhere.
- Terminal line (`api/_dispatch.js`, `api/queue.js`): drivers line up per
  terminal (NFC tap, Driver app near the terminal, or staff check-in); the
  first in line takes the next ride (`LINE_STRICT` in `api/requests.js`).
  Rides have a `priority`: 0 = passenger at the terminal (kiosk, or app pickup
  within 60 m of it), 1 = app booking from elsewhere. Priority 0 is served
  first, then oldest first. Terminal coordinates live in BOTH `src/shared.jsx`
  and `api/_terminals.js` - keep in sync.
- The temp-access value `TEMP_ACCESS_SECONDS` in `api/_settings.js` is a short
  TEST value; check it before real deployment.

## Tests
`tests/helpers.mjs` has the fake database and `call()` helper. Import it first
in a test file. Add a test for every new endpoint or rule. Each file runs in
its own process, so state never leaks between files.

## How the user likes to work
- Give the fix first, explain briefly after. Taglish is fine.
- Give PowerShell commands, never bash-only ones.
- One feature per branch / pull request when working in git.
- After the user confirms something works, remind them to push:
  `git add .; git commit -m "..."; git push`
