# Align

A personal goal-alignment app that connects daily habits and tasks to long-term goals across three life domains.

## What is Align?

Align helps you stay on track with what matters most. You define goals across **Career**, **Self**, and **Community**, then break them down into short-term goals, tasks, and daily habits. A live **Health** score reflects how consistently you're executing — it rewards completing items and decays when you go stale.

## Features

- **Foundation** — Define life domains, long-term goals, short-term goals, tasks, and habits
- **Align** — Goals dashboard with Health / Done / Time bars per goal and a domain spider chart
- **Today** — Quick-complete today's habits and tasks; weekly Sunday reflection on your values
- **Reflection log** — Full history of weekly reflections with domain-grouped value scores

### Health formula
`health = completionRate × recencyScore`

Only active items (ST goals, tasks, habits) are scored — the LT goal is excluded so the bar is fully achievable through daily work. Habits with long streaks get a higher weight *and* an extended freshness window (4–8 weeks), doubly rewarding consistency.

## Tech stack

| Layer | Choice |
|-------|--------|
| UI framework | React 19 |
| Build tool | Vite |
| Language | TypeScript |
| Persistence | localStorage |
| Styling | Plain CSS (dark gold aesthetic) |

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Project structure

```
src/
  App.tsx      # Entire app — components, state, logic
  styles.css   # All styles
```

## License

Private.
