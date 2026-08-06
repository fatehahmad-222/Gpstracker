# Fleet Console — Employee GPS Tracking & Task Assignment

A production-oriented employee tracking system for field salesmen/employees,
built on **Next.js 14 (App Router) + Tailwind CSS + Supabase + Leaflet/OSM**.

Two roles:

- **Admin** — sees every employee's live location on one map, assigns
  location-based tasks (pin a spot on a map or search an address), adds and
  deactivates employees, and opens any employee's profile to view their
  location-history trail (filterable by date) plus the full history of every
  task assigned to them.
- **Employee** — signs in from a phone; the moment they're authenticated their
  location starts streaming to the admin dashboard automatically (no
  "start broadcasting" step). They see their own tasks with live
  distance-remaining and one-tap navigation.

Tasks **auto-complete** (server-side, in Postgres) when the employee's incoming
location fix falls inside the task's geofence radius — a broken or edited
client can't spoof completion.

---

## 1. Install dependencies

```bash
npm install
```

> Windows note: if `npm install` fails with
> `ERR_SSL_CIPHER_OPERATION_FAILED` / `ossl_gcm_stream_update`, Node's bundled
> OpenSSL hits a broken hardware-accelerated AES-GCM path on some CPUs. Force
> the software implementation with:
>
> ```powershell
> $env:OPENSSL_ia32cap = "~0x200000200000000"
> npm install
> ```

## 2. Create a Supabase project

1. Go to https://supabase.com and create a free project.
2. **Disable email confirmation** (Settings → Authentication → Sign In / Up →
   "Confirm email" off) if you want employees to sign in immediately after
   signing up. If you leave it on, signup shows a "check your email" screen —
   the app handles both.
3. Run the migration — the fastest way is the SQL Editor, but for reproducibility
   use the Supabase CLI:

   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR-PROJECT-REF
   npx supabase db push
   ```

   …or open the **SQL Editor** and paste the entire contents of every file in
   [`supabase/migrations/`](supabase/migrations) (`0001_initial.sql` then
   `0002_employee_management.sql`). The files are **idempotent** — safe to run
   more than once.

The migration creates:

| Table | Purpose |
|---|---|
| `profiles` | One row per auth user, `role` (`admin`/`employee`), created by a trigger on `auth.users` insert (can't be bypassed by a broken client) |
| `locations` | **Append-only** GPS history. No UPDATE/DELETE RLS policies exist. Indexed on `(employee_id, recorded_at)` |
| `live_locations` | One "latest position" row per employee, maintained automatically by a trigger on `locations` insert — gives the dashboard an efficient latest-per-employee query **and** realtime pub/sub |
| `tasks` | Assignments with target coords, address label, geofence `radius_meters`, status, `completion_source` (`geofence`/`manual`), timestamps |

Migration `0002` adds the employee-management layer:

- `profiles.is_active` — soft-delete flag. Admins deactivate/restore employees
  from the UI; deactivated accounts are blocked from signing in and drop off
  the live map, but their location/task history is preserved.
- An admin-only `UPDATE` RLS policy (employees still can't change their role or
  deactivate themselves), and `profiles` added to the realtime publication so
  the admin list updates live.
- The `handle_new_user` trigger now also copies `phone` from signup metadata.

Plus:

- **Geofence auto-completion** — a `SECURITY DEFINER` trigger on `locations`
  insert computes the haversine distance to every open task and marks it
  `completed` (sets `completed_at`, `completion_source = 'geofence'`) when the
  fix is within `radius_meters`.
- **Row Level Security** — employees read/write only their own rows; admins
  (detected via a `SECURITY DEFINER` `is_admin()` helper, so policies don't
  recurse) read everything and manage tasks; nobody can update/delete history.
- **`start_task(uuid)` RPC** — the only way an employee changes a task's
  status (`pending → in_progress`); they can never edit other columns (e.g.
  move the target to spoof a geofence hit).
- **Realtime** published on `locations`, `live_locations`, and `tasks`.

## 3. Configure environment variables

```bash
cp .env.local.example .env.local
```

Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from
**Project Settings → API**. Both are safe to expose to the browser; all
authorization is enforced by RLS + Auth.

Also set **`SUPABASE_SERVICE_ROLE_KEY`** (same page, the `service_role` key) —
it is used **server-side only** by the admin "Add employee" flow
(`/api/employees`). Never expose it to the browser; it is not `NEXT_PUBLIC_`
prefixed.

## 4. Promote a user to admin

New signups are always employees. To promote a user (they must have signed up
first):

```sql
update public.profiles
set role = 'admin'
where id = '<the user's auth users id uuid>';
```

Find the id from **Authentication → Users**, or:

```sql
select id, email, created_at from auth.users;
```

> There is deliberately **no** self-serve path to admin — the signup form can
> only create `employee` accounts.

## 5. Managing employees

- **Add an employee** — from `/dashboard/employees` → **Add employee**. You
  create the sign-in account directly (name, email, temporary password — a
  generated password is offered). The account is usable immediately; the
  `profiles` row is created automatically by the signup trigger. This uses the
  `service_role` key server-side (`/api/employees`), so make sure
  `SUPABASE_SERVICE_ROLE_KEY` is set.
- **Deactivate / restore** — each employee card has a **Deactivate** action
  (soft delete, reversible). Deactivated accounts can no longer sign in, stop
  appearing on the live map and in assignee lists, and are flagged
  *Deactivated* in the directory ("Show deactivated" toggles them back into
  view). Their location history and tasks are preserved for the audit trail.
  You cannot deactivate your own account.
- Employees can still create their own accounts via `/signup` — both paths
  produce identical `employee`-role profiles.

## 6. Run it

```bash
npm run dev
```

- **Admin**: sign in → you land on `/dashboard`. Live map of all employees,
  employee list panel, task assignment, `/dashboard/tasks` kanban, and
  `/dashboard/employees/[id]` profiles.
- **Employee**: sign in (or sign up) → land on `/app`. Geolocation starts
  automatically. Tasks stream in live; tap **Navigate** for turn-by-turn.

### Testing with two tabs

1. Create an account (employee), then promote it to admin with the SQL above
   (or create two accounts and promote one).
2. Sign in as the admin in one browser/tab → `/dashboard`.
3. Sign in as the employee in another tab/device → `/app` and grant location
   permission.
4. From the admin tab, assign a task to the employee. Watch the marker appear,
   then complete the task by walking into the radius (or set a wide radius /
   drop the pin nearby) — it auto-flips to **Completed · reached the target**.
5. Open the employee's profile and set the date range to today to see the
   path trail.

## 7. Deploy to Vercel (so phones can track)

Browsers only grant geolocation over **HTTPS** (or `localhost`). Deploying to
Vercel gives you HTTPS for free, which is the easiest way to let real phones
participate.

```bash
npx vercel
```

Or connect the repo in the Vercel dashboard and add the three
environment variables (`NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) in Project
Settings → Environment Variables. This app is plain serverless-friendly
Next.js — no custom server.

