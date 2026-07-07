import { defineConfig } from 'vitest/config';

// Tests import App.tsx, which transitively creates the Supabase client at module
// load — feed it dummy env so import doesn't throw. Pure logic (health scoring)
// runs in a node environment; no DOM needed.
export default defineConfig({
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://localhost:54321'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-anon-key'),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
