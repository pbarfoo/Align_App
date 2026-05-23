# Align

A personal goal-alignment app that connects daily habits and tasks to long-term goals and values across life domains.

## What is Align?

Align helps you stay on track with what matters most. You start by defining your core **values** and long-term **vision** across three life domains — **Career**, **Self**, and **Family/Others** — then set goals that reflect those values and break them down into short-term goals, tasks, and daily habits. A live **Health** score reflects how consistently you're executing — it rewards completing items and decays when you go stale.

## Features

- **Foundation** — Define life domains, core values, long-term vision, short-term goals, tasks, and habits
- **Align** — Goals dashboard with Health / Done / Time bars per goal and a domain spider chart
- **Today** — Quick-complete today's habits and tasks; weekly Sunday reflection on your values
- **Reflection log** — Full history of weekly reflections with domain-grouped value scores
- **Auth + cloud sync** — Email and password login; all data persisted to Supabase per account

---

## Option 1: Use the hosted app

No setup required. Just visit:

**[align-app-nine.vercel.app](https://align-app-nine.vercel.app)**

Create an account with your email and password, or sign in if you already have one. Your data is private to your account.

---

## Option 2: Run locally (no account needed)

Your data stays in your browser. No login, no server, no setup beyond Node.

```bash
git clone https://github.com/pbarfoo/Align_App.git
cd Align_App
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) — the app opens straight away and saves everything to localStorage.

---

## Option 3: Self-host with cloud sync

Run your own copy backed by your own database. You'll need a free [Supabase](https://supabase.com) account and a free [Vercel](https://vercel.com) account.

### 1. Clone the repo

```bash
git clone https://github.com/pbarfoo/Align_App.git
cd Align_App
npm install
```

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. In the Supabase dashboard, open the **SQL editor** and run the contents of [`supabase/schema.sql`](supabase/schema.sql)
3. Copy your project URL and anon key from **Project Settings → API**

### 3. Configure environment variables

Create a `.env` file in the project root:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). You'll be prompted to create an account or sign in.

### 5. Deploy to Vercel

1. Push the repo to GitHub
2. Import the project on [vercel.com](https://vercel.com)
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables in the Vercel project settings
4. Deploy — Vercel will build and host it automatically

---

## Project structure

```
src/
  App.tsx       # Entire app — components, state, logic
  data.ts       # Types, seed data, and utility functions
  supabase.ts   # Supabase client
  styles.css    # All styles
supabase/
  schema.sql    # Postgres schema with RLS policies
```

### Health formula

`health = completionRate × recencyScore`

Only active items (ST goals, tasks, habits) are scored. Habits with long streaks get a higher weight and an extended freshness window (4–8 weeks), doubly rewarding consistency.

## License

Private.