## Background tracking — what's realistic in a browser

Continuous background tracking in a closed/backgrounded mobile browser tab is a
genuine browser limitation (the tab is suspended). To keep tracking alive as
long as possible:

- **"Add to Home Screen"** the app on the phone — a standalone PWA-style icon
  keeps the tab more alive.
- Keep the tab open and the screen on while on the road.
- Consider `navigator.geolocation`'s own caching + wake locks in a native
  companion app if you need true all-day background tracking.

We don't oversell this: **live location + history only accrues while the app is
open**. The admin UI shows an employee as *offline* after ~45s with no fix, so
stale positions are always visible.

## Map tiles, POIs & search — no API keys, but be polite

- **Tiles**: Esri World Street Map / OpenStreetMap (free, no key).
- **POI overlay**: the admin overview and task-picker maps render shops,
  pharmacies, cafés, banks, fuel stations, schools… as colored clustered dots.
  This is pulled live from the OpenStreetMap **Overpass API** for the visible
  map area (zoomed-in only). Requests are debounced (~1s), rate-spaced, and
  bbox-deduped to respect the public endpoint; for high volume, self-host
  Overpass.
- **Place search**: OpenStreetMap **Photon** geocoder. Photon indexes OSM POIs
  by name, so searching "Green Market Pharmacy" returns the exact building
  coordinates and lands the target pin on the shop. Debounced to ~600ms, capped
  at 5 results — be polite to the free public API.

## Project structure

```
app/
  layout.js                 root layout (theme init, providers)
  page.js                   server-side role redirect (/dashboard | /app)
  (auth)/login|signup       email/password auth
  api/employees/route.js    POST — admin creates an employee (service role)
  dashboard/                admin (server-guarded layout)
    page.js                 live overview map + employee list + stats
    tasks/page.js           kanban across all employees
    employees/page.js       employee directory (add / deactivate / restore)
    employees/[id]/page.js  profile: location history + task history + assign
  app/                      employee app (server-guarded layout)
    page.js                 my tasks + tracking status
    map/page.js             my position + task targets
components/
  providers/                Theme + Auth providers
  employee/                 EmployeeTracker (auto watchPosition), shell, task cards
  dashboard/                OverviewMap, sidebar, task board, NewTaskModal,
                            AddEmployeeModal, PlaceSearch (Photon)…
  map/                      AnimatedMarker, HistoryMap, EmployeeMap, PoiLayer,
                            pickers
  ui/                       Button, Input, Modal, Skeleton, Badge, Avatar…
hooks/                      useLiveOverview, useOwnTasks, useAdminTasks, …
lib/                        browser + server + admin Supabase clients, POI
                            helpers, utils, constants
supabase/migrations/        idempotent SQL (schema + RLS + triggers + realtime)
middleware.js               auth gate (role checks live in each layout)
```

## Security model summary

- Employees: insert their own `locations`; read only their own locations,
  profile, and tasks; `start_task` RPC for `pending → in_progress`.
- Admins: read all locations/profiles/tasks; insert & update tasks; complete
  tasks manually (`completion_source = 'manual'`); update any profile
  (deactivate/restore). Deleting `auth.users` requires the service-role key,
  which is only used inside `/api/employees`.
- Nobody: updates/deletes `locations` (append-only audit trail), changes a
  profile's `role` from the app, or deactivates themselves.
- Geofence completion is enforced by a Postgres trigger, not the client.
