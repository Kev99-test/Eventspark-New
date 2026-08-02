# EventSpark

An event dashboard where anyone can start an event, others can join it, and
the host earns "sparks" (reward points) for starting events and growing
attendance. Backed by Supabase (Postgres + auth + realtime).

## What's here

- `src/EventSpark.jsx` — the dashboard UI
- `src/lib/supabaseClient.js` — Supabase client setup
- `supabase/schema.sql` — database tables, security rules, and the reward
  logic (as SQL triggers)

## Why rewards are database triggers, not app code

If "give the host 10 sparks" lived in the React app, anyone could open
devtools and call the insert function directly to farm rewards. Instead,
`supabase/schema.sql` defines two triggers:

- `on_event_created` — fires the moment a row is inserted into `events`,
  pays the host 10 sparks
- `on_participant_joined` — fires on every new row in `participants`,
  checks the attendee count, and pays the host 15 sparks if it just
  crossed 3, 6, or 10

The client never touches the `sparks` column or `reward_log` table
directly — it only inserts events and participants, and reads back
whatever the database decided.

## 1. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) and create a free account
2. Create a new project (pick any name/region)
3. Once it's ready, go to **Project Settings → API** and copy:
   - Project URL
   - `anon` `public` key

## 2. Set up the database

1. In your Supabase project, open **SQL Editor → New query**
2. Paste in the entire contents of `supabase/schema.sql`
3. Run it — this creates the `profiles`, `events`, `participants`, and
   `reward_log` tables, plus the reward triggers

## 3. Turn on Google sign-in

1. In Supabase: **Authentication → Providers → Google** → toggle it on
2. You'll need a Google OAuth client ID/secret — Supabase's page links
   directly to the Google Cloud Console screen where you create one
3. Add your site URL (and `http://localhost:5173` for local dev) under
   **Authentication → URL Configuration → Redirect URLs**

## 4. Run it locally

```bash
npm install
cp .env.example .env
```

Fill in `.env` with your Project URL and anon key from step 1, then:

```bash
npm run dev
```

This starts Vite's dev server (prints a `localhost` URL).

## 5. Push to GitHub

```bash
git init
git add .
git commit -m "EventSpark: Supabase-backed event dashboard"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/eventspark.git
git push -u origin main
```

`.env` is already in `.gitignore`, so your Supabase keys won't get
committed. Anyone cloning the repo follows steps 1–4 with their own
Supabase project.

## 6. Deploy (optional)

Any static host works since this is a Vite/React app with no server of
its own — Supabase is the backend. Easiest options:

- **Vercel**: import the GitHub repo, add the two `VITE_...` env vars in
  the project settings, deploy
- **Netlify**: same idea — connect the repo, set env vars, deploy

Either way, remember to add your deployed URL to Supabase's
**Redirect URLs** (step 3) or Google sign-in will fail after deploy.

## Extending this

- **Cancel/edit events**: add an `UPDATE`/`DELETE` button that calls
  `supabase.from("events").update(...)` — the RLS policy already
  restricts this to the host
- **"My events" tab**: filter the `events` query by
  `initiator_id.eq.<user id>` or by checking `attendee_ids`
- **Leave an event**: `supabase.from("participants").delete().match({event_id, user_id})`
- **Calendar sync on edit**: swap the "Add to calendar" link (Option B)
  for the Calendar API (Option A) if you want the calendar event to
  auto-update when the host changes the time
