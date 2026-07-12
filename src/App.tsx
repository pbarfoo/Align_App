import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getGeminiCoachCard, saveCoachFeedback, getTodayCoachRating, type CoachCard } from './geminiAdvisor';
import {
  DndContext, type DragEndEvent, MouseSensor, TouchSensor,
  useSensor, useSensors, closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  domains as seedDomains,
  initialGoals,
  initialHabits,
  uid,
  getGoalCountdown,
  getRecurrenceString,
  getTaskCountdown,
  type DomainId,
  type Domain,
  type Goal,
  type Habit,
  type ActionKind,
  type Recurrence,
  type CustomUnit,
  type ReflectionEntry,
} from './data';
import { supabase } from './supabase';
import type { Session } from '@supabase/supabase-js';

type Tab = 'foundation' | 'align' | 'today';

interface ActionInput {
  startDate?: string;
  recurrence?: Recurrence;
  customInterval?: number;
  customUnit?: CustomUnit;
  specificDays?: number[];
  dueDate?: string;
  dueTime?: string;
}

/* ---- Supabase row mappers ---- */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Health badge data for a goal card — same calculation as the dashboard. */
interface GoalHealthInfo {
  health: number;   // 0–100
  nItems: number;   // direct habits/tasks + sub-goals attached to the goal
}

/** Optional action button rendered inside a toast (e.g. Undo a delete). */
interface ToastAction { label: string; run: () => void; }
/** Show a transient toast. Pass an action to render a button (holds the toast longer). */
type Flash = (msg: string, isError?: boolean, action?: ToastAction) => void;

/** Row from the stale_tasks view (RLS-safe, sorted worst-first). */
interface StaleTask {
  id: string;
  title: string;
  dueDate: string;      // YYYY-MM-DD
  goalTitle: string;
  daysOverdue: number;
}

function domainToRow(d: Domain, userId: string): Row {
  return { id: d.id, user_id: userId, name: d.name, blurb: d.blurb, values: d.values, vision: d.vision };
}
function domainFromRow(row: Row): Domain {
  return { id: row.id as DomainId, name: row.name, blurb: row.blurb, values: row.values, vision: row.vision };
}

function goalToRow(g: Goal, userId: string): Row {
  return {
    id: g.id, user_id: userId, domain_id: g.domainId,
    value_indexes: g.valueIndexes, horizon: g.horizon,
    title: g.title, parent_goal_id: g.parentGoalId ?? null,
    created_at: g.createdAt, timeframe: g.timeframe,
    completed_at: g.completedAt ?? null,
    sort_order: g.sortOrder ?? null,
  };
}
function goalFromRow(row: Row): Goal {
  return {
    id: row.id, domainId: row.domain_id as DomainId,
    valueIndexes: row.value_indexes ?? [],
    horizon: row.horizon as 'long' | 'short' | 'ongoing',
    title: row.title,
    parentGoalId: row.parent_goal_id ?? undefined,
    createdAt: row.created_at,
    timeframe: row.timeframe,
    completedAt: row.completed_at ?? undefined,
    sortOrder: row.sort_order ?? undefined,
  };
}

function habitToRow(h: Habit, userId: string): Row {
  const completions = Array.isArray(h.completions) ? h.completions : [];
  return {
    id: h.id, user_id: userId, goal_id: h.goalId,
    title: h.title, kind: h.kind, done_today: h.doneToday,
    start_date: h.startDate ?? null, recurrence: h.recurrence ?? null,
    custom_interval: h.customInterval ?? null, custom_unit: h.customUnit ?? null,
    specific_days: h.specificDays ?? null,
    due_date: h.dueDate ?? null, due_time: h.dueTime ?? null,
    focus_date: h.focusDate ?? null,
    skipped_dates: h.skippedDates ?? null,
    completed: h.completed ?? null, completed_at: h.completedAt ?? null,
    streak: h.streak ?? 0,
    completions,
  };
}
function habitFromRow(row: Row): Habit {
  const completions = Array.isArray(row.completions) ? row.completions : [];
  return {
    id: row.id, goalId: row.goal_id,
    title: row.title, kind: row.kind as 'habit' | 'task',
    doneToday: row.done_today ?? false,
    startDate: row.start_date ?? undefined,
    recurrence: (row.recurrence as Recurrence) ?? undefined,
    customInterval: row.custom_interval ?? undefined,
    customUnit: (row.custom_unit as CustomUnit) ?? undefined,
    specificDays: row.specific_days ?? undefined,
    dueDate: row.due_date ?? undefined,
    dueTime: row.due_time ?? undefined,
    focusDate: row.focus_date ?? undefined,
    skippedDates: row.skipped_dates ?? undefined,
    completed: row.kind === 'task' ? !!row.completed : row.completed ?? undefined,
    completedAt: row.completed_at ?? undefined,
    streak: row.streak ?? 0,
    completions,
  };
}

function reflToRow(r: ReflectionEntry, userId: string): Row {
  const year = new Date(r.date).getFullYear();
  return {
    id: `${userId.slice(0, 8)}-W${r.weekNumber}-${year}`,
    user_id: userId, week_number: r.weekNumber, year,
    date: r.date, scores: r.scores, note: r.note,
  };
}
function reflFromRow(row: Row): ReflectionEntry {
  return { weekNumber: row.week_number, date: row.date, scores: row.scores, note: row.note };
}

