# Study Logbook — Multi-user with Real-time Leaderboard

A multi-user study time tracker with a live leaderboard, built on Next.js + Supabase. Deploy to Vercel in minutes.

## Features
- **Multi-user** — friends each create their own account
- **Real-time leaderboard** — updates live across all browsers the moment someone logs a session
- **Personal logbook** — timer, manual entry, charts, streak heatmap
- **Goals & targets** — daily targets, total goals, deadlines
- **Fully hosted** — Vercel (free) + Supabase (free tier is plenty)

---

## Step 1 — Set up Supabase (database)

1. Go to [supabase.com](https://supabase.com) and create a free account
2. Click **New project**, give it a name (e.g. `study-logbook`), pick a region close to you
3. Once your project is ready, go to **SQL Editor** (left sidebar)
4. Paste the entire contents of `supabase_setup.sql` and click **Run**
5. Go to **Project Settings → API**
6. Copy your **Project URL** and **anon/public key** — you'll need them next

---

## Step 2 — Deploy to Vercel

### Option A: GitHub (recommended)

1. Push this folder to a new GitHub repo:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/study-logbook.git
   git push -u origin main
   ```

2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import your repo

3. In the **Environment Variables** section, add:
   - `NEXT_PUBLIC_SUPABASE_URL` → your Supabase Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` → your Supabase anon key

4. Click **Deploy** — done in ~60 seconds!

### Option B: Vercel CLI

```bash
npm i -g vercel
cp .env.local.example .env.local
# Fill in your Supabase values in .env.local
vercel --prod
# When prompted, add the two env vars
```

---

## Step 3 — Invite friends

Share your Vercel URL (e.g. `https://study-logbook-xyz.vercel.app`) with friends. They create their own account and are immediately on the leaderboard.

---

## Run locally

```bash
npm install
cp .env.local.example .env.local
# Fill in your Supabase values
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Project structure

```
study-logbook/
├── app/
│   ├── layout.tsx          # Root layout + fonts
│   ├── page.tsx            # Entry: auth gate → app
│   └── globals.css         # All styles
├── components/
│   ├── AuthScreen.tsx      # Sign in / sign up
│   ├── AppShell.tsx        # Nav + user chip
│   ├── LogbookView.tsx     # Personal logbook tab
│   ├── LeaderboardView.tsx # Real-time leaderboard tab
│   └── StudyChart.tsx      # Chart.js chart + heat strip
├── lib/
│   └── supabase.ts         # Supabase client + types
├── supabase_setup.sql      # Run this once in Supabase
└── .env.local.example      # Copy → .env.local, fill in values
```

---

## Supabase free tier limits

The free tier gives you 500MB database + 2GB bandwidth/month — more than enough for a group of friends. The real-time feature is included.

---

## How real-time works

Supabase uses PostgreSQL's built-in replication to stream row changes over a WebSocket. When any user logs or deletes a session, every connected browser receives the change within ~100ms and the leaderboard re-renders automatically — no polling needed.
