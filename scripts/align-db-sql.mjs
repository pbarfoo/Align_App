#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function loadHermesEnvFallback() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return;
  const envPath = join(homedir(), '.hermes', '.env');
  if (!existsSync(envPath)) return;
  const envText = readFileSync(envPath, 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/);
    if (!match) continue;
    let value = match[1].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env.SUPABASE_ACCESS_TOKEN = value;
    return;
  }
}

loadHermesEnvFallback();

const args = process.argv.slice(2);
const fileIndex = args.indexOf('--file');
let sql;
if (fileIndex >= 0) {
  const file = args[fileIndex + 1];
  if (!file || !existsSync(file)) {
    console.error('Usage: scripts/align-db-sql.mjs "select ..." OR scripts/align-db-sql.mjs --file query.sql');
    process.exit(2);
  }
  sql = readFileSync(file, 'utf8');
} else {
  sql = args.join(' ');
}

if (!sql.trim()) {
  console.error('Usage: scripts/align-db-sql.mjs "select ..." OR scripts/align-db-sql.mjs --file query.sql');
  process.exit(2);
}

if (!process.env.SUPABASE_ACCESS_TOKEN) {
  console.error('SUPABASE_ACCESS_TOKEN is not set. Run: export SUPABASE_ACCESS_TOKEN="..."');
  process.exit(2);
}

const dry = spawnSync('supabase', ['db', 'dump', '--schema', 'public', '--dry-run'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
const dryText = `${dry.stdout}\n${dry.stderr}`;
if (dry.status !== 0) {
  console.error(dryText.replace(/PGPASSWORD="[^"]+"/g, 'PGPASSWORD="[redacted]"'));
  process.exit(dry.status ?? 1);
}

const pgEnv = {};
for (const key of ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE']) {
  const match = dryText.match(new RegExp(`export ${key}="([^"]+)"`));
  if (!match) {
    console.error(`Could not discover ${key} from Supabase CLI dry-run output`);
    process.exit(1);
  }
  pgEnv[key] = match[1];
}

const env = {
  ...process.env,
  ...pgEnv,
  PATH: `/opt/homebrew/opt/libpq/bin:${process.env.PATH ?? ''}`,
};

const wrappedSql = `set role postgres;\n${sql}`;
const psql = spawnSync('psql', ['-v', 'ON_ERROR_STOP=1', '-P', 'pager=off', '-c', wrappedSql], {
  encoding: 'utf8',
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
if (psql.stdout) process.stdout.write(psql.stdout);
if (psql.stderr) process.stderr.write(psql.stderr);
process.exit(psql.status ?? 1);