/* ---- Login screen ---- */
function LoginScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);
    setNotice(null);

    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setError(error.message);
    } else {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
      if (error) {
        setError(error.message);
      } else if (!data.session) {
        setNotice('Account created — check your email to confirm, then sign in.');
        setMode('signin');
      }
      // If session exists (email confirm disabled), onAuthStateChange handles it.
    }

    setLoading(false);
  };

  const switchMode = () => {
    setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
    setError(null);
    setNotice(null);
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">Align</div>
        <p className="login-msg">{mode === 'signin' ? 'Sign in to continue.' : 'Create your account.'}</p>
        <input
          className="login-input"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          autoFocus
        />
        <input
          className="login-input"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        {error && <p className="login-error">{error}</p>}
        {notice && <p className="login-sub">{notice}</p>}
        <button className="login-btn" onClick={submit} disabled={loading}>
          {loading ? '…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
        <p className="login-switch">
          {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
          <button className="login-switch-btn" onClick={switchMode}>
            {mode === 'signin' ? 'Create one' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}

export default function App() {
  // Auth
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    // Hard timeout so a paused/unreachable Supabase project can't hang the app forever.
    const authTimeout = setTimeout(() => setAuthLoading(false), 8000);
    supabase.auth.getSession().then(({ data }) => {
      clearTimeout(authTimeout);
      setSession(data.session);
      setAuthLoading(false);
    }).catch(() => { clearTimeout(authTimeout); setAuthLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      // Don't reset dataLoaded here — the data effect re-runs whenever session.user.id
      // changes (including sign-out), so it handles the no-session case itself.
      // Resetting dataLoaded on every null session (including INITIAL_SESSION when
      // Supabase is unavailable) would permanently lock the app on the loading screen.
    });
    return () => subscription.unsubscribe();
  }, []);

  // App state
  const [tab, setTab] = useState<Tab>('align');
  const [domains, setDomains] = useState<Domain[]>(seedDomains);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [reflectOpen, setReflectOpen] = useState(false);
  const [reflections, setReflections] = useState<ReflectionEntry[]>([]);
  // Overdue tasks needing triage (stale_tasks view, worst-first). Snapshot
  // from load; rows drop out client-side once the user acts on them.
  const [staleTasks, setStaleTasks] = useState<StaleTask[]>([]);

  // True while applying data freshly loaded from the DB, so the sync effects
  // don't immediately re-upsert it (which could overwrite newer data written
  // by another session/tab).
  const hydrating = useRef(false);

  // Load data from Supabase on sign-in. Keyed on the user id (not the whole
  // session object) so it runs ONCE per user — not on every token refresh or
  // tab-focus auth event, which would otherwise re-read stale data and clobber
  // in-progress local edits.
  useEffect(() => {
    if (!session) { setDataLoaded(true); return; }
    const userId = session.user.id;
    const timeout = setTimeout(() => {
      setToast({ msg: '⚠ Database taking too long — try refreshing' });
      setDataLoaded(true);
    }, 10000);
    Promise.all([
      supabase.from('domains').select('*').eq('user_id', userId),
      supabase.from('goals').select('*').eq('user_id', userId)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true }),
      supabase.from('habits').select('*').eq('user_id', userId).order('id'),
      supabase.from('reflections').select('*').eq('user_id', userId).order('date'),
      supabase.from('stale_tasks').select('*'),
    ]).then(([d, g, h, r, st]) => {
      const dbError = d.error || g.error || h.error || r.error;
      if (dbError) {
        console.error('Supabase load error:', dbError.message);
        setToast({ msg: `⚠ DB error: ${dbError.message} — run supabase/schema.sql` });
        setDataLoaded(true);
        return;
      }

      // Seed default content ONLY for brand-new accounts. Once an account has
      // been seeded, never repopulate defaults — an empty table means the user
      // deleted everything, not that they're new. This prevents deploys/reloads
      // from wiping saved data.
      const alreadySeeded = session.user.user_metadata?.seeded === true;

      hydrating.current = true; // skip the sync effects triggered by these setState calls

      if (d.data?.length) {
        setDomains(d.data.map(domainFromRow));
      } else if (!alreadySeeded) {
        supabase.from('domains').insert(seedDomains.map((x) => domainToRow(x, userId)));
      }
      if (g.data?.length) {
        setGoals(g.data.map(goalFromRow));
      } else if (!alreadySeeded) {
        supabase.from('goals').insert(initialGoals.map((x) => goalToRow(x, userId)));
        setGoals(initialGoals);
      }
      if (h.data?.length) {
        setHabits(h.data.map(habitFromRow));
      } else if (!alreadySeeded) {
        supabase.from('habits').insert(initialHabits.map((x) => habitToRow(x, userId)));
        setHabits(initialHabits);
      }
      if (r.data?.length) {
        const loaded = r.data.map(reflFromRow);
        // Deduplicate: if two rows share the same week+year, keep the one with the latest date
        const byKey = new Map<string, ReflectionEntry>();
        for (const e of loaded) {
          const k = `${e.weekNumber}-${new Date(e.date).getFullYear()}`;
          const cur = byKey.get(k);
          if (!cur || e.date > cur.date) byKey.set(k, e);
        }
        setReflections([...byKey.values()]);
      }

      // Triage list is additive — a view error must never block the app.
      if (st.error) {
        console.warn('stale_tasks load:', st.error.message);
      } else if (st.data) {
        setStaleTasks(st.data.map((row: Row) => ({
          id: row.id,
          title: row.title,
          dueDate: row.due_date,
          goalTitle: row.goal_title ?? '',
          daysOverdue: Number(row.days_overdue ?? 0),
        })));
      }

      // Mark this account as seeded so we never reseed/overwrite again.
      if (!alreadySeeded) supabase.auth.updateUser({ data: { seeded: true } });
      clearTimeout(timeout);
      setDataLoaded(true);
    }).catch((err) => {
      clearTimeout(timeout);
      console.error('Supabase load failed:', err);
      setToast({ msg: '⚠ Could not reach database — check your connection' });
      setDataLoaded(true);
    });
  }, [session?.user?.id]);

  // Sync domains
  useEffect(() => {
    if (!dataLoaded || hydrating.current || !session) return;
    supabase.from('domains').upsert(domains.map((x) => domainToRow(x, session.user.id)), { onConflict: 'id,user_id' })
      .then(({ error }) => { if (error) { console.error('sync domains:', error); setToast({ msg: `⚠ Save failed: ${error.message}` }); } });
  }, [domains]);

  // Sync goals
  useEffect(() => {
    if (!dataLoaded || hydrating.current || !session || !goals.length) return;
    supabase.from('goals').upsert(goals.map((x) => goalToRow(x, session.user.id)))
      .then(({ error }) => { if (error) { console.error('sync goals:', error); setToast({ msg: `⚠ Save failed: ${error.message}` }); } });
  }, [goals]);

  // Sync habits
  useEffect(() => {
    if (!dataLoaded || hydrating.current || !session || !habits.length) return;
    supabase.from('habits').upsert(habits.map((x) => habitToRow(x, session.user.id)))
      .then(({ error }) => { if (error) { console.error('sync habits:', error); setToast({ msg: `⚠ Save failed: ${error.message}` }); } });
  }, [habits]);

  // Sync reflections
  useEffect(() => {
    if (!dataLoaded || hydrating.current || !session || !reflections.length) return;
    supabase.from('reflections').upsert(reflections.map((x) => reflToRow(x, session.user.id)))
      .then(({ error }) => { if (error) { console.error('sync reflections:', error); setToast({ msg: `⚠ Save failed: ${error.message}` }); } });
  }, [reflections]);

  // Clear the hydration flag after the sync effects above have evaluated for
  // this render, so subsequent user edits sync normally.
  useEffect(() => {
    hydrating.current = false;
  });

  // Explicit delete helpers (upsert doesn't remove rows)
  const deleteGoalFromDb = (ids: string[]) => {
    if (!session) return;
    supabase.from('habits').delete().in('goal_id', ids)
      .then(({ error }) => { if (error) console.error('delete habits for goal:', error); });
    supabase.from('goals').delete().in('id', ids)
      .then(({ error }) => { if (error) { console.error('delete goals:', error); flash('Delete failed: ' + error.message, true); } });
  };
  const deleteHabitFromDb = (id: string) => {
    if (!session) return;
    supabase.from('habits').delete().eq('id', id)
      .then(({ error }) => { if (error) { console.error('delete habit:', error); flash('Delete failed: ' + error.message, true); } });
  };

  const [reviewOpen, setReviewOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; action?: ToastAction } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash: Flash = (msg, isError = false, action) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg: isError ? `⚠ ${msg}` : msg, action });
    // Actionable toasts (e.g. Undo) linger longer so there's time to click.
    toastTimer.current = setTimeout(() => setToast(null), action ? 6000 : 2500);
  };

  if (authLoading || !dataLoaded) {
    return (
      <div className="app-loading">
        <div className="app-loading-text">Loading…</div>
      </div>
    );
  }
  if (!session) return <LoginScreen />;

  return (
    <div className="app">
      <main>
        {tab === 'foundation' && (
          <Foundation domains={domains} setDomains={setDomains} />
        )}
        {tab === 'align' && (
          <Align
            domains={domains}
            goals={goals}
            setGoals={setGoals}
            habits={habits}
            setHabits={setHabits}
            flash={flash}
            onDeleteGoalFromDb={deleteGoalFromDb}
            onDeleteHabitFromDb={deleteHabitFromDb}
          />
        )}
        {tab === 'today' && (
          <Today
            habits={habits}
            setHabits={setHabits}
            goals={goals}
            domains={domains}
            reflections={reflections}
            staleTasks={staleTasks}
            onDeleteHabitFromDb={deleteHabitFromDb}
            setGoals={setGoals}
            onDeleteGoalFromDb={deleteGoalFromDb}
            onReflect={() => setReflectOpen(true)}
            flash={flash}
            userId={session?.user.id}
          />
        )}
      </main>

      {reflectOpen && (
        <Reflect
          domains={domains}
          onClose={() => setReflectOpen(false)}
          onSave={(scores, note, weekNumber, date) => {
            const entry: ReflectionEntry = { weekNumber, date, scores, note };
            const year = new Date(date).getFullYear();
            setReflections((r) => [
              ...r.filter((x) => !(x.weekNumber === weekNumber && new Date(x.date).getFullYear() === year)),
              entry,
            ]);
            flash('Reflection saved');
          }}
        />
      )}

      {reviewOpen && (
        <ReviewPanel
          domains={domains}
          goals={goals}
          habits={habits}
          reflections={reflections}
          onReset={() => {
            setReflections([]);
            if (session) supabase.from('reflections').delete().eq('user_id', session.user.id);
          }}
          onClose={() => setReviewOpen(false)}
        />
      )}

      {dashboardOpen && (
        <GoalsDashboard
          domains={domains}
          goals={goals}
          habits={habits}
          onClose={() => setDashboardOpen(false)}
        />
      )}

      <button className="dashboard-btn" onClick={() => setDashboardOpen(true)} aria-label="Goals dashboard">
        <IconDashboard />
      </button>
      <button className="profile-btn" onClick={() => setReviewOpen(true)} aria-label="Review">
        <IconCompass />
      </button>
      {session && (
        <div className="user-menu">
          <button
            className="user-btn"
            onClick={() => setProfileOpen((o) => !o)}
            aria-label="Account"
          >
            <IconUser />
          </button>
          {profileOpen && (
            <>
              <div className="user-dropdown-backdrop" onClick={() => setProfileOpen(false)} />
              <div className="user-dropdown">
                <div className="user-dropdown-email">{session.user.email}</div>
                <button
                  className="user-dropdown-signout"
                  onClick={() => { supabase.auth.signOut(); setProfileOpen(false); }}
                >
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {toast && (
        <div className="toast">
          <span>{toast.msg}</span>
          {toast.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                if (toastTimer.current) clearTimeout(toastTimer.current);
                toast.action!.run();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}

      <nav className="nav">
        <NavBtn label="Foundation" active={tab === 'foundation'} onClick={() => setTab('foundation')} icon={<IconBase />} />
        <NavBtn label="Align" active={tab === 'align'} onClick={() => setTab('align')} icon={<IconAlign />} />
        <NavBtn label="Today" active={tab === 'today'} onClick={() => setTab('today')} icon={<IconCheck />} />
      </nav>
    </div>
  );
}

/* ---------------- Date / Time Button ---------------- */
// Cross-browser picker field. Native date/time inputs render inconsistently
// when empty (iOS shows a blank box; desktop shows raw mm/dd/yyyy segments),
// and overlaying text on a live input collides with that native text. So we
// render our OWN facade (icon + formatted value or "Choose date/time") and lay
// a fully transparent native input over the whole field: the input still
// catches taps and opens the picker (showPicker on desktop, tap-to-focus on
// iOS), but the user only ever sees the facade we control.
function formatDateDisplay(v: string): string {
  const [y, m, d] = v.split('-').map(Number);
  if (!y || !m || !d) return v;
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const base = `${MON[m - 1]} ${d}`;
  return y === new Date().getFullYear() ? base : `${base}, ${y}`;
}
function formatTimeDisplay(v: string): string {
  const [h, min] = v.split(':').map(Number);
  if (Number.isNaN(h)) return v;
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min ?? 0).padStart(2, '0')} ${ampm}`;
}
function DateTimeField({ type, value, onChange, label, compact }: {
  type: 'date' | 'time'; value: string; onChange: (v: string) => void; label: string; compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const icon = type === 'date' ? '📅' : '🕐';
  const display = value
    ? (type === 'date' ? formatDateDisplay(value) : formatTimeDisplay(value))
    : (type === 'date' ? 'Choose date' : 'Choose time');
  // Desktop needs an explicit open (clicking a transparent input's body doesn't
  // drop the calendar); showPicker() does. iOS opens on the tap-to-focus itself.
  const openPicker = () => {
    const el = inputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (el && typeof el.showPicker === 'function') {
      try { el.showPicker(); } catch { /* iOS/older: focus fallback below */ }
    }
  };
  return (
    <label className={`date-field${compact ? ' date-field--compact' : ''}`}>
      {/* Caption above the field (skipped in compact mode, where the value is
          always present, e.g. rescheduling an existing due date). */}
      {!compact && <span className="date-field-label">{label}</span>}
      <span className="date-input-wrap" onClick={openPicker}>
        <span className={`date-facade${value ? '' : ' date-facade--empty'}`} aria-hidden="true">
          <span className="date-facade-icon">{icon}</span>
          <span className="date-facade-text">{display}</span>
        </span>
        <input
          ref={inputRef}
          type={type}
          value={value}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
          className="date-input-overlay"
        />
      </span>
    </label>
  );
}

function DateBtn({ value, onChange, placeholder, compact }: { value: string; onChange: (v: string) => void; placeholder: string; compact?: boolean }) {
  return <DateTimeField type="date" value={value} onChange={onChange} label={placeholder} compact={compact} />;
}

function TimeBtn({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <DateTimeField type="time" value={value} onChange={onChange} label={placeholder} />;
}

/* ---------------- Foundation ---------------- */
function Foundation({
  domains,
  setDomains,
}: {
  domains: Domain[];
  setDomains: (d: Domain[]) => void;
}) {
  const [open, setOpen] = useState<DomainId | null>('career');

  const updateVision = (id: DomainId, vision: string) =>
    setDomains(domains.map((d) => (d.id === id ? { ...d, vision } : d)));

  const updateValues = (id: DomainId, values: string[]) =>
    setDomains(domains.map((d) => (d.id === id ? { ...d, values } : d)));

  return (
    <div className="screen">
      <div className="eyebrow">Foundation</div>
      <h1>What matters</h1>
      <p className="lede">
        Three parts of a life. Name a few values for each, and a vision of who
        you want to be there. Everything else hangs off this.
      </p>

      {domains.map((d) => {
        const isOpen = open === d.id;
        return (
          <div key={d.id} className={`domain-card${isOpen ? ' open' : ''}`}>
            <button
              className="domain-head"
              onClick={() => setOpen(isOpen ? null : d.id)}
            >
              <span>
                <span className="domain-name">{d.name}</span>
                <span className="domain-blurb">{d.blurb}</span>
              </span>
              <Chevron up={isOpen} />
            </button>

            {isOpen && (
              <div className="domain-body">
                <div className="label">Values</div>
                <EditableValues
                  values={d.values}
                  onChange={(next) => updateValues(d.id, next)}
                />
                <div className="label">Vision</div>
                <textarea
                  className="vision"
                  rows={3}
                  value={d.vision}
                  onChange={(e) => updateVision(d.id, e.target.value)}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EditableValues({
  values,
  onChange,
}: {
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  const updateAt = (i: number, text: string) =>
    onChange(values.map((v, j) => (j === i ? text : v)));

  const removeAt = (i: number) => {
    onChange(values.filter((_, j) => j !== i));
    setEditingIdx(null);
  };

  const addNew = () => {
    onChange([...values, '']);
    setEditingIdx(values.length);
  };

  const commit = (i: number, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) removeAt(i);
    else {
      updateAt(i, trimmed);
      setEditingIdx(null);
    }
  };

  return (
    <>
      {values.length === 0 && editingIdx === null && (
        <div className="values-empty">No values yet — add one</div>
      )}
      <div className="values">
        {values.map((v, i) =>
          editingIdx === i ? (
            <span key={i} className="value-chip edit">
              <input
                autoFocus
                defaultValue={v}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') {
                    if (!v) removeAt(i);
                    else setEditingIdx(null);
                  }
                }}
                onBlur={(e) => commit(i, e.target.value)}
              />
              <button
                className="chip-x"
                title="Remove value"
                onMouseDown={(e) => {
                  e.preventDefault();
                  removeAt(i);
                }}
              >
                ×
              </button>
            </span>
          ) : (
            <button
              key={i}
              className="value-chip editable"
              onClick={() => setEditingIdx(i)}
            >
              {v}
            </button>
          ),
        )}
        {editingIdx === null && (
          <button className="value-chip add" onClick={addNew}>
            + Add value
          </button>
        )}
      </div>
    </>
  );
}

/* Context so GoalNode can render a grip handle that holds the drag listeners */
type DragListeners = Record<string, (...args: unknown[]) => unknown>;
const DragHandleCtx = React.createContext<DragListeners | null>(null);

/* Grip icon button — only renders when inside a SortableGoal */
function DragHandle() {
  const listeners = React.useContext(DragHandleCtx);
  if (!listeners) return null;
  return (
    <button
      className="node-drag"
      aria-label="Drag to reorder"
      title="Hold to drag"
      {...(listeners as React.HTMLAttributes<HTMLButtonElement>)}
      onClick={(e) => e.stopPropagation()}
    >
      <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor" aria-hidden="true">
        <circle cx="2" cy="1.5" r="1.5"/><circle cx="6" cy="1.5" r="1.5"/>
        <circle cx="2" cy="6" r="1.5"/><circle cx="6" cy="6" r="1.5"/>
        <circle cx="2" cy="10.5" r="1.5"/><circle cx="6" cy="10.5" r="1.5"/>
      </svg>
    </button>
  );
}

/* ---------------- SortableGoal (drag-to-reorder wrapper) ---------------- */
function SortableGoal({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <DragHandleCtx.Provider value={(listeners ?? null) as DragListeners | null}>
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.45 : 1 }}
        {...attributes}
      >
        {children}
      </div>
    </DragHandleCtx.Provider>
  );
}

/* ---------------- Align ---------------- */
function Align({
  domains,
  goals,
  setGoals,
  habits,
  setHabits,
  flash,
  onDeleteGoalFromDb,
  onDeleteHabitFromDb,
}: {
  domains: Domain[];
  goals: Goal[];
  setGoals: React.Dispatch<React.SetStateAction<Goal[]>>;
  habits: Habit[];
  setHabits: React.Dispatch<React.SetStateAction<Habit[]>>;
  flash: Flash;
  onDeleteGoalFromDb: (ids: string[]) => void;
  onDeleteHabitFromDb: (id: string) => void;
}) {
  const [domainId, setDomainId] = useState<DomainId>('career');
  const [lit, setLit] = useState<string | null>(null);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [addingForKind, setAddingForKind] = useState<'short' | 'action' | null>(null);
  const [editValuesFor, setEditValuesFor] = useState<string | null>(null);
  // Goal pending a delete-confirmation (null = no dialog open).
  const [pendingDeleteGoalId, setPendingDeleteGoalId] = useState<string | null>(null);
  const [hideCompleted, setHideCompleted] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('align-hide-completed-v1') ?? 'false'); } catch { return false; }
  });
  // Open the Align tab fully collapsed — every goal AND sub-goal starts closed,
  // a clean overview you expand into rather than a fully unrolled tree.
  const [collapsedGoals, setCollapsedGoals] = useState<Set<string>>(
    () => new Set(goals.map((g) => g.id)),
  );
  // Backstop: if goals hadn't loaded when this mounted (empty initial set),
  // collapse everything the first time they arrive — otherwise the tree would
  // open fully expanded.
  const collapseInit = useRef(false);
  useEffect(() => {
    if (!collapseInit.current && goals.length) {
      collapseInit.current = true;
      setCollapsedGoals(new Set(goals.map((g) => g.id)));
    }
  }, [goals]);
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null);

  const toggleCollapse = (id: string) =>
    setCollapsedGoals(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const sensors = useSensors(
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 3 } }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setGoals(prev => {
      const oi = prev.findIndex(g => g.id === active.id);
      const ni = prev.findIndex(g => g.id === over.id);
      // Renumber every goal after the move so the priority order (first per
      // domain = focus) persists to the DB via the normal sync upsert.
      return arrayMove(prev, oi, ni).map((g, i) => ({ ...g, sortOrder: i }));
    });
  };

  useEffect(() => {
    localStorage.setItem('align-hide-completed-v1', JSON.stringify(hideCompleted));
  }, [hideCompleted]);

  const domain = domains.find((d) => d.id === domainId)!;
  const domainGoals = goals.filter((g) => g.domainId === domainId);
  const topGoals = domainGoals.filter((g) => !g.parentGoalId);

  const litChain = useMemo(() => {
    if (!lit) return null;
    const set = new Set<string>([lit]);
    let goalId: string | undefined;
    if (lit.startsWith('h:')) {
      goalId = habits.find((x) => x.id === lit.slice(2))?.goalId;
    } else if (lit.startsWith('g:')) {
      goalId = lit.slice(2);
    } else if (lit.startsWith('v:')) {
      // light all goals (and their children + habits) that carry this value
      const vi = Number(lit.slice(2));
      goals.forEach((g) => {
        if (g.valueIndexes.includes(vi)) set.add(`g:${g.id}`);
      });
      goals.forEach((g) => {
        if (g.parentGoalId && set.has(`g:${g.parentGoalId}`)) set.add(`g:${g.id}`);
      });
      habits.forEach((h) => {
        if (set.has(`g:${h.goalId}`)) set.add(`h:${h.id}`);
      });
      return set;
    }
    while (goalId) {
      set.add(`g:${goalId}`);
      const g = goals.find((x) => x.id === goalId);
      if (g) g.valueIndexes.forEach((i) => set.add(`v:${i}`));
      goalId = g?.parentGoalId;
    }
    return set;
  }, [lit, goals, habits]);

  const cls = (id: string, base = 'node') =>
    `${base}${litChain ? (litChain.has(id) ? ' lit' : ' dim') : ''}`;

  // Health badges — single shared calculation (computeGoalHealthMap) so the
  // badge, the dashboard, and the coach all report the same number. Live:
  // recomputes as habits/tasks/goals change.
  const goalHealthMap = useMemo(() => computeGoalHealthMap(goals, habits), [goals, habits]);

  const addGoal = (
    valueIndexes: number[],
    title: string,
    horizon: 'long' | 'short' | 'ongoing',
    timeframe: number,
    parentGoalId?: string,
  ) => {
    setGoals((prev) => [...prev, {
      id: uid('g'),
      domainId,
      valueIndexes,
      horizon,
      title,
      ...(parentGoalId ? { parentGoalId } : {}),
      createdAt: Date.now(),
      timeframe,
      sortOrder: prev.length, // new goals join at the bottom of the priority order
    }]);
    setAddingFor(null);
    setAddingForKind(null);
    flash('Goal added');
  };

  const addAction = (
    goalId: string,
    title: string,
    kind: ActionKind,
    input: ActionInput,
  ) => {
    setHabits((prev) => [...prev, {
      id: uid('h'),
      goalId,
      title,
      kind,
      doneToday: false,
      completions: [],
      ...(kind === 'habit'
        ? {
            // Anchor every habit to a start date so missed-day detection knows
            // when it began (and brand-new habits don't show a spurious "missed
            // yesterday" chip). Honour an explicit start date when supplied.
            startDate: input.startDate || toDateStr(new Date()),
            recurrence: input.recurrence ?? 'daily',
            customInterval: input.customInterval ?? 1,
            customUnit: input.customUnit ?? 'weeks',
            specificDays: input.specificDays ?? undefined,
          }
        : {
            dueDate: input.dueDate || undefined,
            dueTime: input.dueTime || undefined,
          }),
    }]);
    setAddingFor(null);
    setAddingForKind(null);
    flash(kind === 'habit' ? 'Habit added' : 'Task added');
  };

  const updateGoalValues = (id: string, valueIndexes: number[]) =>
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, valueIndexes } : g)));

  const updateGoalTitle = (id: string, title: string) =>
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, title } : g)));

  const updateGoalTimeframe = (id: string, horizon: 'long' | 'short' | 'ongoing', timeframe: number) =>
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, horizon, timeframe } : g)));


  const updateHabit = (id: string, updates: Partial<Habit>) =>
    setHabits((prev) => prev.map((h) => (h.id === id ? { ...h, ...updates } : h)));

  const deleteGoal = (id: string) => {
    const remove = new Set<string>([id]);
    goals.forEach((g) => {
      if (g.parentGoalId && remove.has(g.parentGoalId)) remove.add(g.id);
    });
    if (addingFor && remove.has(addingFor)) setAddingFor(null);
    // Snapshot removed rows (goals with their original index, plus their
    // habits/tasks) so Undo can splice them back into place. Restoring to
    // state re-triggers the upsert sync, which re-creates the DB rows.
    const removedGoals = goals
      .map((g, i) => ({ g, i }))
      .filter(({ g }) => remove.has(g.id));
    const removedHabits = habits.filter((h) => remove.has(h.goalId));
    setGoals((prev) => prev.filter((g) => !remove.has(g.id)));
    setHabits((ph) => ph.filter((h) => !remove.has(h.goalId)));
    onDeleteGoalFromDb([...remove]);
    flash('Deleted', false, {
      label: 'Undo',
      run: () => {
        setGoals((prev) => {
          const next = [...prev];
          removedGoals.forEach(({ g, i }) => next.splice(Math.min(i, next.length), 0, g));
          return next;
        });
        setHabits((prev) => [...prev, ...removedHabits]);
      },
    });
  };

  const deleteHabit = (id: string) => {
    setHabits((prev) => prev.filter((h) => h.id !== id));
    onDeleteHabitFromDb(id);
    flash('Deleted');
  };

  // ☀ Flag / unflag a task as a priority for TODAY — surfaces it in the Today
  // tab's chosen-focus section. Day-scoped: focusDate holds the date it was
  // flagged for, so flags naturally lapse at midnight.
  const todayStr = toDateStr(new Date());
  const toggleTaskFocus = (id: string) =>
    setHabits((prev) => prev.map((h) =>
      h.id === id ? { ...h, focusDate: h.focusDate === todayStr ? undefined : todayStr } : h
    ));

  const toggleGoalComplete = (id: string) =>
    setGoals((prev) => prev.map((g) =>
      g.id === id ? { ...g, completedAt: g.completedAt ? undefined : Date.now() } : g
    ));

  const toggleHabit = (id: string) =>
    setHabits((prev) => prev.map((h) => {
      if (h.id !== id) return h;
      if (h.kind === 'task') {
        const turningOn = !h.completed;
        return { ...h, completed: turningOn, completedAt: turningOn ? Date.now() : undefined };
      }
      return toggleHabitCompletion(h);
    }));

  return (
    <div className="screen">
      {pendingDeleteGoalId && (() => {
        const warn = goalDeleteWarning(pendingDeleteGoalId, goals, habits);
        return (
          <ConfirmDialog
            title={warn.title}
            body={warn.body}
            confirmLabel="Delete"
            onConfirm={() => { deleteGoal(pendingDeleteGoalId); setPendingDeleteGoalId(null); }}
            onCancel={() => setPendingDeleteGoalId(null)}
          />
        );
      })()}
      <div className="eyebrow">Align</div>
      <h1>The thread</h1>
      <p className="lede">
        Your vision, goals, and the habits and tasks that serve them. Tap
        anything to trace it back.
      </p>

      <div className="pills">
        {domains.map((d) => (
          <button
            key={d.id}
            className={`pill${d.id === domainId ? ' active' : ''}`}
            onClick={() => {
              setDomainId(d.id);
              setLit(null);
              setAddingFor(null);
              setAddingForKind(null);
              setEditValuesFor(null);
            }}
          >
            {d.name.split(' ')[0]}
          </button>
        ))}
      </div>

      <div className="thread-vision">{domain.vision}</div>

      {domain.values.length > 0 && (
        <div className="value-row">
          {domain.values.map((v, vi) => (
            <button
              key={v}
              className={cls(`v:${vi}`, 'value-chip')}
              onClick={() => setLit(lit === `v:${vi}` ? null : `v:${vi}`)}
            >
              {v}
            </button>
          ))}
        </div>
      )}

      <button
        className={`hide-tasks-toggle${hideCompleted ? ' on' : ''}`}
        onClick={() => setHideCompleted((v) => !v)}
        title={hideCompleted ? 'Show completed' : 'Hide completed'}
      >
        {hideCompleted ? 'Show completed' : 'Hide completed'}
      </button>

      <div className="spine">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={topGoals.filter(g => !(hideCompleted && !!g.completedAt)).map(g => g.id)} strategy={verticalListSortingStrategy}>
        {topGoals
          .filter((g) => !(hideCompleted && !!g.completedAt))
          .map((goal, goalIdx) => {
          const goalValues = goal.valueIndexes.map((i) => domain.values[i]).filter(Boolean);
          const hasChildren = habits.some((h) => h.goalId === goal.id) || domainGoals.some((s) => s.parentGoalId === goal.id);
          // Priority order is now meaningful and persists (drag-to-reorder),
          // so the "in focus" highlight tapers by position instead of being
          // an all-or-nothing badge on the top card alone: #1 strongest,
          // fading out by the 3rd/4th position rather than vanishing after #1.
          const focusStrength = Math.max(0, 1 - goalIdx * 0.4);
          return (
          <SortableGoal key={goal.id} id={goal.id}>
          <div className="goal-thread" style={{ '--thread-color': THREAD_PALETTE[goalIdx % THREAD_PALETTE.length] } as React.CSSProperties}>
            <GoalNode
              goal={goal}
              values={goalValues}
              domainValues={domain.values}
              valueIndexes={goal.valueIndexes}
              editValuesActive={editValuesFor === goal.id}
              onEditValues={() => setEditValuesFor(editValuesFor === goal.id ? null : goal.id)}
              onChangeValues={(idxs) => updateGoalValues(goal.id, idxs)}
              className={cls(`g:${goal.id}`)}
              onClick={() => setLit(lit === `g:${goal.id}` ? null : `g:${goal.id}`)}
              canAddChild
              addActive={addingFor === goal.id}
              onAddChild={() => {
                if (addingFor === goal.id) { setAddingFor(null); setAddingForKind(null); }
                else { setAddingFor(goal.id); setAddingForKind(null); }
              }}
              onDelete={() => setPendingDeleteGoalId(goal.id)}
              onRename={(title) => updateGoalTitle(goal.id, title)}
              onChangeTimeframe={(horizon, t) => updateGoalTimeframe(goal.id, horizon, t)}
              isComplete={!!goal.completedAt}
              onToggleComplete={() => toggleGoalComplete(goal.id)}
              isCollapsed={collapsedGoals.has(goal.id)}
              onToggleCollapse={hasChildren ? () => toggleCollapse(goal.id) : undefined}
              focusStrength={focusStrength}
              showDragHandle
              health={goalHealthMap[goal.id]}
            />
            {!collapsedGoals.has(goal.id) && habits
              .filter((h) => {
                if (h.goalId !== goal.id) return false;
                if (!hideCompleted) return true;
                if (h.kind === 'task') return !h.completed;
                return !isHabitDoneThisPeriod(h);
              })
              .map((h) => {
                const done = h.kind === 'task' ? !!h.completed : isHabitDoneThisPeriod(h);
                return (
                  <React.Fragment key={h.id}>
                  <div
                    className={`${cls(`h:${h.id}`)} node short action-row${done ? ' completed' : ''}`}
                    onClick={() => setLit(lit === `h:${h.id}` ? null : `h:${h.id}`)}
                  >
                    <button
                      className={`node-check${done ? ' on' : ''}`}
                      title={done ? 'Mark incomplete' : 'Mark complete'}
                      onClick={(e) => { e.stopPropagation(); toggleHabit(h.id); }}
                    />
                    <div className="node-main">
                      <div className="action-title-row">
                        <span className="node-tag">{h.kind === 'task' ? 'Task' : 'Habit'}</span>
                        <span
                          className="node-title"
                          onClick={(e) => { e.stopPropagation(); setEditingHabitId(editingHabitId === h.id ? null : h.id); }}
                          title="Click to edit"
                          style={{ cursor: 'text' }}
                        >{h.title}</span>
                      </div>
                      <div className="node-foot">
                        <span className="goal-date">
                          {h.kind === 'task' ? getTaskCountdown(h) : getRecurrenceString(h)}
                        </span>
                        {(() => {
                          const graceDays = !done ? getGraceDays(h) : [];
                          const frozenDate = graceDays[0] ?? null;
                          if (!frozenDate) return null;
                          const fd = new Date(frozenDate + 'T12:00');
                          const DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
                          const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                          const graceLabel = `${DAY[fd.getDay()]}, ${MON[fd.getMonth()]} ${fd.getDate()}`;
                          return (
                            <button
                              className="streak-frozen streak-frozen-reset"
                              title="Skip this day — clears it without marking complete"
                              onClick={(e) => {
                                e.stopPropagation();
                                setHabits((prev) => prev.map((x) =>
                                  x.id !== h.id ? x : { ...x, startDate: dayAfter(frozenDate), skippedDates: [...(x.skippedDates ?? []), frozenDate] }
                                ));
                              }}
                            >
                              <CalIcon /> {graceLabel} ↺
                            </button>
                          );
                        })()}
                      </div>
                    </div>
                    <div className="node-ctrls">
                      {h.kind === 'task' && (
                        <button
                          className={`node-sun${h.focusDate === todayStr ? ' on' : ''}`}
                          title={h.focusDate === todayStr ? "Remove from today's focus" : "Focus on this today"}
                          onClick={(e) => { e.stopPropagation(); toggleTaskFocus(h.id); }}
                        ><SunIcon /></button>
                      )}
                      <button className="node-del" title="Delete"
                        onClick={(e) => { e.stopPropagation(); deleteHabit(h.id); }}
                      ><TrashIcon /></button>
                    </div>
                  </div>
                  {editingHabitId === h.id && (
                    <AddActionForm
                      goalId={h.goalId}
                      initial={h}
                      onSave={(updates) => { updateHabit(h.id, updates); setEditingHabitId(null); }}
                      onClose={() => setEditingHabitId(null)}
                    />
                  )}
                  </React.Fragment>
                );
              })}
            {!collapsedGoals.has(goal.id) && domainGoals
              .filter((s) => s.parentGoalId === goal.id)
              .map((sg) => (
                <ShortWithActions
                  key={sg.id}
                  goal={sg}
                  displayValues={[]}
                  habits={habits}
                  health={goalHealthMap[sg.id]}
                  cls={cls}
                  lit={lit}
                  setLit={setLit}
                  addingFor={addingFor}
                  setAddingFor={setAddingFor}
                  onAddAction={addAction}
                  onDeleteGoal={setPendingDeleteGoalId}
                  onRenameGoal={updateGoalTitle}
                  onChangeGoalTimeframe={updateGoalTimeframe}
                  onDeleteHabit={deleteHabit}
                  onEditHabit={updateHabit}
                  onToggleGoalComplete={toggleGoalComplete}
                  onToggleHabit={toggleHabit}
                  onToggleTaskFocus={toggleTaskFocus}
                  todayStr={todayStr}
                  hideCompleted={hideCompleted}
                  domainValues={domain.values}
                  domainVision={domain.vision}
                  isCollapsed={collapsedGoals.has(sg.id)}
                  onToggleCollapse={habits.some((h) => h.goalId === sg.id) ? () => toggleCollapse(sg.id) : undefined}
                />
              ))}
            {/* Add form always renders — even while the goal is collapsed —
                otherwise tapping + on a collapsed goal appears to do nothing. */}
            {addingFor === goal.id && (
              addingForKind === null ? (
                <div className="inline-add short add-form">
                  <div className="seg">
                    <button type="button" onClick={() => setAddingForKind('short')}>Sub-goal</button>
                    <button type="button" onClick={() => setAddingForKind('action')}>Habit / Task</button>
                  </div>
                  <button className="mini-ghost" onClick={() => { setAddingFor(null); setAddingForKind(null); }}>Cancel</button>
                </div>
              ) : addingForKind === 'short' ? (
                <AddGoalForm
                  domainValues={domain.values}
                  forceOpen
                  onClose={() => { setAddingFor(null); setAddingForKind(null); }}
                  indent="short"
                  onAdd={(idxs, title, horizon, timeframe) => addGoal(idxs, title, horizon, timeframe, goal.id)}
                />
              ) : (
                <AddActionForm
                  goalId={goal.id}
                  onAdd={addAction}
                  onClose={() => { setAddingFor(null); setAddingForKind(null); }}
                />
              )
            )}
          </div>
          </SortableGoal>
          );
        })}
        </SortableContext>
        </DndContext>

        <AddGoalForm
          domainValues={domain.values}
          onAdd={(idxs, title, horizon, timeframe) => addGoal(idxs, title, horizon, timeframe)}
        />
      </div>
    </div>
  );
}

function ShortWithActions({
  goal,
  displayValues,
  habits,
  health,
  cls,
  lit,
  setLit,
  addingFor,
  setAddingFor,
  onAddAction,
  onDeleteGoal,
  onRenameGoal,
  onChangeGoalTimeframe,
  onDeleteHabit,
  onEditHabit,
  onToggleGoalComplete,
  onToggleHabit,
  onToggleTaskFocus,
  todayStr,
  hideCompleted,
  editValuesActive,
  onEditValues,
  onChangeValues,
  valueIndexes,
  domainValues,
  isCollapsed,
  onToggleCollapse,
  focusStrength,
  showDragHandle,
  domainVision: _domainVision,
}: {
  goal: Goal;
  displayValues: string[];
  habits: Habit[];
  health?: GoalHealthInfo;
  domainValues?: string[];
  domainVision?: string;
  cls: (id: string, base?: string) => string;
  lit: string | null;
  setLit: (s: string | null) => void;
  addingFor: string | null;
  setAddingFor: (s: string | null) => void;
  onAddAction: (
    goalId: string,
    title: string,
    kind: ActionKind,
    input: ActionInput,
  ) => void;
  onDeleteGoal: (id: string) => void;
  onRenameGoal: (id: string, title: string) => void;
  onChangeGoalTimeframe: (id: string, horizon: 'long' | 'short' | 'ongoing', t: number) => void;
  onDeleteHabit: (id: string) => void;
  onEditHabit: (id: string, updates: Partial<Habit>) => void;
  onToggleGoalComplete: (id: string) => void;
  onToggleHabit: (id: string) => void;
  onToggleTaskFocus: (id: string) => void;
  todayStr: string;
  hideCompleted: boolean;
  editValuesActive?: boolean;
  onEditValues?: () => void;
  onChangeValues?: (idxs: number[]) => void;
  valueIndexes?: number[];
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  focusStrength?: number;
  showDragHandle?: boolean;
}) {
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null);
  if (hideCompleted && !!goal.completedAt) return null;

  return (
    <>
      <GoalNode
        goal={goal}
        values={displayValues}
        short
        className={cls(`g:${goal.id}`)}
        onClick={() => setLit(lit === `g:${goal.id}` ? null : `g:${goal.id}`)}
        canAddChild
        addActive={addingFor === goal.id}
        onAddChild={() =>
          setAddingFor(addingFor === goal.id ? null : goal.id)
        }
        onDelete={() => onDeleteGoal(goal.id)}
        onRename={(title) => onRenameGoal(goal.id, title)}
        onChangeTimeframe={(horizon, t) => onChangeGoalTimeframe(goal.id, horizon, t)}
        isComplete={!!goal.completedAt}
        onToggleComplete={() => onToggleGoalComplete(goal.id)}
        editValuesActive={editValuesActive}
        onEditValues={onEditValues}
        onChangeValues={onChangeValues}
        valueIndexes={valueIndexes}
        domainValues={domainValues}
        isCollapsed={isCollapsed}
        onToggleCollapse={onToggleCollapse}
        focusStrength={focusStrength}
        showDragHandle={showDragHandle}
        health={health}
      />
      {!isCollapsed && habits
        .filter((h) => {
          if (h.goalId !== goal.id) return false;
          if (!hideCompleted) return true;
          if (h.kind === 'task') return !h.completed;
          return !isHabitDoneThisPeriod(h); // hide habits done this period
        })
        .map((h) => {
          const done = h.kind === 'task' ? !!h.completed : isHabitDoneThisPeriod(h);
          return (
          <React.Fragment key={h.id}>
          <div
            className={`${cls(`h:${h.id}`)} habit action-row${done ? ' completed' : ''}`}
            onClick={() => setLit(lit === `h:${h.id}` ? null : `h:${h.id}`)}
          >
            <button
              className={`node-check${done ? ' on' : ''}`}
              title={done ? 'Mark incomplete' : 'Mark complete'}
              onClick={(e) => { e.stopPropagation(); onToggleHabit(h.id); }}
            />
            <div className="node-main">
              <div className="action-title-row">
                <span className="node-tag">{h.kind === 'task' ? 'Task' : 'Habit'}</span>
                <span
                  className="node-title"
                  onClick={(e) => { e.stopPropagation(); setEditingHabitId(editingHabitId === h.id ? null : h.id); }}
                  title="Click to edit"
                  style={{ cursor: 'text' }}
                >
                  {h.title}
                </span>
              </div>
              <div className="node-foot">
                <span className="goal-date">
                  {h.kind === 'task'
                    ? getTaskCountdown(h)
                    : getRecurrenceString(h)}
                </span>
                {(() => {
                  const graceDays = !done ? getGraceDays(h) : [];
                  const frozenDate = graceDays[0] ?? null;
                  if (!frozenDate) return null;
                  const fd = new Date(frozenDate + 'T12:00');
                  const DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
                  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                  const graceLabel = `${DAY[fd.getDay()]}, ${MON[fd.getMonth()]} ${fd.getDate()}`;
                  return (
                    <button
                      className="streak-frozen streak-frozen-reset"
                      title="Skip this day — clears it without marking complete"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditHabit(h.id, { startDate: dayAfter(frozenDate), skippedDates: [...(h.skippedDates ?? []), frozenDate] });
                      }}
                    >
                      <CalIcon /> {graceLabel} ↺
                    </button>
                  );
                })()}
              </div>
            </div>
            <div className="node-ctrls">
              {h.kind === 'task' && (
                <button
                  className={`node-sun${h.focusDate === todayStr ? ' on' : ''}`}
                  title={h.focusDate === todayStr ? "Remove from today's focus" : "Focus on this today"}
                  onClick={(e) => { e.stopPropagation(); onToggleTaskFocus(h.id); }}
                >
                  <SunIcon />
                </button>
              )}
              <button
                className="node-del"
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteHabit(h.id);
                }}
              >
                <TrashIcon />
              </button>
            </div>
          </div>
          {editingHabitId === h.id && (
            <AddActionForm
              goalId={h.goalId}
              initial={h}
              onSave={(updates) => { onEditHabit(h.id, updates); setEditingHabitId(null); }}
              onClose={() => setEditingHabitId(null)}
            />
          )}
          </React.Fragment>
          );
        })}
      {/* Always render the add form — a collapsed (or chevron-less) sub-goal
          must still show it when + is tapped. */}
      {addingFor === goal.id && (
        <AddActionForm
          goalId={goal.id}
          onAdd={onAddAction}
          onClose={() => setAddingFor(null)}
        />
      )}
    </>
  );
}

function AddActionForm({
  goalId,
  onAdd,
  onSave,
  onClose,
  initial,
  defaultKind,
}: {
  goalId: string;
  onAdd?: (goalId: string, title: string, kind: ActionKind, input: ActionInput) => void;
  onSave?: (updates: Partial<Habit>) => void;
  onClose: () => void;
  initial?: Habit;
  defaultKind?: ActionKind;
}) {
  const [kind, setKind] = useState<ActionKind>(initial?.kind ?? defaultKind ?? 'task');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [recurrence, setRecurrence] = useState<Recurrence>(initial?.recurrence ?? 'daily');
  const [customInterval, setCustomInterval] = useState(String(initial?.customInterval ?? 1));
  const [customUnit, setCustomUnit] = useState<CustomUnit>(initial?.customUnit ?? 'weeks');
  const [specificDays, setSpecificDays] = useState<number[]>(initial?.specificDays ?? []);
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '');
  const [dueTime, setDueTime] = useState(initial?.dueTime ?? '');

  const toggleDay = (d: number) =>
    setSpecificDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b));

  const submit = () => {
    if (!title.trim()) return;
    if (onSave) {
      if (kind === 'habit') {
        onSave({ title: title.trim(), kind, recurrence,
          customInterval: Number(customInterval) || 1, customUnit,
          specificDays: recurrence === 'specific-days' ? specificDays : undefined,
          dueDate: undefined, dueTime: undefined, startDate: undefined });
      } else {
        onSave({ title: title.trim(), kind, dueDate: dueDate || undefined,
          dueTime: dueTime || undefined, recurrence: undefined, startDate: undefined });
      }
    } else if (onAdd) {
      if (kind === 'habit') {
        onAdd(goalId, title, 'habit', { recurrence,
          customInterval: Number(customInterval) || 1, customUnit,
          specificDays: recurrence === 'specific-days' ? specificDays : undefined });
      } else {
        onAdd(goalId, title, 'task', { dueDate, dueTime });
      }
    }
  };

  return (
    <div className="inline-add habit add-form">
      <div className="seg">
        <button type="button" className={kind === 'habit' ? 'on' : ''} onClick={() => setKind('habit')}>
          Habit
        </button>
        <button type="button" className={kind === 'task' ? 'on' : ''} onClick={() => setKind('task')}>
          Task
        </button>
      </div>

      <div className="ai-field">
        <input
          autoFocus
          placeholder={kind === 'habit' ? 'e.g. Run' : 'e.g. Write the launch post'}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />

      </div>

      {kind === 'habit' ? (
        <>
          <div className="field-row">
            <select
              value={recurrence === 'specific-days' ? 'custom' : recurrence}
              onChange={(e) => {
                const v = e.target.value as Recurrence;
                setRecurrence(v);
              }}
            >
              <option value="daily">Daily</option>
              <option value="weekdays">Every weekday</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="custom">Custom…</option>
            </select>
          </div>
          {(recurrence === 'custom' || recurrence === 'specific-days') && (
            <>
              <div className="seg">
                <button
                  type="button"
                  className={recurrence === 'custom' ? 'on' : ''}
                  onClick={() => setRecurrence('custom')}
                >
                  Interval
                </button>
                <button
                  type="button"
                  className={recurrence === 'specific-days' ? 'on' : ''}
                  onClick={() => setRecurrence('specific-days')}
                >
                  Specific days
                </button>
              </div>
              {recurrence === 'custom' ? (
                <div className="field-row">
                  <span className="field-label">Every</span>
                  <input type="number" min="1" max="99" value={customInterval}
                    onChange={(e) => setCustomInterval(e.target.value)} style={{ width: '64px' }} />
                  <select value={customUnit} onChange={(e) => setCustomUnit(e.target.value as CustomUnit)}>
                    <option value="days">days</option>
                    <option value="weeks">weeks</option>
                    <option value="months">months</option>
                    <option value="years">years</option>
                  </select>
                </div>
              ) : (
                <div className="day-picker">
                  {['Su','Mo','Tu','We','Th','Fr','Sa'].map((label, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`day-btn${specificDays.includes(i) ? ' on' : ''}`}
                      onClick={() => toggleDay(i)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <div className="field-row">
          <DateBtn value={dueDate} onChange={setDueDate} placeholder="Due date" />
          <TimeBtn value={dueTime} onChange={setDueTime} placeholder="Due time" />
        </div>
      )}

      <div className="add-actions">
        <button className="mini-primary" onClick={submit}>
          {onSave ? 'Save' : 'Add'}
        </button>
        <button className="mini-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
      {onSave && initial?.kind === 'habit' && (initial.streak ?? 0) > 0 && (
        <div className="streak-reset-row">
          <button
            className="streak-reset-btn"
            onClick={() => { onSave({ streak: 0, completions: [] }); onClose(); }}
          >
            Reset streak ({initial.streak})
          </button>
        </div>
      )}
    </div>
  );
}

function AddGoalForm({
  domainValues,
  onAdd,
  forceOpen,
  onClose,
  indent,
}: {
  domainValues: string[];
  onAdd: (valueIndexes: number[], title: string, horizon: 'long' | 'short' | 'ongoing', timeframe: number) => void;
  forceOpen?: boolean;
  onClose?: () => void;
  indent?: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [timeKey, setTimeKey] = useState('short:1');

  const isOpen = forceOpen || open;
  const cls = `inline-add${indent ? ` ${indent}` : ''}`;

  const reset = () => { setTitle(''); setPicked([]); setTimeKey('short:1'); };
  const close = () => { reset(); forceOpen ? onClose?.() : setOpen(false); };

  const submit = () => {
    if (!title.trim()) return;
    const [h, t] = timeKey.split(':');
    onAdd([...picked].sort((a, b) => a - b), title.trim(), h as 'long' | 'short' | 'ongoing', Number(t));
    close();
  };

  const togglePick = (i: number) =>
    setPicked((p) => p.includes(i) ? p.filter((x) => x !== i) : [...p, i]);

  if (!isOpen) return (
    <button className={`${cls} add-btn`} onClick={() => setOpen(true)}>
      + Add goal
    </button>
  );

  return (
    <div className={`${cls} add-form`}>
      <div className="ai-field">
        <input
          autoFocus
          placeholder="e.g. Run a 5K"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </div>
      {domainValues.length > 0 && (
        <>
          <div className="field-label">Values (optional)</div>
          <div className="value-check">
            {domainValues.map((v, i) => (
              <button key={v} type="button"
                className={`value-chip small${picked.includes(i) ? ' on' : ''}`}
                onClick={() => togglePick(i)}
              >{v}</button>
            ))}
          </div>
        </>
      )}
      <select value={timeKey} onChange={(e) => setTimeKey(e.target.value)}>
        <option value="ongoing:0">Ongoing (no deadline)</option>
        <option value="short:1">1 month</option>
        <option value="short:3">3 months</option>
        <option value="short:6">6 months</option>
        <option value="short:12">1 year</option>
        <option value="long:2">2 years</option>
        <option value="long:3">3 years</option>
        <option value="long:4">4 years</option>
        <option value="long:5">5 years</option>
      </select>
      <div className="add-actions">
        <button className="mini-primary" onClick={submit}>Add</button>
        <button className="mini-ghost" onClick={close}>Cancel</button>
      </div>
    </div>
  );
}

function GoalNode({
  goal,
  values = [],
  domainValues,
  valueIndexes,
  short,
  className,
  onClick,
  canAddChild,
  addActive,
  onAddChild,
  onDelete,
  onRename,
  onChangeTimeframe,
  editValuesActive,
  onEditValues,
  onChangeValues,
  isComplete,
  onToggleComplete,
  isCollapsed,
  onToggleCollapse,
  focusStrength,
  showDragHandle,
  health,
}: {
  goal: Goal;
  values?: string[];
  domainValues?: string[];
  valueIndexes?: number[];
  short?: boolean;
  className: string;
  onClick: () => void;
  canAddChild?: boolean;
  addActive?: boolean;
  onAddChild?: () => void;
  onDelete?: () => void;
  onRename?: (title: string) => void;
  onChangeTimeframe?: (horizon: 'long' | 'short' | 'ongoing', t: number) => void;
  editValuesActive?: boolean;
  onEditValues?: () => void;
  onChangeValues?: (idxs: number[]) => void;
  isComplete?: boolean;
  onToggleComplete?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  /** 0–1: how strongly to show this goal as "in focus". Priority order now
   * persists (drag-to-reorder), so this tapers by position rather than being
   * an all-or-nothing badge on the top card alone. */
  focusStrength?: number;
  showDragHandle?: boolean;
  health?: GoalHealthInfo;
}) {
  const canEditValues = !!onEditValues;
  const idxs = valueIndexes ?? [];
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingTimeframe, setEditingTimeframe] = useState(false);
  const [draft, setDraft] = useState(goal.title);
  const hasFocus = (focusStrength ?? 0) > 0.02;

  const commitRename = () => {
    if (draft.trim() && draft.trim() !== goal.title) onRename?.(draft.trim());
    else setDraft(goal.title);
    setEditingTitle(false);
  };

  const startEdit = (e: React.MouseEvent) => {
    if (!onRename) return;
    e.stopPropagation();
    setDraft(goal.title);
    setEditingTitle(true);
  };

  return (
    <div
      className={`${className}${short ? ' short' : ''}${isComplete ? ' completed' : ''}${hasFocus ? ' focus-goal' : ''}`}
      style={hasFocus ? ({ '--focus-strength': focusStrength } as React.CSSProperties) : undefined}
      onClick={onClick}
    >
      <div className="node-left-col">
        {onToggleCollapse && (
          <button
            className={`node-collapse${isCollapsed ? ' collapsed' : ''}`}
            title={isCollapsed ? 'Expand' : 'Collapse'}
            onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        {showDragHandle && <DragHandle />}
        {onToggleComplete && (
          <button
            className={`node-check${isComplete ? ' on' : ''}`}
            title={isComplete ? 'Mark incomplete' : 'Mark complete'}
            onClick={(e) => { e.stopPropagation(); onToggleComplete(); }}
          />
        )}
      </div>
      <div className="node-main">
        <div className="node-tag">
          {'Goal · '}
          {editingTimeframe && onChangeTimeframe ? (
            <select
              className="timeframe-select"
              value={`${goal.horizon}:${goal.timeframe}`}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const [h, t] = e.target.value.split(':');
                onChangeTimeframe(h as 'long' | 'short' | 'ongoing', Number(t));
                setEditingTimeframe(false);
              }}
              onBlur={() => setEditingTimeframe(false)}
            >
              <option value="ongoing:0">Ongoing</option>
              <option value="short:1">1 mo</option>
              <option value="short:3">3 mo</option>
              <option value="short:6">6 mo</option>
              <option value="short:12">1 yr</option>
              <option value="long:2">2 yr</option>
              <option value="long:3">3 yr</option>
              <option value="long:4">4 yr</option>
              <option value="long:5">5 yr</option>
            </select>
          ) : (
            <span
              onClick={onChangeTimeframe ? (e) => { e.stopPropagation(); setEditingTimeframe(true); } : undefined}
              title={onChangeTimeframe ? 'Click to edit' : undefined}
              style={onChangeTimeframe ? { cursor: 'pointer', textDecoration: 'underline dotted' } : undefined}
            >
              {goal.horizon === 'ongoing' ? '∞' : goal.horizon === 'long' ? `${goal.timeframe} yr` : goal.timeframe === 12 ? '1 yr' : `${goal.timeframe} mo`}
            </span>
          )}
        </div>
        {editingTitle ? (
          <div className="ai-field" onClick={(e) => e.stopPropagation()}>
            <input
              className="node-title-input"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') { setDraft(goal.title); setEditingTitle(false); }
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        ) : (
          <div
            className="node-title"
            onClick={onRename ? startEdit : undefined}
            title={onRename ? 'Click to edit' : undefined}
            style={onRename ? { cursor: 'text' } : undefined}
          >
            {goal.title}
          </div>
        )}
        <div className="node-foot">
          {values.map((v) => (
            <span key={v} className="goal-value">
              {v}
            </span>
          ))}
          {canEditValues && (
            <button
              className="goal-value-tag"
              title={values.length === 0 ? 'Add values' : 'Edit values'}
              onClick={(e) => {
                e.stopPropagation();
                onEditValues!();
              }}
            >
              {values.length === 0 ? '+ Values' : '✎'}
            </button>
          )}
          <span className="goal-date">{getGoalCountdown(goal)}</span>
          {health && !isComplete && (
            <span
              className={`goal-health ${
                health.health <= 33 ? 'goal-health--red'
                : health.health <= 66 ? 'goal-health--yellow'
                : 'goal-health--green'
              }`}
              title={health.nItems === 0 ? 'No tasks or habits yet — add one to build health' : 'Goal health (0–100)'}
            >
              ♥ {health.health}
            </span>
          )}
        </div>
        {editValuesActive && domainValues && (
          <div
            className="value-editor"
            onClick={(e) => e.stopPropagation()}
          >
            {domainValues.map((v, i) => (
              <button
                key={i}
                className={`value-chip small${idxs.includes(i) ? ' on' : ''}`}
                onClick={() =>
                  onChangeValues?.(
                    idxs.includes(i)
                      ? idxs.filter((x) => x !== i)
                      : [...idxs, i].sort((a, b) => a - b),
                  )
                }
              >
                {v}
              </button>
            ))}
            <button
              className="done-btn"
              onClick={(e) => {
                e.stopPropagation();
                onEditValues!();
              }}
            >
              Done
            </button>
          </div>
        )}
      </div>
      <div className="node-ctrls">
        {canAddChild && (
          <button
            className={`node-add${addActive ? ' on' : ''}`}
            title={short ? 'Add habit or task' : 'Add short-term goal'}
            onClick={(e) => {
              e.stopPropagation();
              onAddChild?.();
            }}
          >
            {addActive ? '×' : '+'}
          </button>
        )}
        {onDelete && (
          <button
            className="node-del"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <TrashIcon />
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------- Today ---------------- */
function Today({
  habits,
  setHabits,
  goals,
  domains,
  reflections,
  staleTasks,
  onDeleteHabitFromDb,
  setGoals,
  onDeleteGoalFromDb,
  onReflect,
  flash,
  userId,
}: {
  habits: Habit[];
  setHabits: React.Dispatch<React.SetStateAction<Habit[]>>;
  goals: Goal[];
  domains: Domain[];
  reflections: ReflectionEntry[];
  staleTasks: StaleTask[];
  onDeleteHabitFromDb: (id: string) => void;
  setGoals: React.Dispatch<React.SetStateAction<Goal[]>>;
  onDeleteGoalFromDb: (ids: string[]) => void;
  onReflect: () => void;
  flash: Flash;
  userId?: string;
}) {
  const [showDone, setShowDone] = useState(false);
  // Goal pending a delete-confirmation from the triage row (null = closed).
  const [pendingDeleteGoalId, setPendingDeleteGoalId] = useState<string | null>(null);
  // "More" (everything beyond Up next) — collapse state persists across visits.
  const [moreOpen, setMoreOpen] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('today-more-open-v1') ?? 'false'); } catch { return false; }
  });
  useEffect(() => {
    localStorage.setItem('today-more-open-v1', JSON.stringify(moreOpen));
  }, [moreOpen]);

  // Shared health map: row chips + coach grounding all read the same numbers.
  const goalHealthMap = useMemo(() => computeGoalHealthMap(goals, habits), [goals, habits]);

  const [coachCard, setCoachCard] = useState<CoachCard | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachFailed, setCoachFailed] = useState(false);
  const [coachRating, setCoachRating] = useState<'up' | 'down' | null>(null);
  const today = toDateStr(new Date());

  const fetchCoachCard = () => {
    if (!goals.length && !habits.length) return;
    setCoachLoading(true);
    setCoachFailed(false);
    // Feed the coach the SAME health numbers the user sees on their goal
    // cards (title-keyed; overrides the server view's figures).
    const appGoalHealth = Object.fromEntries(
      goals.filter((g) => !g.completedAt).map((g) => {
        const gh = goalHealthMap[g.id];
        // Empty goals report their EARNED health (0) to the AI even during
        // the new-goal grace, so it nudges a first action from day one while
        // the badge stays green.
        return [g.title, gh ? (gh.nItems === 0 ? 0 : gh.health) : 0];
      }),
    );
    getGeminiCoachCard(domains, goals, habits, reflections, userId, appGoalHealth)
      .then(async (card) => {
        setCoachCard(card);
        const rating = await getTodayCoachRating(today, card.title, userId);
        setCoachRating(rating);
      })
      .catch((err) => {
        console.warn('Gemini coach unavailable:', err);
        setCoachCard(null);
        setCoachFailed(true);
      })
      .finally(() => setCoachLoading(false));
  };

  // --- Classify what's relevant *today* ---
  const scheduledHabits = habits.filter(
    (h) => h.kind === 'habit' && isHabitScheduledToday(h),
  );
  const openHabits = scheduledHabits.filter((h) => !isHabitDoneThisPeriod(h));
  const doneHabits = scheduledHabits.filter((h) => isHabitDoneThisPeriod(h));

  const tasks = habits.filter((h) => h.kind === 'task');
  const openTasks = tasks.filter((h) => !h.completed);
  const overdueTasks = openTasks.filter((t) => t.dueDate && t.dueDate < today);
  const dueTodayTasks = openTasks.filter((t) => t.dueDate === today);
  const completedToday = tasks.filter(
    (t) => t.completed && t.completedAt && toDateStr(new Date(t.completedAt)) === today,
  );
  // Tasks the user hand-flagged (☀) as today's priority, in the Align tab.
  const focusTasks = openTasks.filter((t) => t.focusDate === today);
  const focusTaskIds = new Set(focusTasks.map((t) => t.id));

  const doneItems = [...doneHabits, ...completedToday];

  // Flag/unflag a task as today's focus (mirrors Align's ☀ toggle) so the
  // Today section can remove a task from itself.
  const toggleTaskFocus = (id: string) =>
    setHabits((prev) => prev.map((h) =>
      h.id === id ? { ...h, focusDate: h.focusDate === today ? undefined : today } : h
    ));

  // Once a day, drop stale per-day keys left by earlier picker experiments so
  // localStorage doesn't accumulate one entry per day.
  useEffect(() => {
    const prefixes = ['align-today-plan-', 'align-focus-scope-', 'align-focus-manual-'];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key) continue;
      const p = prefixes.find((pre) => key.startsWith(pre));
      if (p && key.slice(p.length) !== today) localStorage.removeItem(key);
    }
  }, [today]);


  // Progress: today's habits + urgent tasks + tasks finished today
  const totalCount =
    scheduledHabits.length + overdueTasks.length + dueTodayTasks.length + completedToday.length;
  const done = doneHabits.length + completedToday.length;
  const pct = totalCount ? Math.round((done / totalCount) * 100) : 0;

  // Group today's open items (habits + upcoming tasks) by domain for the
  // main list, so balance across life areas is visible.
  const domainOf = (goalId: string) =>
    goals.find((g) => g.id === goalId)?.domainId;
  const horizonOf = (goalId: string) => {
    const h = goals.find((g) => g.id === goalId)?.horizon;
    return h === 'ongoing' ? 'short' : h;
  };

  // Priority tier (lower = higher up). Short-term goals are the active push,
  // so they rank above long-term — but a long-term item that's been neglected
  // escalates to the top so it doesn't quietly rot at the bottom.
  const tierOf = (item: Habit): number => {
    if (horizonOf(item.goalId) === 'long') {
      return isNeglected(item) ? 0 : 2;
    }
    return 1; // short-term (and items on goals with no horizon)
  };
  // Within a tier: habits that have been waiting longest first, then tasks by
  // due date. Habits sort ahead of upcoming tasks within the same tier.
  const subKey = (item: Habit): number => {
    if (item.kind === 'habit') {
      const since = daysSinceLastDone(item);
      return -(since === Infinity ? 1e9 : since);
    }
    return item.dueDate ? new Date(item.dueDate + 'T12:00').getTime() : Number.MAX_SAFE_INTEGER;
  };
  const byPriority = (a: Habit, b: Habit) =>
    tierOf(a) - tierOf(b) || subKey(a) - subKey(b);

  const todayItemsByDomain = (domainId: DomainId) =>
    [
      ...openHabits.filter((h) => domainOf(h.goalId) === domainId),
      ...openTasks.filter((t) => domainOf(t.goalId) === domainId),
    ].sort(byPriority);

  const toggle = (id: string) => {
    setHabits((prev) => prev.map((h) => {
      if (h.id !== id) return h;
      if (h.kind === 'task') {
        const turningOn = !h.completed;
        return { ...h, completed: turningOn, completedAt: turningOn ? Date.now() : undefined };
      }
      return toggleHabitCompletion(h);
    }));
  };

  const lineage = (goalId: string) => {
    const g = goals.find((x) => x.id === goalId);
    if (!g) return '';
    if (g.parentGoalId) {
      const parent = goals.find((x) => x.id === g.parentGoalId);
      return parent ? `${parent.title} → ${g.title}` : g.title;
    }
    return g.title;
  };

  // --- Overdue tasks: rendered inline in the Today list with their decision
  // actions (check off / reschedule / break down / delete). Days-overdue comes
  // from the stale_tasks view when available, else computed locally so nothing
  // slips through between loads.
  const [breakdownFor, setBreakdownFor] = useState<string | null>(null);
  const staleById = new Map(staleTasks.map((st) => [st.id, st]));
  const daysOverdueOf = (task: Habit): number => {
    const st = staleById.get(task.id);
    if (st && st.dueDate === task.dueDate) return st.daysOverdue;
    return Math.max(1, Math.floor(
      (Date.now() - new Date((task.dueDate ?? today) + 'T12:00').getTime()) / 86_400_000,
    ));
  };

  const rescheduleTask = (id: string, newDate: string) => {
    if (!newDate) return;
    setHabits((prev) => prev.map((h) => (h.id === id ? { ...h, dueDate: newDate } : h)));
  };

  const deleteTask = (id: string) => {
    setHabits((prev) => prev.filter((h) => h.id !== id));
    onDeleteHabitFromDb(id);
  };

  // Expired goals: deadline passed, still open — they need a decision too.
  const goalDeadline = (g: Goal): number | null => {
    if (g.horizon === 'ongoing') return null;
    const t = new Date(g.createdAt || Date.now());
    if (g.horizon === 'long') t.setFullYear(t.getFullYear() + (g.timeframe || 1));
    else t.setMonth(t.getMonth() + (g.timeframe || 1));
    return t.getTime();
  };
  const expiredGoals = goals.filter((g) => {
    if (g.completedAt) return false;
    const d = goalDeadline(g);
    return d !== null && d < Date.now();
  });

  const completeGoal = (id: string) =>
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, completedAt: Date.now() } : g)));

  // Extend by one unit of the goal's horizon (1 mo for short, 1 yr for long).
  const extendGoal = (id: string) =>
    setGoals((prev) => prev.map((g) =>
      g.id === id ? { ...g, timeframe: (g.timeframe || 1) + 1 } : g
    ));

  // Same cascade as Align's deleteGoal: goal + sub-goals + their habits.
  const deleteGoalCascade = (id: string) => {
    const remove = new Set<string>([id]);
    goals.forEach((g) => {
      if (g.parentGoalId && remove.has(g.parentGoalId)) remove.add(g.id);
    });
    const removedGoals = goals
      .map((g, i) => ({ g, i }))
      .filter(({ g }) => remove.has(g.id));
    const removedHabits = habits.filter((h) => remove.has(h.goalId));
    setGoals((prev) => prev.filter((g) => !remove.has(g.id)));
    setHabits((ph) => ph.filter((h) => !remove.has(h.goalId)));
    onDeleteGoalFromDb([...remove]);
    flash('Deleted', false, {
      label: 'Undo',
      run: () => {
        setGoals((prev) => {
          const next = [...prev];
          removedGoals.forEach(({ g, i }) => next.splice(Math.min(i, next.length), 0, g));
          return next;
        });
        setHabits((prev) => [...prev, ...removedHabits]);
      },
    });
  };

  // Mirrors Align's addAction — used by the "Break down" flow to add smaller
  // tasks/habits onto the same goal as the stale task.
  const addAction = (goalId: string, title: string, kind: ActionKind, input: ActionInput) => {
    setHabits((prev) => [...prev, {
      id: uid('h'),
      goalId,
      title,
      kind,
      doneToday: false,
      completions: [],
      ...(kind === 'habit'
        ? {
            startDate: input.startDate || toDateStr(new Date()),
            recurrence: input.recurrence ?? 'daily',
            customInterval: input.customInterval ?? 1,
            customUnit: input.customUnit ?? 'weeks',
            specificDays: input.specificDays ?? undefined,
          }
        : {
            dueDate: input.dueDate || undefined,
            dueTime: input.dueTime || undefined,
          }),
    }]);
  };


  // --- The Today list: your chosen focus tasks (☀) up top, then overdue /
  // due-today needing action, then the day's habits.
  // Overdue tasks you've already flagged for focus live in the focus section,
  // not here (no double-listing).
  const overdueSorted = [...overdueTasks]
    .filter((t) => !focusTaskIds.has(t.id))
    .sort((a, b) => daysOverdueOf(b) - daysOverdueOf(a));
  const dueTodayNotFocused = dueTodayTasks.filter((t) => !focusTaskIds.has(t.id));

  // "Needs action" holds both overdue and due-today. Cap overdue (worst first)
  // at 3 so a big backlog doesn't overwhelm the card, but always surface every
  // due-today task — otherwise a full overdue list would push today's own
  // deadlines out of sight. Overdue overflow stays reachable under More.
  const TASK_CAP = 3;
  const pinnedOverdue = overdueSorted.slice(0, TASK_CAP);
  const pinnedDueToday = dueTodayNotFocused;
  const pinnedTasks = [...pinnedOverdue, ...pinnedDueToday];

  // Heuristic urgency for habits.
  const focusGoalIds = (() => {
    const ids = new Set<string>();
    (['long', 'short', 'ongoing'] as const).forEach((horizon) => {
      const seen = new Set<string>();
      goals.forEach((g) => {
        if (g.horizon === horizon && !g.parentGoalId && !seen.has(g.domainId)) {
          seen.add(g.domainId);
          ids.add(g.id);
        }
      });
    });
    return ids;
  })();
  const topAncestorId = (goalId: string): string | undefined => {
    let g = goals.find((x) => x.id === goalId);
    while (g?.parentGoalId) g = goals.find((x) => x.id === g!.parentGoalId);
    return g?.id;
  };
  const habitUrgency = (h: Habit): number => {
    let s = 0;
    s += getGraceDays(h).length * 30;            // missed backlog
    if (isNeglected(h)) s += 25;                  // neglected
    const since = daysSinceLastDone(h);
    const interval = naturalIntervalDays(h);
    s += since === Infinity ? 10 : Math.min(15, (since / interval) * 5);
    const top = topAncestorId(h.goalId);
    if (top && focusGoalIds.has(top)) s += 20;    // high-focus goal thread
    const gh = goalHealthMap[h.goalId];
    if (gh && gh.health <= 33) s += 15;           // rescue weak goals
    return s;
  };
  // ALL of today's open habits — the complete daily rhythm, urgency-sorted.
  const habitsToday = [...openHabits].sort((a, b) => habitUrgency(b) - habitUrgency(a));

  // Everything not shown in Today (future tasks + capped overflow), by domain.
  const shownToday = new Set<string>([
    ...focusTasks, ...pinnedTasks, ...openHabits,
  ].map((h) => h.id));
  const moreByDomain = domains
    .map((d) => ({
      domain: d,
      items: todayItemsByDomain(d.id).filter((h) => !shownToday.has(h.id)),
    }))
    .filter((x) => x.items.length > 0);
  const moreCount = moreByDomain.reduce((s, x) => s + x.items.length, 0);

  // Day ring: today's workload split by domain — completion AND balance in
  // one glance. Same item set as the progress counter, so they always agree.
  const ringSegments = domains.map((d) => {
    const inDomain = (h: Habit) => domainOf(h.goalId) === d.id;
    const total =
      scheduledHabits.filter(inDomain).length +
      overdueTasks.filter(inDomain).length +
      dueTodayTasks.filter(inDomain).length +
      completedToday.filter(inDomain).length;
    const doneN = doneHabits.filter(inDomain).length + completedToday.filter(inDomain).length;
    return { color: DOMAIN_COLORS[d.id] ?? 'var(--accent)', label: d.name.split(' ')[0] ?? d.name, done: doneN, total };
  });

  useEffect(() => {
    fetchCoachCard();
  }, [!goals.length && !habits.length]); // re-runs once data arrives; stable after that

  const renderRow = (h: Habit) => {
    const isDone = h.kind === 'task' ? !!h.completed : isHabitDoneThisPeriod(h);
    const dColor = DOMAIN_COLORS[domainOf(h.goalId) ?? ''] ?? 'var(--line)';
    const gh = goalHealthMap[h.goalId];
    return (
      <div
        className="habit-row domain-edged"
        key={h.id}
        style={{ '--row-domain': dColor } as React.CSSProperties}
      >
        <button
          className={`check${isDone ? ' on' : ''}`}
          onClick={() => toggle(h.id)}
          aria-label="toggle"
        >
          <Tick />
        </button>
        <div style={{ flex: 1 }}>
          <div className={`habit-title${isDone ? ' done' : ''}`}>
            <span
              className={`kind-icon ${h.kind}`}
              title={h.kind === 'task' ? 'One-off task' : 'Repeatable habit'}
            >
              {h.kind === 'task' ? <TaskArrow /> : <RepeatIcon />}
            </span>
            {h.title}
          </div>
          <div className="habit-meta">
            <b>{lineage(h.goalId)}</b>
            {gh && (
              <span className={`row-goal-health ${gh.health <= 33 ? 'r' : gh.health <= 66 ? 'y' : 'g'}`}>
                ♥ {gh.health}
              </span>
            )}
            &nbsp;·&nbsp;
            {h.kind === 'task' ? getTaskCountdown(h) : getRecurrenceString(h)}
          </div>
          {(() => {
            if (h.kind === 'task') {
              if (!isDone && h.dueDate && h.dueDate < today) {
                const fd = new Date(h.dueDate + 'T12:00');
                const DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
                const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                const label = `${DAY[fd.getDay()]}, ${MON[fd.getMonth()]} ${fd.getDate()}`;
                return <span className="streak-frozen"><CalIcon /> {label}</span>;
              }
              return null;
            }
            const graceDays = !isDone ? getGraceDays(h) : [];
            const frozenDate = graceDays[0] ?? null;
            if (!frozenDate) return null;
            const fd = new Date(frozenDate + 'T12:00');
            const DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
            const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const graceLabel = `${DAY[fd.getDay()]}, ${MON[fd.getMonth()]} ${fd.getDate()}`;
            return (
              <button
                className="streak-frozen streak-frozen-reset"
                title="Skip this day — clears it without marking complete"
                onClick={(e) => {
                  e.stopPropagation();
                  setHabits((prev) => prev.map((x) =>
                    x.id !== h.id ? x : { ...x, startDate: dayAfter(frozenDate) }
                  ));
                }}
              >
                <CalIcon /> {graceLabel} ↺
              </button>
            );
          })()}
        </div>
        {h.kind === 'task' && !isDone && (
          <button
            className={`row-sun${h.focusDate === today ? ' on' : ''}`}
            title={h.focusDate === today ? "Remove from today's focus" : "Focus on this today"}
            onClick={(e) => { e.stopPropagation(); toggleTaskFocus(h.id); }}
            aria-label="Toggle today focus"
          >
            <SunIcon />
          </button>
        )}
      </div>
    );
  };

  const hasAnythingToday = openHabits.length > 0 || openTasks.length > 0;

  return (
    <div className="screen">
      {pendingDeleteGoalId && (() => {
        const warn = goalDeleteWarning(pendingDeleteGoalId, goals, habits);
        return (
          <ConfirmDialog
            title={warn.title}
            body={warn.body}
            confirmLabel="Delete"
            onConfirm={() => { deleteGoalCascade(pendingDeleteGoalId); setPendingDeleteGoalId(null); }}
            onCancel={() => setPendingDeleteGoalId(null)}
          />
        );
      })()}
      <div className="eyebrow">Today</div>
      <h1>Small, aligned acts</h1>
      <p className="lede">
        Not a to-do list. Just the habits and tasks that move your values
        forward.
      </p>

      {/* Coach card — progress counter + daily coaching blurb */}
      <div className="today-section coach-card">
        <div className="coach-card-header">
          <span className="coach-card-label">
            ✦ Coach
            {coachLoading && <span className="focus-loading">thinking…</span>}
          </span>
          <button className="reflect-mini-btn" onClick={onReflect} title="Weekly reflection">✦ Reflect</button>
        </div>
        <div className="coach-progress coach-progress--ring">
          <DayRing segments={ringSegments} pct={pct} />
          <div className="ring-side">
            <div className="coach-progress-num">
              <span className="coach-progress-done">{done}</span>
              <span className="coach-progress-total"> / {totalCount} today</span>
            </div>
            {coachFailed && !coachLoading && (
              <button className="coach-retry-btn" onClick={fetchCoachCard}>
                Retry coach ↺
              </button>
            )}
            {coachCard && (
              <>
                <div className="coach-blurb">{coachCard.blurb}</div>
                <div className="coach-feedback">
                  <button
                    className={`coach-feedback-btn up${coachRating === 'up' ? ' active' : ''}`}
                    onClick={() => {
                      if (coachRating === 'up') return;
                      setCoachRating('up');
                      saveCoachFeedback(today, coachCard.title, 'up', userId);
                    }}
                    aria-label="Helpful"
                  >👍</button>
                  <button
                    className={`coach-feedback-btn down${coachRating === 'down' ? ' active' : ''}`}
                    onClick={() => {
                      if (coachRating === 'down') return;
                      setCoachRating('down');
                      saveCoachFeedback(today, coachCard.title, 'down', userId);
                    }}
                    aria-label="Not helpful"
                  >👎</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ☀ Today's focus — the tasks you flagged in the Align tab. */}
      {focusTasks.length > 0 && (
        <div className="today-section focus focus-card">
          <div className="today-section-head focus-head-row">
            <span>☀ Today's focus</span>
          </div>
          {focusTasks.map((t) => renderRow(t))}
        </div>
      )}

      {/* Needs action — expired goals & overdue (actions inline), due today */}
      {(expiredGoals.length > 0 || pinnedTasks.length > 0) && (
        <div className="today-section focus">
          <div className="today-section-head triage-head">⚑ Needs action</div>
          {(expiredGoals.length > 0 || pinnedOverdue.length > 0) && (
            <div className="today-subhead red">Overdue</div>
          )}
          {expiredGoals.map((g) => {
            const deadline = goalDeadline(g)!;
            const daysOver = Math.max(1, Math.floor((Date.now() - deadline) / 86_400_000));
            return (
              <div className="habit-row triage-row" key={g.id}>
                <button
                  className="check"
                  onClick={() => completeGoal(g.id)}
                  aria-label="Mark goal complete"
                  title="Done — mark the goal complete"
                >
                  <Tick />
                </button>
                <div style={{ flex: 1 }}>
                  <div className="habit-title">{g.title}</div>
                  <div className="habit-meta">
                    <b>Goal · {g.horizon === 'long' ? `${g.timeframe} yr` : g.timeframe === 12 ? '1 yr' : `${g.timeframe} mo`}</b>
                    &nbsp;·&nbsp;
                    <span className="triage-overdue">
                      window ended {daysOver} day{daysOver === 1 ? '' : 's'} ago
                    </span>
                  </div>
                  <div className="triage-actions">
                    <button className="mini-ghost" onClick={() => extendGoal(g.id)}>
                      Extend +{g.horizon === 'long' ? '1 yr' : '1 mo'}
                    </button>
                    <button className="mini-ghost triage-delete" onClick={() => setPendingDeleteGoalId(g.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {pinnedOverdue.map((task) => {
            const days = daysOverdueOf(task);
            return (
              <React.Fragment key={task.id}>
                <div className="habit-row triage-row">
                  <button
                    className="check"
                    onClick={() => toggle(task.id)}
                    aria-label="Mark complete"
                    title="Done — mark complete"
                  >
                    <Tick />
                  </button>
                  <div style={{ flex: 1 }}>
                    <div className="habit-title">
                      <span className="kind-icon task" title="One-off task"><TaskArrow /></span>
                      {task.title}
                    </div>
                    <div className="habit-meta">
                      <b>{lineage(task.goalId)}</b>
                      &nbsp;·&nbsp;
                      <span className="triage-overdue">
                        {days} day{days === 1 ? '' : 's'} overdue
                      </span>
                    </div>
                    <div className="triage-actions">
                      <DateBtn
                        compact
                        value={task.dueDate ?? ''}
                        onChange={(v) => rescheduleTask(task.id, v)}
                        placeholder="Reschedule"
                      />
                      <button
                        className="mini-ghost"
                        onClick={() => setBreakdownFor(breakdownFor === task.id ? null : task.id)}
                      >
                        {breakdownFor === task.id ? 'Cancel' : 'Break down'}
                      </button>
                      <button className="mini-ghost triage-delete" onClick={() => deleteTask(task.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
                {breakdownFor === task.id && (
                  <AddActionForm
                    goalId={task.goalId}
                    defaultKind="task"
                    onAdd={(goalId, title, kind, input) => { addAction(goalId, title, kind, input); setBreakdownFor(null); }}
                    onClose={() => setBreakdownFor(null)}
                  />
                )}
              </React.Fragment>
            );
          })}
          {pinnedDueToday.length > 0 && (
            <div className="today-subhead red">Due today</div>
          )}
          {pinnedDueToday.map((t) => renderRow(t))}
        </div>
      )}

      {/* Habits today — the complete daily rhythm, its own card */}
      {habitsToday.length > 0 && (
        <div className="today-section focus">
          <div className="today-section-head">Habits today</div>
          {habitsToday.map((h) => renderRow(h))}
        </div>
      )}

      {/* Everything else — one collapsed section, state persists */}
      {moreCount > 0 && (
        <div className="today-section">
          <button className="today-done-toggle" onClick={() => setMoreOpen((v) => !v)}>
            <Chevron up={moreOpen} />
            More
            <span className="today-count">{moreCount}</span>
          </button>
          {moreOpen && moreByDomain.map(({ domain: d, items }) => (
            <div key={d.id} className="more-domain-group">
              <div className="focus-domain-head" style={{ color: DOMAIN_COLORS[d.id] ?? 'var(--accent)' }}>
                <span>{d.name}</span>
              </div>
              {items.map((h) => renderRow(h))}
            </div>
          ))}
        </div>
      )}

      {!hasAnythingToday && doneItems.length === 0 && (
        <div className="today-allclear">Nothing on the list today.</div>
      )}
      {!hasAnythingToday && doneItems.length > 0 && (
        <div className="today-allclear">✦ All done for today. Nice.</div>
      )}

      {/* Done — collapsed by default */}
      {doneItems.length > 0 && (
        <div className="today-section done">
          <button
            className="today-done-toggle"
            onClick={() => setShowDone((v) => !v)}
          >
            <Chevron up={showDone} />
            Done today
            <span className="today-count">{doneItems.length}</span>
          </button>
          {showDone && doneItems.map((h) => renderRow(h))}
        </div>
      )}

      {(() => {
        const now = new Date();
        const day = now.getDay(); // 0=Sun, 1=Mon … 6=Sat
        const week = getISOWeek(now);
        const year = now.getFullYear();
        // Mon–Wed: the "pending" reflection is from the ISO week that just ended Sunday
        const inGrace = day >= 1 && day <= 3;
        const checkWeek = inGrace ? (week > 1 ? week - 1 : 52) : week;
        const checkYear = (inGrace && week === 1) ? year - 1 : year;
        const thisWeekDone = reflections.some(
          (r) => r.weekNumber === checkWeek && new Date(r.date).getFullYear() === checkYear
        );
        const inWindow = day === 0 || inGrace;
        if (thisWeekDone || !inWindow) return null;
        const label = day === 0
          ? "It's Sunday — take two minutes to reflect on the week →"
          : "Weekly reflection pending — fill it in before it slips away →";
        return (
          <button className="reflect-prompt" onClick={onReflect}>{label}</button>
        );
      })()}
    </div>
  );
}

/* ---------------- Reflect ---------------- */
function Reflect({
  domains,
  onClose,
  onSave,
}: {
  domains: Domain[];
  onClose: () => void;
  onSave: (scores: Record<string, number>, note: string, weekNumber: number, date: number) => void;
}) {
  const [scores, setScores] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [step, setStep] = useState<'score' | 'insight'>('score');

  const rows = domains.flatMap((d) =>
    d.values.map((v) => ({ d, v, key: `${d.id}:${v}` })),
  );

  const labelFor = (key: string) => {
    const [did, vi] = key.split(':');
    return domains.find((d) => d.id === did)?.values[Number(vi)] ?? key;
  };

  const handleSave = () => {
    const now = new Date();
    const day = now.getDay();          // 0=Sun, 1=Mon … 6=Sat
    const week = getISOWeek(now);
    // Tag the same week the Today-tab prompt looks for, so the entry is
    // recognised as "this week's" (and the nag disappears): on Sunday this is
    // the week ending today; during the Mon–Wed grace window it's the week
    // that ended last Sunday. Date is "now" so the log shows when you actually
    // reflected and the recency decay treats it as fresh.
    const inGrace = day >= 1 && day <= 3;
    const weekNumber = inGrace ? (week > 1 ? week - 1 : 52) : week;
    onSave(scores, note, weekNumber, now.getTime());
    setStep('insight');
  };

  // Insight computations
  const scoreEntries = Object.entries(scores);
  const bestEntry = scoreEntries.length
    ? [...scoreEntries].sort((a, b) => b[1] - a[1])[0]
    : null;
  const worstEntry = scoreEntries.length
    ? [...scoreEntries].sort((a, b) => a[1] - b[1])[0]
    : null;

  if (step === 'insight') {
    return (
      <div className="scrim" role="dialog" aria-modal="true" onClick={onClose}>
        <div className="sheet" onClick={(e) => e.stopPropagation()}>
          <h2>This week</h2>
          {bestEntry && (
            <div className="insight-card best">
              <span className="insight-label">Most aligned with</span>
              <span className="insight-value">{labelFor(bestEntry[0])}</span>
            </div>
          )}
          {worstEntry && worstEntry[1] < 2 && (
            <div className="insight-card drift">
              <span className="insight-label">Drifted from</span>
              <span className="insight-value">{labelFor(worstEntry[0])}</span>
            </div>
          )}
          {scoreEntries.length === 0 && (
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>
              No values were scored — nothing to summarise.
            </p>
          )}
          <button className="primary" style={{ marginTop: 20 }} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="scrim" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Last week</h2>
        <p>How well did your week reflect each value?</p>
        <div className="reflect-list">
          {rows.map(({ d, v, key }) => (
            <div key={key} className="reflect-value-row">
              <div className="reflect-value-label">
                <span className="domain">{d.name.split(' ')[0]}</span>
                <span className="value">{v}</span>
              </div>
              <div className="scale">
                {['Drifted', 'Some', 'Mostly', 'Aligned'].map((label, idx) => (
                  <button
                    key={label}
                    className={scores[key] === idx ? 'sel' : ''}
                    onClick={() =>
                      setScores((s) => ({ ...s, [key]: idx }))
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <textarea
          rows={3}
          placeholder="One thing to carry into next week…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button className="primary" onClick={handleSave}>
          Save reflection
        </button>
        <button className="ghost" onClick={onClose}>
          Not now
        </button>
      </div>
    </div>
  );
}

/* ---------------- ReviewPanel ---------------- */

// Blended 0–10 score: 50% from reflection history, 50% from goal/habit completion
function valueAlignmentScore(
  key: string,
  goals: Goal[],
  habits: Habit[],
  reflections: ReflectionEntry[],
  domains: Domain[],
): number {
  const colonIdx = key.indexOf(':');
  const domainId = key.slice(0, colonIdx);
  const valueName = key.slice(colonIdx + 1);
  const dom = domains.find((d) => d.id === domainId);
  const vi = dom ? dom.values.indexOf(valueName) : -1;

  // Goals directly tagged with this value
  const tagged = goals.filter(
    (g) => g.domainId === domainId && vi >= 0 && g.valueIndexes.includes(vi),
  );
  // Sub-goals inherit the value from ANY tagged parent (long, short, ongoing)
  const taggedParentIds = new Set(tagged.map((g) => g.id));
  const inherited = goals.filter(
    (g) => g.parentGoalId && taggedParentIds.has(g.parentGoalId)
      && !tagged.some((t) => t.id === g.id),
  );
  const allTagged = [...tagged, ...inherited];

  // Activity score (0–1): average EARNED health across tagged goals (graced=
  // false so creating an empty goal can't inflate alignment). Goal health
  // already folds in habit consistency, so habits are not counted a second
  // time here.
  let actSum = 0, actCount = 0;
  for (const g of allTagged) {
    const h = g.horizon === 'long'
      ? vitalityFor(g, goals, habits, 0, false).health
      : g.horizon === 'ongoing'
        ? ongoingGoalMetrics(g, goals, habits, 0, false).health
        : stGoalMetrics(g, goals, habits, 0, false).health;
    actSum += h; actCount++;
  }
  const activityComponent = actCount > 0 ? actSum / actCount : null;

  // Reflection component (0–1)
  const hasRefl = reflections.some((r) => r.scores[key] !== undefined);
  const reflComponent = hasRefl ? decayedAvg(key, reflections) / 3 : null;

  // Blend
  let score: number;
  if (reflComponent !== null && activityComponent !== null) {
    score = 0.5 * reflComponent + 0.5 * activityComponent;
  } else if (reflComponent !== null) {
    score = reflComponent;
  } else if (activityComponent !== null) {
    score = activityComponent;
  } else {
    score = 0;
  }
  return score * 10; // 0–10
}

/* ---------------- GoalsDashboard ---------------- */

/** Streak-weighted importance of a habit in health/consistency math (1–4×). */
function habitStreakWeight(h: Habit): number {
  return Math.min(1 + (h.streak || 0) * 0.2, 4.0);
}

/* ---- Item maturity: adding structure must never LOWER health -------------
 * A brand-new task/habit/sub-goal is neutral — excluded from the pace and
 * consistency math — until it's had a genuine chance to be acted on. Only then
 * does leaving it undone count against you. Completed items always count. This
 * is what makes "adding a goal/task/habit" safe: it can raise health (via
 * engagement) but never drop it just for existing. */

const SUBGOAL_GRACE_DAYS = 7;

/** A habit counts once it has any completion, or once one full recurrence
 * interval has elapsed since it started (its first real chance to be done). */
function habitCountsYet(h: Habit, now: number): boolean {
  if ((h.completions ?? []).length > 0) return true;
  const startMs = h.startDate ? new Date(h.startDate + 'T12:00').getTime() : now;
  return (now - startMs) / 86_400_000 >= naturalIntervalDays(h);
}

/** A sub-goal is neutral to its parent for a short grace after creation, so
 * adding a milestone never dings the parent; after that an ignored one counts. */
function subGoalCountsYet(g: Goal, now: number): boolean {
  if (g.completedAt) return true;
  return (now - (g.createdAt || 0)) / 86_400_000 >= SUBGOAL_GRACE_DAYS;
}

/** An incomplete task weighs on pace only once it's actually overdue —
 * upcoming or undated work is "not due yet", so adding it can't lower health. */
function taskCountsInPace(t: Habit, now: number): boolean {
  if (t.completed) return true;
  if (!t.dueDate) return false;
  return new Date(t.dueDate + 'T23:59:59').getTime() < now;
}

/**
 * 28-day habit-consistency fidelity, shared by deadline (computeHealth) and
 * ongoing (computeOngoingHealth) goals so a fix to one always applies to both.
 * Age-aware: a habit younger than the 28-day window is graded against how
 * many completions it could realistically have had so far, not the full
 * window — otherwise a brand-new habit done every day since it started reads
 * as barely consistent purely for lacking history.
 */
function computeHabitConsistency(habits: Habit[], now: number): number {
  const WINDOW = 28;
  const lookback = toDateStr(new Date(now - WINDOW * 86_400_000));
  let totalW = 0, scoreW = 0;
  habits.forEach((h) => {
    if (!habitCountsYet(h, now)) return; // brand-new habit: neutral, not a miss
    const comps = h.completions ?? [];
    const startMs = h.startDate
      ? new Date(h.startDate + 'T12:00').getTime()
      : comps.length
        ? Math.min(...comps.map((d) => new Date(d + 'T12:00').getTime()))
        : now; // no history yet → treat as fresh, not 28 days of misses
    const ageDays  = Math.min(WINDOW, Math.max(1, (now - startMs) / 86_400_000));
    // Explicitly-skipped days (red pill) are counted as misses: the start date
    // was advanced past them so they're out of the age window, so add them back
    // as expected-but-not-done occurrences. Skipping ≠ forgiveness.
    const skipMisses = (h.skippedDates ?? []).filter((d) => d >= lookback).length;
    const expected = Math.max(1, ageDays / naturalIntervalDays(h)) + skipMisses;
    const actual   = comps.filter((d) => d >= lookback).length;
    const w = habitStreakWeight(h);
    scoreW += Math.min(actual / expected, 1) * w;
    totalW += w;
  });
  return totalW > 0 ? scoreW / totalW : 0;
}

/**
 * Activity-based health — "are you actually WORKING this goal?", never a
 * done/total burn-down (tasks get added throughout, so a completed-vs-created
 * ratio would punish planning and is deliberately NOT a factor). It blends,
 * over only the dimensions a goal actually uses (so a habit-only or task-only
 * goal can still earn a full 100 by doing its thing well):
 *   - structure:    is it filled out? having real items is itself healthy;
 *   - consistency:  habits kept on cadence (misses & skips count);
 *   - throughput:   are tasks / sub-goals being COMPLETED lately (a rate, not
 *                   a fraction of the backlog);
 *   - recency:      is it being touched at all, decaying if ignored.
 * Overdue dated tasks then scale the whole score down — a missed deadline is
 * the clearest "not on top of it" signal, so it always bites.
 */
function computeHealth(
  subGoals: Goal[],
  treeHabits: Habit[],
  now: number,
  /** 0–1: how strongly priority position scales the focus adjustment. #1 in
   * its domain = 1, tapering to 0 by ~position 4 (see focusStrengthByDomain). */
  focusStrength = 0,
): number {
  const windowMs = 28 * 86_400_000;
  const tasks    = treeHabits.filter((h) => h.kind === 'task');
  const habits   = treeHabits.filter((h) => h.kind === 'habit');
  const eligibleHabits = habits.filter((h) => habitCountsYet(h, now));

  // Filled out: creating sub-goals, tasks, or habits is itself healthy.
  const itemCount = subGoals.length + tasks.length + habits.length;
  const structure = Math.min(itemCount / 3, 1);

  // Habits kept on cadence (brand-new ones are neutral; skips count as misses).
  const consistency = computeHabitConsistency(eligibleHabits, now);

  // Throughput: recent COMPLETIONS, not a ratio of the ever-growing backlog.
  // A finished sub-goal is worth more than a single task.
  const recentTaskDone = tasks.filter((t) => t.completed && t.completedAt && now - t.completedAt <= windowMs).length;
  const recentSubDone  = subGoals.filter((g) => g.completedAt && now - g.completedAt <= windowMs).length;
  const throughput = Math.min((recentTaskDone + recentSubDone * 2) / 3, 1);

  // Recency: any completion keeps it alive; decays to 0 over ~45 idle days.
  const touchTimes: number[] = [
    ...habits.flatMap((h) => (h.completions ?? []).map((d) => new Date(d + 'T12:00').getTime())),
    ...tasks.filter((t) => t.completed && t.completedAt).map((t) => t.completedAt!),
    ...subGoals.filter((g) => g.completedAt).map((g) => g.completedAt!),
  ].filter((t) => Number.isFinite(t));
  const lastTouch = touchTimes.length ? Math.max(...touchTimes) : 0;
  const recency = lastTouch ? Math.max(0, 1 - (now - lastTouch) / (45 * 86_400_000)) : 0;

  // Weighted blend over only the dimensions in play — full marks on the
  // dimensions a goal uses ⇒ 100, so every kind of goal can earn the top.
  const dims: Array<[number, number, boolean]> = [
    [0.35, consistency, eligibleHabits.length > 0],
    [0.30, throughput,  tasks.length > 0 || subGoals.length > 0],
    [0.20, structure,   itemCount > 0],
    [0.15, recency,     itemCount > 0],
  ];
  let wsum = 0, wtot = 0;
  dims.forEach(([wt, sc, active]) => { if (active) { wsum += wt * sc; wtot += wt; } });
  let base = wtot > 0 ? wsum / wtot : 0;

  // Deadlines: overdue dated tasks scale health down (each up to full weight
  // once ~2 weeks late), floored so one slip can't zero a well-worked goal.
  const overdue = tasks.filter((t) => !t.completed && t.dueDate && new Date(t.dueDate + 'T23:59:59').getTime() < now);
  if (overdue.length > 0) {
    const severity = overdue.reduce((s, t) => {
      const daysLate = (now - new Date(t.dueDate + 'T23:59:59').getTime()) / 86_400_000;
      return s + Math.min(daysLate / 14, 1);
    }, 0);
    base *= Math.max(0.3, 1 - severity * 0.25);
  }

  // Priority-position focus taper: ±10% at full strength, neutral at 0.5.
  const focusAdj = (base - 0.5) * 0.2 * focusStrength;
  return Math.max(0, Math.min(base + focusAdj, 1));
}

/**
 * Ongoing (no-deadline) goals measure UPKEEP, not progress toward a finish.
 * Health is the best current maintenance signal, blended with light structure:
 *   - recurring habit completions: cadence fidelity over the last 28 days;
 *   - recent task throughput: recent completed tasks visibly move the badge;
 *   - active task focus: open, not-overdue tasks keep the goal visibly alive;
 *   - recent touch: completed tasks/subgoals or habit completions decay over time.
 * This avoids showing a nonsense zero when an ongoing role has a live task but
 * no recent checkbox yet.
 */
function computeOngoingHealth(subGoals: Goal[], treeHabits: Habit[], focusStrength = 0): number {
  const habits = treeHabits.filter((h) => h.kind === 'habit');
  const tasks  = treeHabits.filter((h) => h.kind === 'task');
  const itemCount = subGoals.length + tasks.length + habits.length;
  if (itemCount === 0) return 0;

  const engagement = Math.min(itemCount / 5, 1.0);
  const now = Date.now();
  const WINDOW = 28;

  // Age-aware, streak-weighted cadence fidelity — same helper deadline goals
  // use, so a habit-consistency fix always applies to both goal types.
  const consistency = computeHabitConsistency(habits, now);

  const openTasks = tasks.filter((t) => !t.completed);
  const taskFocus = openTasks.length === 0 ? 0 : Math.max(...openTasks.map((t) => {
    if (!t.dueDate) return 0.65;
    const daysUntilDue = Math.ceil((new Date(t.dueDate + 'T12:00').getTime() - now) / 86_400_000);
    if (daysUntilDue >= 0) return daysUntilDue <= 7 ? 0.85 : 0.7;
    // Overdue ongoing tasks decay gently instead of instantly poisoning the role.
    return Math.max(0.2, 0.6 - Math.min(Math.abs(daysUntilDue), 28) / 28 * 0.4);
  }));

  const recentCompletedTasks = tasks.filter((t) => {
    if (!t.completed || !t.completedAt) return false;
    return now - t.completedAt <= WINDOW * 86_400_000;
  });
  // Ongoing tasks are throughput, not a finite checklist. Count recent
  // completions over a wider band so repeated checkoffs keep moving the badge.
  const taskCompletion = Math.min(1, recentCompletedTasks.length / 6);
  // Adding a task should register as structure, not disappear behind a max()
  // focus signal. This caps gently so a huge task pile cannot peg health alone.
  const taskStructure = Math.min(1, tasks.length / 10);

  const touchTimes: number[] = [
    ...habits.flatMap((h) => (h.completions ?? []).map((d) => new Date(d + 'T12:00').getTime())),
    ...tasks.filter((t) => t.completed && t.completedAt).map((t) => t.completedAt!),
    ...subGoals.filter((g) => g.completedAt).map((g) => g.completedAt!),
  ].filter((t) => Number.isFinite(t));
  const lastTouch = touchTimes.length ? Math.max(...touchTimes) : 0;
  const daysSinceTouch = lastTouch ? Math.max(0, (now - lastTouch) / 86_400_000) : Infinity;
  // Starts high for a recent touch and decays over ~60 days to a small floor.
  const recentTouch = lastTouch ? Math.max(0.1, 1 - daysSinceTouch / 60) : 0;

  // Weighted blend — habit consistency is the true maintenance signal and
  // carries the most weight, so reaching the top requires the recurring work
  // to actually be happening. A recent touch or a live task keep the goal off
  // the floor but can't alone peg it to 100.
  const base = Math.min(1,
    0.55 * consistency +
    0.40 * taskCompletion +
    0.22 * recentTouch +
    0.10 * taskStructure +
    0.05 * taskFocus +
    0.05 * engagement);

  // Same ±10% focus adjustment as deadline goals, scaled by priority
  // position (focusStrength) rather than a binary "is #1" flag.
  const focusAdj = (base - 0.5) * 0.2 * focusStrength;
  const scored = Math.max(0, Math.min(base + focusAdj, 1.0));
  return base > 0 ? Math.max(0.02, scored) : 0;
}

export const __test_computeOngoingHealth = computeOngoingHealth;
export const __test_computeHealth = computeHealth;
export const __test_toggleHabitCompletion = toggleHabitCompletion;

/**
 * Done = weighted count ratio across sub-goals, habits, and tasks.
 * Sub-goals: weight 5 each — a completed one (completedAt set) counts in
 *   full, an in-progress one credits its own done-ratio.
 * Habits: done at least once in the last 28 days — weighted by streak (1–4×).
 * Tasks: completed (h.completed true) — weight 1 each.
 */
function computeDone(subGoals: Goal[], treeHabits: Habit[], allHabits: Habit[], now: number): number {
  const SUB_W = 5;
  const lookbackDate = toDateStr(new Date(now - 28 * 86_400_000));
  // Same maturity gate as pace: brand-new items are neutral, so adding one
  // never drops the completion ratio (which also feeds a parent goal's pace).
  const tasks  = treeHabits.filter((h) => h.kind === 'task' && taskCountsInPace(h, now));
  const habits = treeHabits.filter((h) => h.kind === 'habit' && habitCountsYet(h, now));
  const subs   = subGoals.filter((g) => subGoalCountsYet(g, now));
  const total  = subs.length * SUB_W + tasks.length + habits.reduce((s, h) => s + habitStreakWeight(h), 0);
  if (total === 0) return 0;
  const done =
    subs.reduce((s, g) =>
      s + (g.completedAt ? 1 : computeDone([], allHabits.filter((h) => h.goalId === g.id), allHabits, now)), 0) * SUB_W +
    tasks.filter((h) => !!h.completed).length +
    habits.filter((h) => (h.completions ?? []).some((d) => d >= lookbackDate)).reduce((s, h) => s + habitStreakWeight(h), 0);
  return done / total;
}

/**
 * New-goal grace: health starts at 50% (neutral yellow — not failing, not
 * thriving) and glides down to the EARNED score over the first 14 days, so a
 * brand-new goal isn't born red. Build the goal out and work it and earned
 * health takes over as soon as it beats the grace floor; ignore it and the
 * number bleeds toward the honest score.
 * Mirrored server-side in the goal_health view so the coach agrees.
 */
function applyNewGoalGrace(earned: number, createdAt: number): number {
  const GRACE_DAYS = 14;
  const START = 0.5;
  if (earned >= START) return earned; // real progress always wins
  const ageDays = (Date.now() - (createdAt || 0)) / 86_400_000;
  if (ageDays < 0 || ageDays >= GRACE_DAYS) return earned;
  const grace = 1 - ageDays / GRACE_DAYS;
  return earned + (START - earned) * grace;
}

function vitalityFor(
  lg: Goal,
  goals: Goal[],
  habits: Habit[],
  focusStrength = 0,
  graced = true, // pass false for signals (e.g. value alignment) that must not be inflated by the new-goal grace
): { time: number; completion: number; health: number } {
  const now     = Date.now();
  const totalMs = (lg.timeframe || 1) * 365.25 * 86_400_000;
  const elapsed = Math.min(1, Math.max(0, (now - lg.createdAt) / totalMs));

  const subGoals      = goals.filter((g) => g.parentGoalId === lg.id);
  const subtree       = new Set<string>([lg.id, ...subGoals.map((g) => g.id)]);
  const subtreeHabits = habits.filter((h) => subtree.has(h.goalId));

  const completion = computeDone(subGoals, subtreeHabits, habits, now);
  const earned     = computeHealth(subGoals, subtreeHabits, now, focusStrength);
  const health     = graced ? applyNewGoalGrace(earned, lg.createdAt) : earned;
  return { time: elapsed, completion, health };
}

const DOMAIN_COLORS: Record<string, string> = {
  career: '#e8883c',      // orange
  self: '#4eb8e8',        // sky blue
  community: '#72ce6a',   // green
};

const THREAD_PALETTE = [
  '#e8883c', '#4eb8e8', '#72ce6a', '#c8a96a',
  '#a78be8', '#e87a8b', '#4ed8c8', '#e8d44e',
];

/**
 * Segmented progress ring for the Today header: each life area gets an arc
 * proportional to its share of today's workload (balance), filled by how much
 * of it is done (completion). Uses the same item set as the progress counter.
 */
function DayRing({
  segments,
  pct,
}: {
  segments: Array<{ color: string; label: string; done: number; total: number }>;
  pct: number;
}) {
  const SIZE = 96, R = 40, CX = 48, CY = 48;
  const C = 2 * Math.PI * R;
  const live = segments.filter((s) => s.total > 0);
  const totalItems = live.reduce((s, x) => s + x.total, 0);
  const GAP = live.length > 1 ? 5 : 0;
  const avail = C - GAP * live.length;
  let acc = 0;
  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="day-ring" aria-label="Today's progress by life area">
      <g transform={`rotate(-90 ${CX} ${CY})`}>
        {totalItems === 0 && (
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--line)" strokeWidth="7" />
        )}
        {live.map((s, i) => {
          const len = avail * (s.total / totalItems);
          const fill = len * (s.done / s.total);
          const el = (
            <g key={i}>
              <circle
                cx={CX} cy={CY} r={R} fill="none"
                stroke={s.color} strokeOpacity="0.22" strokeWidth="7"
                strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc}
              />
              {fill > 0 && (
                <circle
                  cx={CX} cy={CY} r={R} fill="none"
                  stroke={s.color} strokeWidth="7"
                  strokeLinecap={fill < len ? 'round' : 'butt'}
                  strokeDasharray={`${fill} ${C - fill}`} strokeDashoffset={-acc}
                />
              )}
            </g>
          );
          acc += len + GAP;
          return el;
        })}
      </g>
      <text x={CX} y={CY + 1} textAnchor="middle" dominantBaseline="middle" className="day-ring-pct">
        {pct}%
      </text>
    </svg>
  );
}


function stGoalMetrics(sg: Goal, goals: Goal[], habits: Habit[], focusStrength = 0, graced = true): { time: number; completion: number; health: number } {
  const now     = Date.now();
  const totalMs = (sg.timeframe || 1) * 30.44 * 86_400_000;
  const elapsed = Math.min(1, Math.max(0, (now - sg.createdAt) / totalMs));

  const subGoals  = goals.filter((g) => g.parentGoalId === sg.id);
  const subtree   = new Set<string>([sg.id, ...subGoals.map((g) => g.id)]);
  const sgHabits  = habits.filter((h) => subtree.has(h.goalId));

  const completion = computeDone(subGoals, sgHabits, habits, now);
  const earned     = computeHealth(subGoals, sgHabits, now, focusStrength);
  const health     = graced ? applyNewGoalGrace(earned, sg.createdAt) : earned;
  return { time: elapsed, completion, health };
}


function ongoingGoalMetrics(og: Goal, goals: Goal[], habits: Habit[], focusStrength = 0, graced = true): { time: number; completion: number; health: number } {
  const now    = Date.now();
  const subGoals = goals.filter((g) => g.parentGoalId === og.id);
  const subtree  = new Set<string>([og.id, ...subGoals.map((g) => g.id)]);
  const ogHabits = habits.filter((h) => subtree.has(h.goalId));

  const completion = computeDone(subGoals, ogHabits, habits, now);
  const earned     = computeOngoingHealth(subGoals, ogHabits, focusStrength);
  const health     = graced ? applyNewGoalGrace(earned, og.createdAt) : earned;
  return { time: 0, completion, health };
}

/**
 * Ranks top-level goals by their position within each domain (drag-to-reorder
 * order, persisted via sort_order — the array's existing order IS the
 * priority order) and returns a 0–1 "focus strength" per goal id: #1 in its
 * domain gets full strength, tapering to 0 by ~position 4. Same curve as the
 * Align tab's visual highlight (GoalNode's focusStrength), so the health
 * score's ±10% focus adjustment always matches what the card shows.
 * `topLevelGoals` must already exclude sub-goals — pass a pre-filtered list.
 */
function focusStrengthByDomain(topLevelGoals: Goal[]): Map<string, number> {
  const strength = new Map<string, number>();
  const rankByDomain = new Map<string, number>();
  topLevelGoals.forEach((g) => {
    const idx = rankByDomain.get(g.domainId) ?? 0;
    rankByDomain.set(g.domainId, idx + 1);
    strength.set(g.id, Math.max(0, 1 - idx * 0.4));
  });
  return strength;
}

/**
 * Health for every goal, keyed by id — the single source behind the Align
 * badges AND the numbers fed to the coach, so every surface agrees. Applies
 * the priority-position focus taper (see focusStrengthByDomain) and the
 * new-goal grace.
 */
function computeGoalHealthMap(goals: Goal[], habits: Habit[]): Record<string, GoalHealthInfo> {
  const map: Record<string, GoalHealthInfo> = {};
  (['long', 'short', 'ongoing'] as const).forEach((horizon) => {
    const topLevel = goals.filter((g) => g.horizon === horizon && !g.parentGoalId);
    const strengthById = focusStrengthByDomain(topLevel);
    goals.filter((g) => g.horizon === horizon).forEach((g) => {
      const focusStrength = strengthById.get(g.id) ?? 0;
      const m = horizon === 'long'
        ? vitalityFor(g, goals, habits, focusStrength)
        : horizon === 'ongoing'
          ? ongoingGoalMetrics(g, goals, habits, focusStrength)
          : stGoalMetrics(g, goals, habits, focusStrength);
      const nItems =
        habits.filter((h) => h.goalId === g.id).length +
        goals.filter((x) => x.parentGoalId === g.id).length;
      map[g.id] = { health: Math.round(m.health * 100), nItems };
    });
  });
  return map;
}


function DashSpider({
  goals: topGoals,
  values,
}: {
  goals: Goal[];
  values: number[];
}) {
  const wrapLabel = (text: string): string[] => {
    if (text.length <= 14) return [text];
    const mid = Math.ceil(text.length / 2);
    const before = text.lastIndexOf(' ', mid);
    const after = text.indexOf(' ', mid);
    const split = before > 0 ? before : after > 0 ? after : -1;
    if (split < 0) return [text];
    return [text.slice(0, split), text.slice(split + 1)];
  };
  const N = topGoals.length;
  if (N < 1) return null;
  const cx = 160, cy = 165, r = 115;

  const pt = (i: number, t: number) => {
    const a = (2 * Math.PI * i) / N - Math.PI / 2;
    return { x: cx + r * t * Math.cos(a), y: cy + r * t * Math.sin(a) };
  };

  const rings = [0.25, 0.5, 0.75, 1];
  const dataPoints = values.map((v, i) => pt(i, Math.max(v, 0.04)));
  const poly = dataPoints.map((p) => `${p.x},${p.y}`).join(' ');

  const labelAnchor = (i: number): 'start' | 'end' | 'middle' => {
    const a = (2 * Math.PI * i) / N - Math.PI / 2;
    const x = Math.cos(a);
    if (x > 0.25) return 'start';
    if (x < -0.25) return 'end';
    return 'middle';
  };

  return (
    <svg viewBox="-80 0 480 350" className="radar-chart">
      {/* Grid rings — always circles so they work for any N */}
      {rings.map((t) => (
        <circle key={t} cx={cx} cy={cy} r={r * t} fill="none" stroke="var(--line)" strokeWidth="1" />
      ))}
      {/* Domain-coloured spokes */}
      {topGoals.map((g, i) => {
        const end   = pt(i, 1);
        const color = DOMAIN_COLORS[g.domainId] ?? 'var(--line)';
        return <line key={i} x1={cx} y1={cy} x2={end.x} y2={end.y}
          stroke={color} strokeWidth="1.5" opacity="0.5" />;
      })}
      {/* Data shape: polygon for N≥3, line for N=2, just dots for N=1 */}
      {N >= 3 && <polygon points={poly} fill="var(--accent)" fillOpacity="0.2" stroke="var(--accent)" strokeWidth="2" />}
      {N === 2 && <line x1={dataPoints[0].x} y1={dataPoints[0].y} x2={dataPoints[1].x} y2={dataPoints[1].y} stroke="var(--accent)" strokeWidth="2" strokeOpacity="0.5" />}
      {dataPoints.map((p, i) => {
        const color = DOMAIN_COLORS[topGoals[i].domainId] ?? 'var(--accent)';
        return <circle key={i} cx={p.x} cy={p.y} r="5" fill={color} />;
      })}
      {/* Labels: goal title only, coloured by domain */}
      {topGoals.map((g, i) => {
        const color = DOMAIN_COLORS[g.domainId] ?? 'var(--muted)';
        const lp    = pt(i, 1.34);
        const anchor = labelAnchor(i);
        const lines = wrapLabel(g.title);
        return (
          <text key={i} x={lp.x} textAnchor={anchor} fontSize="11" fill={color}>
            {lines.map((line, j) => (
              <tspan key={j} x={lp.x} y={lp.y + (j - (lines.length - 1) / 2) * 13}>{line}</tspan>
            ))}
          </text>
        );
      })}
    </svg>
  );
}

function GoalStrip({
  goal,
  metrics,
  domainColor = 'var(--accent)',
  isShort = false,
}: {
  goal: Goal;
  metrics: { time: number; completion: number; health: number };
  domainColor?: string;
  isShort?: boolean;
}) {
  const [showInfo, setShowInfo] = useState(false);
  const countdown  = getGoalCountdown(goal);
  const healthPct  = Math.round(metrics.health * 100);
  return (
    <div className={`goal-strip${isShort ? ' goal-strip--short' : ''}`}>
      <div className="strip-title">{goal.title}</div>
      <div className="strip-row">
        <span className="strip-label">Time</span>
        <div className="strip-track">
          <div className="strip-fill tone-time" style={{ width: `${Math.round(metrics.time * 100)}%` }} />
        </div>
        <span className="strip-pct strip-countdown">{countdown}</span>
      </div>
      <div className="strip-row">
        <span className="strip-label">
          Health
          <button
            className={`health-info${showInfo ? ' active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setShowInfo((v) => !v); }}
            aria-label="Health calculation details"
            style={showInfo ? { borderColor: domainColor, color: domainColor } : {}}
          >i</button>
        </span>
        <div className="strip-track">
          <div className="strip-fill" style={{ width: `${healthPct}%`, background: domainColor }} />
        </div>
        <span className="strip-pct">{healthPct}%</span>
      </div>
      {showInfo && (
        <div className="health-popup">
          <div className="health-popup-row">
            <span className="health-popup-formula">
              {goal.horizon === 'ongoing'
                ? 'habit consistency · completed tasks · recent activity'
                : 'pace · habit consistency · planning engagement'}
            </span>
            <span className="health-popup-result" style={{ color: domainColor }}>{healthPct}%</span>
          </div>
          <div className="health-popup-divider" />
          {goal.horizon === 'ongoing' ? (
            <>
              <div className="health-popup-weights">
                <span>Are recurring habits being kept?</span>
                <span>Were ongoing tasks completed recently?</span>
                <span>Is there active work attached?</span>
              </div>
              <div className="health-popup-note">
                No deadline, so no pace — health measures upkeep through habit consistency, recent completed tasks, recent touch, and active focus.
              </div>
            </>
          ) : (
            <>
              <div className="health-popup-weights">
                <span>Are you on track for the time spent? (50%)</span>
                <span>Are your habits consistent? (30%)</span>
                <span>Have you built out your plan? (20%)</span>
              </div>
              <div className="health-popup-note">
                Pace × 50% + habit consistency × 30% + planning engagement × 20%
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}


function GoalsDashboard({
  domains,
  goals,
  habits,
  onClose,
}: {
  domains: Domain[];
  goals: Goal[];
  habits: Habit[];
  onClose: () => void;
}) {
  const longGoals    = goals.filter((g) => g.horizon === 'long'    && !g.parentGoalId);
  // Short-term includes sub-goals — they get their own strip with a "↳ parent"
  // label, so goals added under a long-term goal still register here.
  const allShort     = goals.filter((g) => g.horizon === 'short');
  const ongoingGoals = goals.filter((g) => g.horizon === 'ongoing');

  // Priority position per domain tapers the focus adjustment (same rule and
  // curve as the Align tab's card highlight — see focusStrengthByDomain).
  const focusLtStrength = focusStrengthByDomain(longGoals);
  const focusStStrength = focusStrengthByDomain(allShort.filter((g) => !g.parentGoalId));
  const focusOgStrength = focusStrengthByDomain(ongoingGoals.filter((g) => !g.parentGoalId));

  const ltMetrics  = new Map(longGoals.map((g) => [g.id, vitalityFor(g, goals, habits, focusLtStrength.get(g.id) ?? 0)] as const));
  const stMetrics  = new Map(allShort.map((g) => [g.id, stGoalMetrics(g, goals, habits, focusStStrength.get(g.id) ?? 0)] as const));
  const ogMetrics  = new Map(ongoingGoals.map((g) => [g.id, ongoingGoalMetrics(g, goals, habits, focusOgStrength.get(g.id) ?? 0)] as const));

  const ltSpiderValues = longGoals.map((g) => ltMetrics.get(g.id)!.health);
  const stSpiderValues = allShort.map((g) => stMetrics.get(g.id)!.health);
  const ogSpiderValues = ongoingGoals.map((g) => ogMetrics.get(g.id)!.health);

  const [activeSlide, setActiveSlide] = useState<0 | 1 | 2>(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const scrollToSlide = (index: 0 | 1 | 2) => {
    trackRef.current?.scrollTo({ left: index * (trackRef.current.clientWidth || 0), behavior: 'smooth' });
    setActiveSlide(index);
  };

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const slides = track.querySelectorAll<HTMLElement>('.spider-slide');
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            const idx = Array.from(slides).indexOf(entry.target as HTMLElement);
            if (idx !== -1) setActiveSlide(idx as 0 | 1 | 2);
          }
        });
      },
      { root: track, threshold: 0.5 }
    );
    slides.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  const healthNoteDeadline = (
    <div className="dash-health-note">
      <div className="dash-health-note-title">How Health is calculated</div>
      <p>Pace (50%) · Habit consistency (30%) · Planning engagement (20%)</p>
      <p>New goals start at 50% and settle to their earned score over the first 14 days.</p>
    </div>
  );
  const healthNoteOngoing = (
    <div className="dash-health-note">
      <div className="dash-health-note-title">How Health is calculated</div>
      <p>Habit consistency · Recent completed tasks · Recent activity · Active focus — no deadline, so no pace</p>
      <p>New goals start at 50% and settle to their earned score over the first 14 days.</p>
    </div>
  );

  return (
    <div className="review-panel">
      <div className="review-header">
        <h2>Goals</h2>
        <button className="icon-btn" onClick={onClose}>✕</button>
      </div>

      <div className="spider-pills">
        <button className={`spider-pill${activeSlide === 0 ? ' active' : ''}`} onClick={() => scrollToSlide(0)}>1–12 mo</button>
        <button className={`spider-pill${activeSlide === 1 ? ' active' : ''}`} onClick={() => scrollToSlide(1)}>1–5 yr</button>
        <button className={`spider-pill${activeSlide === 2 ? ' active' : ''}`} onClick={() => scrollToSlide(2)}>Ongoing</button>
      </div>

      <div className="spider-track" ref={trackRef} role="region" aria-label="Goal charts">
        {/* Slide 0: Short-term */}
        <div className="spider-slide">
          {allShort.length > 0
            ? <DashSpider goals={allShort} values={stSpiderValues} />
            : <p className="spider-empty">No short-term goals yet.</p>}
          {domains.map((d) => {
            const dShort = allShort.filter((g) => g.domainId === d.id);
            if (!dShort.length) return null;
            const domainColor = DOMAIN_COLORS[d.id] ?? 'var(--accent)';
            return (
              <div key={d.id} className="dash-domain-section">
                <div className="dash-domain-label" style={{ color: domainColor }}>{d.name}</div>
                {dShort.map((sg) => {
                  const parent = sg.parentGoalId ? goals.find((g) => g.id === sg.parentGoalId) : null;
                  return (
                    <div key={sg.id}>
                      {parent && (
                        <div className="dash-st-parent-label">↳ {parent.title}</div>
                      )}
                      <GoalStrip goal={sg} metrics={stMetrics.get(sg.id)!} domainColor={domainColor} isShort />
                    </div>
                  );
                })}
              </div>
            );
          })}
          {healthNoteDeadline}
        </div>

        {/* Slide 1: Long-term */}
        <div className="spider-slide">
          {longGoals.length > 0
            ? <DashSpider goals={longGoals} values={ltSpiderValues} />
            : <p className="spider-empty">No long-term goals yet.</p>}
          {domains.map((d) => {
            const dLong = longGoals.filter((g) => g.domainId === d.id);
            if (!dLong.length) return null;
            const domainColor = DOMAIN_COLORS[d.id] ?? 'var(--accent)';
            return (
              <div key={d.id} className="dash-domain-section">
                <div className="dash-domain-label" style={{ color: domainColor }}>{d.name}</div>
                {dLong.map((lg) => (
                  <GoalStrip key={lg.id} goal={lg} metrics={ltMetrics.get(lg.id)!} domainColor={domainColor} />
                ))}
              </div>
            );
          })}
          {healthNoteDeadline}
        </div>

        {/* Slide 2: Ongoing */}
        <div className="spider-slide">
          {ongoingGoals.length > 0
            ? <DashSpider goals={ongoingGoals} values={ogSpiderValues} />
            : <p className="spider-empty">No ongoing goals yet.</p>}
          {domains.map((d) => {
            const dOng = ongoingGoals.filter((g) => g.domainId === d.id);
            if (!dOng.length) return null;
            const domainColor = DOMAIN_COLORS[d.id] ?? 'var(--accent)';
            return (
              <div key={d.id} className="dash-domain-section">
                <div className="dash-domain-label" style={{ color: domainColor }}>{d.name}</div>
                {dOng.map((og) => {
                  const parent = og.parentGoalId ? goals.find((g) => g.id === og.parentGoalId) : null;
                  return (
                    <div key={og.id}>
                      {parent && (
                        <div className="dash-st-parent-label">↳ {parent.title}</div>
                      )}
                      <GoalStrip goal={og} metrics={ogMetrics.get(og.id)!} domainColor={domainColor} isShort />
                    </div>
                  );
                })}
              </div>
            );
          })}
          {healthNoteOngoing}
        </div>
      </div>

      <div className="spider-dots">
        <button className={`spider-dot${activeSlide === 0 ? ' active' : ''}`} onClick={() => scrollToSlide(0)} aria-label="Short-term goals chart" />
        <button className={`spider-dot${activeSlide === 1 ? ' active' : ''}`} onClick={() => scrollToSlide(1)} aria-label="Long-term goals chart" />
        <button className={`spider-dot${activeSlide === 2 ? ' active' : ''}`} onClick={() => scrollToSlide(2)} aria-label="Ongoing goals chart" />
      </div>
    </div>
  );
}

/* ---------------- decay helper ---------------- */
/** Exponential-decay weighted average — recent weeks count more (~4-week half-life). */
function decayedAvg(key: string, reflections: ReflectionEntry[]): number {
  const scored = reflections.filter((x) => x.scores[key] !== undefined);
  if (!scored.length) return 0;
  const now = Date.now();
  const WEEK_MS = 7 * 86_400_000;
  let wSum = 0, wTotal = 0;
  for (const r of scored) {
    const w = Math.exp(-0.17 * Math.max(0, (now - r.date) / WEEK_MS));
    wSum  += r.scores[key] * w;
    wTotal += w;
  }
  return wTotal > 0 ? wSum / wTotal : 0;
}


/* ---------------- RadarChart ---------------- */
function RadarChart({
  domains,
  goals,
  habits,
  reflections,
}: {
  domains: Domain[];
  goals: Goal[];
  habits: Habit[];
  reflections: ReflectionEntry[];
}) {
  const axes = domains.flatMap((d) =>
    d.values.map((v) => ({
      label: v,
      key: `${d.id}:${v}`,
      color: DOMAIN_COLORS[d.id] ?? 'var(--muted)',
    })),
  );
  const N = axes.length;
  const cx = 160, cy = 155, r = 85;

  const pt = (i: number, t: number) => {
    const angle = (2 * Math.PI * i) / N - Math.PI / 2;
    return { x: cx + r * t * Math.cos(angle), y: cy + r * t * Math.sin(angle) };
  };

  const rings = [0.25, 0.5, 0.75, 1];
  const dataPoints = axes.map((ax) => pt(axes.indexOf(ax), valueAlignmentScore(ax.key, goals, habits, reflections, domains) / 10));
  const poly = dataPoints.map((p) => `${p.x},${p.y}`).join(' ');

  const labelAnchor = (i: number): 'start' | 'end' | 'middle' => {
    const angle = (2 * Math.PI * i) / N - Math.PI / 2;
    const x = Math.cos(angle);
    if (x > 0.3) return 'start';
    if (x < -0.3) return 'end';
    return 'middle';
  };

  return (
    <svg viewBox="-80 0 480 310" className="radar-chart">
      {rings.map((t) => {
        const pts = axes.map((_, i) => pt(i, t));
        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';
        return <path key={t} d={d} fill="none" stroke="var(--line)" strokeWidth="1" />;
      })}
      {/* domain-coloured spokes */}
      {axes.map((ax, i) => {
        const end = pt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={end.x} y2={end.y}
          stroke={ax.color} strokeWidth="1.5" opacity="0.4" />;
      })}
      <polygon points={poly} fill="var(--accent)" fillOpacity="0.15" stroke="var(--accent)" strokeWidth="1.5" />
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill={axes[i].color} />
      ))}
      {/* labels coloured by domain */}
      {axes.map((ax, i) => {
        const lp = pt(i, 1.50);
        const lines = ax.label.length <= 14 ? [ax.label]
          : (() => {
              const mid = Math.ceil(ax.label.length / 2);
              const before = ax.label.lastIndexOf(' ', mid);
              const after = ax.label.indexOf(' ', mid);
              const split = before > 0 ? before : after > 0 ? after : -1;
              return split < 0 ? [ax.label] : [ax.label.slice(0, split), ax.label.slice(split + 1)];
            })();
        return (
          <text key={i} x={lp.x} textAnchor={labelAnchor(i)} fontSize="10" fill={ax.color} opacity="0.9">
            {lines.map((line, j) => (
              <tspan key={j} x={lp.x} y={lp.y + (j - (lines.length - 1) / 2) * 12}>{line}</tspan>
            ))}
          </text>
        );
      })}
    </svg>
  );
}

const REVIEW_MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatReviewDateFull(ts: number): string {
  const d = new Date(ts);
  return `${REVIEW_MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function ReviewPanel({
  domains,
  goals,
  habits,
  reflections,
  onReset,
  onClose,
}: {
  domains: Domain[];
  goals: Goal[];
  habits: Habit[];
  reflections: ReflectionEntry[];
  onReset: () => void;
  onClose: () => void;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [collapsedDomains, setCollapsedDomains] = useState<Set<string>>(new Set());

  const toggleDomain = (id: string) =>
    setCollapsedDomains((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="review-panel">
      <div className="review-header">
        <h2>Value Alignment</h2>
        <div className="review-header-actions">
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
      </div>

      {reflections.length === 0 ? (
        <p className="review-empty">No reflections yet. Check in on Sunday.</p>
      ) : (
        <>
          {/* Radar chart */}
          <div className="radar-wrap">
            <RadarChart domains={domains} goals={goals} habits={habits} reflections={reflections} />
          </div>

          {/* Domain-grouped value breakdown */}
          <div className="review-values-section">
            {domains.map((d) => {
              const domainColor = DOMAIN_COLORS[d.id] ?? 'var(--accent)';
              const allValueRows = d.values.map((v) => ({ label: v, key: `${d.id}:${v}` }));
              if (!allValueRows.length) return null;
              const isCollapsed = collapsedDomains.has(d.id);
              const avgScore = allValueRows.reduce(
                (sum, { key }) => sum + valueAlignmentScore(key, goals, habits, reflections, domains), 0,
              ) / allValueRows.length;
              const domainPct = Math.round(avgScore * 10);
              return (
                <div key={d.id} className="review-value-domain-group">
                  <button
                    className="review-value-domain-header"
                    style={{ color: domainColor }}
                    onClick={() => toggleDomain(d.id)}
                  >
                    <span>{d.name}</span>
                    <span className="review-domain-right">
                      <span className="review-domain-score">{domainPct}%</span>
                      <span className="review-domain-chevron">{isCollapsed ? '▾' : '▴'}</span>
                    </span>
                  </button>
                  {!isCollapsed && allValueRows.map(({ label, key }) => {
                    const score = valueAlignmentScore(key, goals, habits, reflections, domains);
                    const pct = score / 10;
                    return (
                      <div key={key} className="review-value-row">
                        <div className="review-value-btn">
                          <span className="review-value-name">{label}</span>
                          <div className="review-value-bar-wrap">
                            <div
                              className="review-value-bar"
                              style={{ width: `${Math.round(pct * 100)}%`, background: domainColor }}
                            />
                          </div>
                          <span className="review-value-score">{Math.round(pct * 100)}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            <div className="review-decay-note">
              Score 0–100%: reflection 50%, goal &amp; habit activity 50%
            </div>
          </div>

          {/* Reflection log */}
          <div className="review-log-section">
            <button
              className="review-log-toggle"
              onClick={() => setLogOpen((v) => !v)}
            >
              <span>Log ({reflections.length})</span>
              <span className="review-log-chevron">{logOpen ? '▴' : '▾'}</span>
            </button>
            {logOpen && (
              <div className="review-log-entries">
                {[...reflections].reverse().map((r, i) => (
                  <div key={i} className="review-log-entry">
                    <div className="review-log-header">
                      <span className="review-log-date">{formatReviewDateFull(r.date)}</span>
                      <span className="review-log-week">Week {r.weekNumber}</span>
                    </div>
                    {domains.map((d) => {
                      const color = DOMAIN_COLORS[d.id] ?? 'var(--accent)';
                      const hasScores = d.values.some((v) => r.scores[`${d.id}:${v}`] != null);
                      if (!hasScores) return null;
                      return (
                        <div key={d.id} className="review-log-domain">
                          <div className="review-log-domain-label" style={{ color }}>{d.name}</div>
                          {d.values.map((v) => {
                            const score = r.scores[`${d.id}:${v}`];
                            if (score == null) return null;
                            return (
                              <div key={v} className="review-log-value-row">
                                <span className="review-log-value-name">{v}</span>
                                <div className="review-log-dots">
                                  {[1, 2, 3].map((n) => (
                                    <span
                                      key={n}
                                      className="review-log-dot"
                                      style={{ background: n <= score ? color : 'var(--line)' }}
                                    />
                                  ))}
                                </div>
                                <span className="review-log-score" style={{ color }}>{score}/3</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Reset — at very bottom */}
          {reflections.length > 0 && (
            <div className="review-reset-section">
              <button className="review-reset-btn" onClick={() => setConfirmReset(true)}>
                Reset all reflections
              </button>
            </div>
          )}

          {/* Reset warning modal */}
          {confirmReset && (
            <div className="scrim" role="dialog" aria-modal="true" onClick={() => setConfirmReset(false)}>
              <div className="sheet" onClick={(e) => e.stopPropagation()}>
                <div className="reset-warn-icon">⚠</div>
                <h2 style={{ marginBottom: 8 }}>Delete all reflections?</h2>
                <p className="reset-warn-body">
                  This will permanently delete all {reflections.length} weekly reflection{reflections.length !== 1 ? 's' : ''}.
                  Your scores, notes, and history cannot be recovered.
                </p>
                <button
                  className="reset-warn-confirm"
                  onClick={() => { onReset(); setConfirmReset(false); }}
                >
                  Yes, delete everything
                </button>
                <button className="ghost" onClick={() => setConfirmReset(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------- helpers ---------------- */
function getISOWeek(d: Date): number {
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = target.getTime() - firstThursday.getTime();
  return (
    1 +
    Math.round(
      (diff / 86_400_000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7,
    )
  );
}

/** Returns true if the habit was completed within its current recurrence window. */
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The day after a YYYY-MM-DD string, as YYYY-MM-DD. Used by the reset (↺) pill
 * to dismiss a single missed day WITHOUT logging a completion: advancing the
 * habit's startDate past the oldest frozen day drops that day from the missed
 * set and surfaces the next one (or clears the chip if it was the last).
 */
function dayAfter(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00');
  d.setDate(d.getDate() + 1);
  return toDateStr(d);
}

function dateInCurrentPeriod(dateStr: string, h: Habit): boolean {
  const d = new Date(dateStr + 'T12:00');
  const now = new Date();
  switch (h.recurrence ?? 'daily') {
    case 'daily':
      return dateStr === toDateStr(now);
    case 'weekdays':
      return dateStr === toDateStr(now) && now.getDay() !== 0 && now.getDay() !== 6;
    case 'weekly':
      return getISOWeek(d) === getISOWeek(now) && d.getFullYear() === now.getFullYear();
    case 'monthly':
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    case 'yearly':
      return d.getFullYear() === now.getFullYear();
    case 'custom': {
      const unit = h.customUnit ?? 'weeks';
      const interval = Math.max(1, h.customInterval ?? 1);
      const windowMs =
        unit === 'days'   ? interval * 86_400_000 :
        unit === 'weeks'  ? interval * 7 * 86_400_000 :
        unit === 'months' ? interval * 30.44 * 86_400_000 :
        /* years */         interval * 365.25 * 86_400_000;
      return Date.now() - d.getTime() < windowMs;
    }
    case 'specific-days': {
      const scheduled = h.specificDays ?? [];
      if (!scheduled.includes(now.getDay())) return false;
      return dateStr === toDateStr(now);
    }
    default:
      return dateStr === toDateStr(now);
  }
}

function isHabitDoneThisPeriod(h: Habit): boolean {
  return (h.completions ?? []).some((d) => dateInCurrentPeriod(d, h));
}

/** Is this habit actually scheduled to appear today? Cadence-aware. */
function isHabitScheduledToday(h: Habit): boolean {
  const day = new Date().getDay(); // 0=Sun … 6=Sat
  switch (h.recurrence ?? 'daily') {
    case 'weekdays':
      return day !== 0 && day !== 6;
    case 'specific-days':
      return (h.specificDays ?? []).includes(day);
    // weekly / monthly / yearly / custom are open commitments: shown until
    // completed for the current period, then they fall into Done.
    default:
      return true;
  }
}

/** Roughly how many days between expected completions, by cadence. */
function naturalIntervalDays(h: Habit): number {
  switch (h.recurrence ?? 'daily') {
    case 'weekly':
      return 7;
    case 'monthly':
      return 30;
    case 'yearly':
      return 365;
    case 'specific-days': {
      const n = (h.specificDays ?? []).length;
      return n ? 7 / n : 7;
    }
    case 'custom': {
      const iv = Math.max(1, h.customInterval ?? 1);
      const u = h.customUnit ?? 'weeks';
      return iv * (u === 'days' ? 1 : u === 'weeks' ? 7 : u === 'months' ? 30 : 365);
    }
    default: // daily, weekdays
      return 1;
  }
}

/** Days since this habit was last completed; Infinity if never. */
function daysSinceLastDone(h: Habit): number {
  const comps = h.completions ?? [];
  if (!comps.length) return Infinity;
  const last = comps.reduce(
    (max, d) => Math.max(max, new Date(d + 'T12:00').getTime()),
    0,
  );
  return (Date.now() - last) / 86_400_000;
}

/**
 * Compute streak from the completions array, using a 2-day grace window for
 * daily-ish habits so forgetting to log doesn't silently break a streak.
 * For weekly/monthly/etc habits, one completion per period is enough.
 */
function computeStreakFromCompletions(completions: string[], h: Habit): number {
  if (!completions.length) return 0;
  const sorted = [...completions].sort().reverse(); // newest first
  const interval = naturalIntervalDays(h);
  const graceDays = interval <= 2 ? 2 : 0; // grace only for daily-ish habits
  let streak = 0;
  let cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  for (const d of sorted) {
    const day = new Date(d + 'T12:00');
    day.setHours(0, 0, 0, 0);
    const gapDays = Math.round((cursor.getTime() - day.getTime()) / 86_400_000);
    if (gapDays < 0) continue; // future date, skip
    if (gapDays <= interval + graceDays) {
      streak++;
      cursor = new Date(day.getTime() - interval * 86_400_000);
    } else {
      break;
    }
  }
  return streak;
}

/** A habit has been neglected when it's overdue by ≥ 2× its natural interval. */
function isNeglected(h: Habit): boolean {
  if (h.kind !== 'habit') return false;
  return daysSinceLastDone(h) >= naturalIntervalDays(h) * 2;
}

/**
 * Returns missed scheduled dates (YYYY-MM-DD), oldest first, that the habit was
 * due on but never logged. Works for EVERY cadence:
 *   - calendar-day schedules (daily / weekdays / specific-days): the recent
 *     scheduled weekdays that elapsed un-logged, up to 2;
 *   - period schedules (weekly / monthly / yearly / custom): the most recent
 *     period that fully elapsed with no completion in it.
 * A habit never flags days before its startDate, so a habit created today never
 * shows a spurious "missed yesterday" chip.
 */
function getGraceDays(h: Habit): string[] {
  if (h.kind !== 'habit') return [];

  const done = new Set(h.completions ?? []);
  const skipped = new Set(h.skippedDates ?? []);
  const startDateStr = h.startDate ?? null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rec = h.recurrence ?? 'daily';

  // ---- Calendar-day cadences: enumerate the actual missed weekday occurrences.
  if (rec === 'daily' || rec === 'weekdays' || rec === 'specific-days') {
    const isScheduled = (d: Date): boolean => {
      const dow = d.getDay(); // 0=Sun … 6=Sat
      if (rec === 'weekdays') return dow !== 0 && dow !== 6;
      if (rec === 'specific-days') return (h.specificDays ?? []).includes(dow);
      return true; // daily
    };
    const missed: string[] = [];
    // Walk back day-by-day collecting the contiguous recent lapse (max 2). Stop
    // at the habit's start date or the first scheduled day that WAS logged.
    for (let i = 1; i <= 14 && missed.length < 2; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const str = toDateStr(d);
      if (startDateStr && str < startDateStr) break; // before habit started
      if (skipped.has(str)) break;                    // explicitly skipped — stop
      if (!isScheduled(d)) continue;                 // not a due day
      if (done.has(str)) break;                       // last due day was logged
      missed.push(str);
    }
    return missed.reverse(); // oldest first so user processes in order
  }

  // ---- Period cadences: flag the previous period if it elapsed with no log.
  if (isHabitDoneThisPeriod(h)) return [];            // current period satisfied
  const interval = Math.round(naturalIntervalDays(h));
  const prev = new Date(today);
  prev.setDate(prev.getDate() - interval);
  const prevStr = toDateStr(prev);
  if (startDateStr && prevStr < startDateStr) return []; // started this period
  if (skipped.has(prevStr)) return [];                    // explicitly skipped
  // If the most recent completion already falls inside the previous period
  // window, that period was satisfied — the current (still-open) period isn't
  // "missed" yet, so show nothing.
  const lastDone = (h.completions ?? []).reduce(
    (max, d) => Math.max(max, new Date(d + 'T12:00').getTime()),
    -Infinity,
  );
  if (lastDone >= prev.getTime()) return [];
  return [prevStr];
}

/**
 * Toggle a habit's completion for the RELEVANT occurrence, shared by the Align
 * and Today tabs:
 *   1. if the CURRENT PERIOD already has a satisfying completion → un-log it
 *      (undo). For weekly/monthly/etc. cadences the satisfying date is often
 *      not literally "today" (e.g. logged Monday, viewed Thursday) — checking
 *      only `completions.includes(today)` missed this and caused a second,
 *      duplicate completion to be logged instead of undoing;
 *   2. else work through the missed backlog oldest-first (frozen days);
 *   3. else log today ONLY if the habit is actually scheduled today;
 *   4. else no-op — never phantom-log a day the habit isn't due (which would
 *      move health without ever filling the card's circle).
 */
function toggleHabitCompletion(h: Habit): Habit {
  const today = toDateStr(new Date());
  const completions = h.completions ?? [];
  const satisfying = completions.filter((d) => dateInCurrentPeriod(d, h));
  if (satisfying.length > 0) {
    const newCompletions = completions.filter((d) => !satisfying.includes(d));
    return {
      ...h,
      doneToday: newCompletions.includes(today) ? h.doneToday : false,
      completions: newCompletions,
      streak: computeStreakFromCompletions(newCompletions, h),
      completedAt: undefined,
    };
  }
  const frozen = getGraceDays(h);
  const target = frozen.length > 0 ? frozen[0] : isHabitScheduledToday(h) ? today : null;
  if (target === null) return h;
  const newCompletions = [...completions, target];
  return {
    ...h,
    doneToday: target === today ? true : h.doneToday,
    completions: newCompletions,
    streak: computeStreakFromCompletions(newCompletions, h),
    completedAt: Date.now(),
  };
}

/* ---------------- bits ---------------- */
function NavBtn({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button className={active ? 'active' : ''} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function Chevron({ up }: { up: boolean }) {
  return (
    <svg className={`chev${up ? ' up' : ''}`} width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Tick() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** One-way arrow — marks a one-off task. */
function TaskArrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h13M13 7l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Two cyclic arrows — marks a repeatable habit. */
function RepeatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 9a8 8 0 0 1 13.7-3.3L20 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 4v4h-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 15a8 8 0 0 1-13.7 3.3L4 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 20v-4h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CalIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ display: 'inline', verticalAlign: 'middle', marginBottom: '1px' }}>
      <rect x="0.5" y="1.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="0.5" y1="4.5" x2="11.5" y2="4.5" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="3.5" y1="0" x2="3.5" y2="3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <line x1="8.5" y1="0" x2="8.5" y2="3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Reusable confirmation modal, matching the reset-warning sheet. Click the
 * scrim or Cancel to dismiss; the confirm button runs onConfirm.
 */
function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="scrim" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="reset-warn-icon">⚠</div>
        <h2 style={{ marginBottom: 8 }}>{title}</h2>
        <p className="reset-warn-body">{body}</p>
        <button className="reset-warn-confirm" onClick={onConfirm}>{confirmLabel}</button>
        <button className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** Warning body listing what a goal delete will cascade into. */
function goalDeleteWarning(goalId: string, goals: Goal[], habits: Habit[]): { title: string; body: string } {
  const g = goals.find((x) => x.id === goalId);
  const remove = new Set<string>([goalId, ...goals.filter((x) => x.parentGoalId === goalId).map((x) => x.id)]);
  const subCount  = remove.size - 1;
  const itemCount = habits.filter((h) => remove.has(h.goalId)).length;
  const extras = [
    subCount  ? `${subCount} sub-goal${subCount !== 1 ? 's' : ''}` : '',
    itemCount ? `${itemCount} task${itemCount !== 1 ? 's' : ''}/habit${itemCount !== 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(' and ');
  return {
    title: 'Delete this goal?',
    body: `“${g?.title ?? 'This goal'}”${extras ? `, along with its ${extras},` : ''} will be permanently deleted. You can undo it right afterward from the toast.`,
  };
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}


function IconBase() {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none">
      <path d="M12 3l8 5v8l-8 5-8-5V8l8-5z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function IconAlign() {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M8 12l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" strokeLinecap="round" />
    </svg>
  );
}

function IconCompass() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="12" cy="12" r="9" />
      {/* North needle — solid */}
      <path d="M12 6l2.5 6H9.5z" fill="currentColor" stroke="none" />
      {/* South needle — dimmed */}
      <path d="M12 18l-2.5-6h5z" fill="currentColor" stroke="none" opacity="0.3" />
    </svg>
  );
}

function IconDashboard() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </svg>
  );
}
