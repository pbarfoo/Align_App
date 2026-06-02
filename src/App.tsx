import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getGeminiFocusPicks, getGeminiCoachCard, saveCoachFeedback, getTodayCoachRating, type FocusPick, type CoachCard } from './geminiAdvisor';
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
import { supabase, localMode } from './supabase';
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

const TAB_KEY = 'align-tab-v1';
const LS_DOMAINS = 'align-domains-v1';
const LS_GOALS = 'align-goals-v1';
const LS_HABITS = 'align-habits-v1';
const LS_REFLECTIONS = 'align-reflections-v1';

function loadOr<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/* ---- Supabase row mappers ---- */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

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
  };
}
function goalFromRow(row: Row): Goal {
  return {
    id: row.id, domainId: row.domain_id as DomainId,
    valueIndexes: row.value_indexes ?? [],
    horizon: row.horizon as 'long' | 'short',
    title: row.title,
    parentGoalId: row.parent_goal_id ?? undefined,
    createdAt: row.created_at,
    timeframe: row.timeframe,
    completedAt: row.completed_at ?? undefined,
  };
}

function habitToRow(h: Habit, userId: string): Row {
  return {
    id: h.id, user_id: userId, goal_id: h.goalId,
    title: h.title, kind: h.kind, done_today: h.doneToday,
    start_date: h.startDate ?? null, recurrence: h.recurrence ?? null,
    custom_interval: h.customInterval ?? null, custom_unit: h.customUnit ?? null,
    specific_days: h.specificDays ?? null,
    due_date: h.dueDate ?? null, due_time: h.dueTime ?? null,
    completed: h.completed ?? null, completed_at: h.completedAt ?? null,
    streak: h.streak ?? 0,
    completions: h.completions ?? [],
  };
}
function habitFromRow(row: Row): Habit {
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
    completed: row.completed ?? undefined,
    completedAt: row.completed_at ?? undefined,
    streak: row.streak ?? 0,
    completions: row.completions ?? [],
  };
}

function reflToRow(r: ReflectionEntry, userId: string): Row {
  return {
    id: `${userId.slice(0, 8)}-${r.date}`,
    user_id: userId, week_number: r.weekNumber, year: new Date(r.date).getFullYear(),
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
    if (localMode) { setAuthLoading(false); return; }
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
  const [tab, setTab] = useState<Tab>('today');
  const [domains, setDomains] = useState<Domain[]>(seedDomains);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [reflectOpen, setReflectOpen] = useState(false);
  const [reflections, setReflections] = useState<ReflectionEntry[]>([]);

  // True while applying data freshly loaded from the DB, so the sync effects
  // don't immediately re-upsert it (which could overwrite newer data written
  // by another session/tab).
  const hydrating = useRef(false);

  // Load data from Supabase on sign-in. Keyed on the user id (not the whole
  // session object) so it runs ONCE per user — not on every token refresh or
  // tab-focus auth event, which would otherwise re-read stale data and clobber
  // in-progress local edits.
  useEffect(() => {
    if (localMode) {
      hydrating.current = true;
      setDomains(loadOr<Domain[]>(LS_DOMAINS, seedDomains));
      setGoals(loadOr<Goal[]>(LS_GOALS, initialGoals));
      setHabits(loadOr<Habit[]>(LS_HABITS, initialHabits));
      setReflections(loadOr<ReflectionEntry[]>(LS_REFLECTIONS, []));
      setDataLoaded(true);
      return;
    }
    if (!session) { setDataLoaded(true); return; }
    const userId = session.user.id;
    const timeout = setTimeout(() => {
      setToast('⚠ Database taking too long — try refreshing');
      setDataLoaded(true);
    }, 10000);
    Promise.all([
      supabase.from('domains').select('*').eq('user_id', userId),
      supabase.from('goals').select('*').eq('user_id', userId),
      supabase.from('habits').select('*').eq('user_id', userId),
      supabase.from('reflections').select('*').eq('user_id', userId).order('date'),
    ]).then(([d, g, h, r]) => {
      const dbError = d.error || g.error || h.error || r.error;
      if (dbError) {
        console.error('Supabase load error:', dbError.message);
        setToast(`⚠ DB error: ${dbError.message} — run supabase/schema.sql`);
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
      if (r.data?.length) setReflections(r.data.map(reflFromRow));

      // Mark this account as seeded so we never reseed/overwrite again.
      if (!alreadySeeded) supabase.auth.updateUser({ data: { seeded: true } });
      clearTimeout(timeout);
      setDataLoaded(true);
    }).catch((err) => {
      clearTimeout(timeout);
      console.error('Supabase load failed:', err);
      setToast('⚠ Could not reach database — check your connection');
      setDataLoaded(true);
    });
  }, [session?.user?.id]);

  // Sync domains
  useEffect(() => {
    if (!dataLoaded || hydrating.current) return;
    if (localMode) { localStorage.setItem(LS_DOMAINS, JSON.stringify(domains)); return; }
    if (!session) return;
    supabase.from('domains').upsert(domains.map((x) => domainToRow(x, session.user.id)), { onConflict: 'id,user_id' })
      .then(({ error }) => { if (error) { console.error('sync domains:', error); setToast(`⚠ Save failed: ${error.message}`); } });
  }, [domains]);

  // Sync goals
  useEffect(() => {
    if (!dataLoaded || hydrating.current) return;
    if (localMode) { localStorage.setItem(LS_GOALS, JSON.stringify(goals)); return; }
    if (!session || !goals.length) return;
    supabase.from('goals').upsert(goals.map((x) => goalToRow(x, session.user.id)))
      .then(({ error }) => { if (error) { console.error('sync goals:', error); setToast(`⚠ Save failed: ${error.message}`); } });
  }, [goals]);

  // Sync habits
  useEffect(() => {
    if (!dataLoaded || hydrating.current) return;
    if (localMode) { localStorage.setItem(LS_HABITS, JSON.stringify(habits)); return; }
    if (!session || !habits.length) return;
    supabase.from('habits').upsert(habits.map((x) => habitToRow(x, session.user.id)))
      .then(({ error }) => { if (error) { console.error('sync habits:', error); setToast(`⚠ Save failed: ${error.message}`); } });
  }, [habits]);

  // Sync reflections
  useEffect(() => {
    if (!dataLoaded || hydrating.current) return;
    if (localMode) { localStorage.setItem(LS_REFLECTIONS, JSON.stringify(reflections)); return; }
    if (!session || !reflections.length) return;
    supabase.from('reflections').upsert(reflections.map((x) => reflToRow(x, session.user.id)))
      .then(({ error }) => { if (error) { console.error('sync reflections:', error); setToast(`⚠ Save failed: ${error.message}`); } });
  }, [reflections]);

  // Clear the hydration flag after the sync effects above have evaluated for
  // this render, so subsequent user edits sync normally.
  useEffect(() => {
    hydrating.current = false;
  });

  // Tab persists in localStorage (UI preference)
  useEffect(() => {
    localStorage.setItem(TAB_KEY, JSON.stringify(tab));
  }, [tab]);

  // Explicit delete helpers (upsert doesn't remove rows; no-op in localMode since state sync handles it)
  const deleteGoalFromDb = (ids: string[]) => {
    if (localMode || !session) return;
    supabase.from('habits').delete().in('goal_id', ids)
      .then(({ error }) => { if (error) console.error('delete habits for goal:', error); });
    supabase.from('goals').delete().in('id', ids)
      .then(({ error }) => { if (error) { console.error('delete goals:', error); flash('Delete failed: ' + error.message, true); } });
  };
  const deleteHabitFromDb = (id: string) => {
    if (localMode || !session) return;
    supabase.from('habits').delete().eq('id', id)
      .then(({ error }) => { if (error) { console.error('delete habit:', error); flash('Delete failed: ' + error.message, true); } });
  };

  const [reviewOpen, setReviewOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (msg: string, isError = false) => {
    setToast(isError ? `⚠ ${msg}` : msg);
    setTimeout(() => setToast(null), 2500);
  };

  if (authLoading || !dataLoaded) {
    return (
      <div className="app-loading">
        <div className="app-loading-text">Loading…</div>
      </div>
    );
  }
  if (!localMode && !session) return <LoginScreen />;

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
            onReflect={() => setReflectOpen(true)}
          />
        )}
      </main>

      {reflectOpen && (
        <Reflect
          domains={domains}
          goals={goals}
          reflections={reflections}
          onClose={() => setReflectOpen(false)}
          onSave={(scores, note, weekNumber, date) => {
            const entry: ReflectionEntry = { weekNumber, date, scores, note };
            setReflections((r) => [...r, entry]);
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
      {!localMode && session && (
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

      {toast && <div className="toast">{toast}</div>}

      <nav className="nav">
        <NavBtn label="Foundation" active={tab === 'foundation'} onClick={() => setTab('foundation')} icon={<IconBase />} />
        <NavBtn label="Align" active={tab === 'align'} onClick={() => setTab('align')} icon={<IconAlign />} />
        <NavBtn label="Today" active={tab === 'today'} onClick={() => setTab('today')} icon={<IconCheck />} />
      </nav>
    </div>
  );
}

/* ---------------- Date / Time Button ---------------- */
function DateBtn({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const display = value
    ? new Date(value + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : placeholder;
  return (
    <button type="button" className={`date-btn${value ? '' : ' date-btn--empty'}`}>
      {display}
      <input type="date" value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%', colorScheme: 'dark' }} />
    </button>
  );
}

function TimeBtn({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const display = value
    ? (() => { const [h, m] = value.split(':'); const d = new Date(); d.setHours(+h, +m); return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); })()
    : placeholder;
  return (
    <button type="button" className={`date-btn${value ? '' : ' date-btn--empty'}`}>
      {display}
      <input type="time" value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%', colorScheme: 'dark' }} />
    </button>
  );
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
  flash: (m: string) => void;
  onDeleteGoalFromDb: (ids: string[]) => void;
  onDeleteHabitFromDb: (id: string) => void;
}) {
  const [domainId, setDomainId] = useState<DomainId>('career');
  const [lit, setLit] = useState<string | null>(null);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [addingForKind, setAddingForKind] = useState<'short' | 'action' | null>(null);
  const [editValuesFor, setEditValuesFor] = useState<string | null>(null);
  const [hideCompleted, setHideCompleted] = useState(() => loadOr('align-hide-completed-v1', false));
  const [collapsedGoals, setCollapsedGoals] = useState<Set<string>>(new Set());

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
      return arrayMove(prev, oi, ni);
    });
  };

  useEffect(() => {
    localStorage.setItem('align-hide-completed-v1', JSON.stringify(hideCompleted));
  }, [hideCompleted]);

  const domain = domains.find((d) => d.id === domainId)!;
  const domainGoals = goals.filter((g) => g.domainId === domainId);
  const longGoals = domainGoals.filter((g) => g.horizon === 'long');
  const looseShort = domainGoals.filter(
    (g) => g.horizon === 'short' && !g.parentGoalId,
  );

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

  const addLongGoal = (valueIndexes: number[], title: string, years: number) => {
    setGoals((prev) => [...prev, {
      id: uid('g'),
      domainId,
      valueIndexes,
      horizon: 'long' as const,
      title,
      createdAt: Date.now(),
      timeframe: years,
    }]);
    flash('Long-term goal added');
  };

  const addShortGoal = (parent: Goal, title: string, months: number, valueIndexes: number[] = []) => {
    setGoals((prev) => [...prev, {
      id: uid('g'),
      domainId,
      valueIndexes,
      horizon: 'short' as const,
      title,
      parentGoalId: parent.id,
      createdAt: Date.now(),
      timeframe: months,
    }]);
    setAddingFor(null);
    setAddingForKind(null);
    flash('Short-term goal added');
  };

  const addLooseShortGoal = (title: string, months: number, valueIndexes: number[] = []) => {
    setGoals((prev) => [...prev, {
      id: uid('g'),
      domainId,
      valueIndexes,
      horizon: 'short' as const,
      title,
      createdAt: Date.now(),
      timeframe: months,
    }]);
    flash('Short-term goal added');
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
      ...(kind === 'habit'
        ? {
            startDate: input.startDate || undefined,
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

  const updateGoalTimeframe = (id: string, timeframe: number) =>
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, timeframe } : g)));


  const updateHabit = (id: string, updates: Partial<Habit>) =>
    setHabits((prev) => prev.map((h) => (h.id === id ? { ...h, ...updates } : h)));

  const deleteGoal = (id: string) => {
    const remove = new Set<string>([id]);
    goals.forEach((g) => {
      if (g.parentGoalId && remove.has(g.parentGoalId)) remove.add(g.id);
    });
    if (addingFor && remove.has(addingFor)) setAddingFor(null);
    setGoals((prev) => prev.filter((g) => !remove.has(g.id)));
    setHabits((ph) => ph.filter((h) => !remove.has(h.goalId)));
    onDeleteGoalFromDb([...remove]);
    flash('Deleted');
  };

  const deleteHabit = (id: string) => {
    setHabits((prev) => prev.filter((h) => h.id !== id));
    onDeleteHabitFromDb(id);
    flash('Deleted');
  };

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
      const today = toDateStr(new Date());
      const completions = h.completions ?? [];
      const turningOn = !completions.includes(today);
      return {
        ...h,
        doneToday: turningOn,
        completions: turningOn ? [...completions, today] : completions.filter((d) => d !== today),
        streak: turningOn ? (h.streak || 0) + 1 : Math.max(0, (h.streak || 0) - 1),
        completedAt: turningOn ? Date.now() : undefined,
      };
    }));

  return (
    <div className="screen">
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
        <SortableContext items={longGoals.filter(lg => !(hideCompleted && !!lg.completedAt)).map(g => g.id)} strategy={verticalListSortingStrategy}>
        {longGoals
          .filter((lg) => !(hideCompleted && !!lg.completedAt))
          .map((lg, ltIdx) => {
          const lgValues = lg.valueIndexes.map((i) => domain.values[i]).filter(Boolean);
          const ltHasChildren = habits.some((h) => h.goalId === lg.id) || domainGoals.some((s) => s.parentGoalId === lg.id);
          return (
          <SortableGoal key={lg.id} id={lg.id}>
          <div className="goal-thread" style={{ '--thread-color': THREAD_PALETTE[ltIdx % THREAD_PALETTE.length] } as React.CSSProperties}>
            <GoalNode
              goal={lg}
              values={lgValues}
              domainValues={domain.values}
              valueIndexes={lg.valueIndexes}
              editValuesActive={editValuesFor === lg.id}
              onEditValues={() =>
                setEditValuesFor(editValuesFor === lg.id ? null : lg.id)
              }
              onChangeValues={(idxs) => updateGoalValues(lg.id, idxs)}
              className={cls(`g:${lg.id}`)}
              onClick={() => setLit(lit === `g:${lg.id}` ? null : `g:${lg.id}`)}
              canAddChild
              addActive={addingFor === lg.id}
              onAddChild={() => {
                if (addingFor === lg.id) { setAddingFor(null); setAddingForKind(null); }
                else { setAddingFor(lg.id); setAddingForKind(null); }
              }}
              onDelete={() => deleteGoal(lg.id)}
              onRename={(title) => updateGoalTitle(lg.id, title)}
              onChangeTimeframe={(t) => updateGoalTimeframe(lg.id, t)}
              isComplete={!!lg.completedAt}
              onToggleComplete={() => toggleGoalComplete(lg.id)}
              isCollapsed={collapsedGoals.has(lg.id)}
              onToggleCollapse={ltHasChildren ? () => toggleCollapse(lg.id) : undefined}
              isFocus={ltIdx === 0}
              showDragHandle
            />
            {!collapsedGoals.has(lg.id) && habits
              .filter((h) => {
                if (h.goalId !== lg.id) return false;
                if (!hideCompleted) return true;
                if (h.kind === 'task') return !h.completed;
                return !isHabitDoneThisPeriod(h);
              })
              .map((h) => {
                const done = h.kind === 'task' ? !!h.completed : isHabitDoneThisPeriod(h);
                return (
                  <div
                    key={h.id}
                    className={`${cls(`h:${h.id}`)} node short${done ? ' completed' : ''}`}
                    onClick={() => setLit(lit === `h:${h.id}` ? null : `h:${h.id}`)}
                  >
                    <button
                      className={`node-check${done ? ' on' : ''}`}
                      title={done ? 'Mark incomplete' : 'Mark complete'}
                      onClick={(e) => { e.stopPropagation(); toggleHabit(h.id); }}
                    />
                    <div className="node-main">
                      <div className="node-tag">{h.kind === 'task' ? 'Task' : 'Habit'}</div>
                      <div className="node-title">{h.title}</div>
                      <div className="node-foot">
                        <span className="goal-date">
                          {h.kind === 'task' ? getTaskCountdown(h) : getRecurrenceString(h)}
                        </span>
                      </div>
                    </div>
                    <div className="node-ctrls">
                      <button
                        className="node-del"
                        title="Delete"
                        onClick={(e) => { e.stopPropagation(); deleteHabit(h.id); }}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                );
              })}
            {!collapsedGoals.has(lg.id) && domainGoals
              .filter((s) => s.parentGoalId === lg.id)
              .map((sg) => (
                <ShortWithActions
                  key={sg.id}
                  goal={sg}
                  displayValues={[]}
                  habits={habits}
                  cls={cls}
                  lit={lit}
                  setLit={setLit}
                  addingFor={addingFor}
                  setAddingFor={setAddingFor}
                  onAddAction={addAction}
                  onDeleteGoal={deleteGoal}
                  onRenameGoal={updateGoalTitle}
                  onChangeGoalTimeframe={updateGoalTimeframe}
                  onDeleteHabit={deleteHabit}
                  onEditHabit={updateHabit}
                  onToggleGoalComplete={toggleGoalComplete}
                  onToggleHabit={toggleHabit}
                  hideCompleted={hideCompleted}
                  domainValues={domain.values}
                  domainVision={domain.vision}
                />
              ))}
            {!collapsedGoals.has(lg.id) && addingFor === lg.id && (
              addingForKind === null ? (
                <div className="inline-add short add-form">
                  <div className="seg">
                    <button type="button" onClick={() => setAddingForKind('short')}>Short-term goal</button>
                    <button type="button" onClick={() => setAddingForKind('action')}>Habit / Task</button>
                  </div>
                  <button className="mini-ghost" onClick={() => { setAddingFor(null); setAddingForKind(null); }}>Cancel</button>
                </div>
              ) : addingForKind === 'short' ? (
                <AddShortGoalForm
                  domainValues={domain.values}
                  forceOpen
                  onClose={() => { setAddingFor(null); setAddingForKind(null); }}
                  indent="short"
                  onAdd={(title, months, vi) => addShortGoal(lg, title, months, vi)}
                />
              ) : (
                <AddActionForm
                  goalId={lg.id}
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

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={looseShort.filter(sg => !(hideCompleted && !!sg.completedAt)).map(g => g.id)} strategy={verticalListSortingStrategy}>
        {looseShort
          .filter((sg) => !(hideCompleted && !!sg.completedAt))
          .map((sg, stIdx) => (
          <SortableGoal key={sg.id} id={sg.id}>
          <div style={{ '--thread-color': THREAD_PALETTE[(longGoals.length + stIdx) % THREAD_PALETTE.length] } as React.CSSProperties}>
            <ShortWithActions
              goal={sg}
              displayValues={sg.valueIndexes.map((i) => domain.values[i]).filter(Boolean)}
              habits={habits}
              cls={cls}
              lit={lit}
              setLit={setLit}
              addingFor={addingFor}
              setAddingFor={setAddingFor}
              onAddAction={addAction}
              onDeleteGoal={deleteGoal}
              onRenameGoal={updateGoalTitle}
              onChangeGoalTimeframe={updateGoalTimeframe}
              onDeleteHabit={deleteHabit}
              onEditHabit={updateHabit}
              onToggleGoalComplete={toggleGoalComplete}
              onToggleHabit={toggleHabit}
              hideCompleted={hideCompleted}
              domainValues={domain.values}
              domainVision={domain.vision}
              editValuesActive={editValuesFor === sg.id}
              onEditValues={() => setEditValuesFor(editValuesFor === sg.id ? null : sg.id)}
              onChangeValues={(idxs) => updateGoalValues(sg.id, idxs)}
              valueIndexes={sg.valueIndexes}
              isCollapsed={collapsedGoals.has(sg.id)}
              onToggleCollapse={habits.some((h) => h.goalId === sg.id) ? () => toggleCollapse(sg.id) : undefined}
              isFocus={longGoals.filter(lg => !(hideCompleted && !!lg.completedAt)).length === 0 && stIdx === 0}
              showDragHandle
            />
          </div>
          </SortableGoal>
        ))}
        </SortableContext>
        </DndContext>

        <AddShortGoalForm
          domainValues={domain.values}
          onAdd={addLooseShortGoal}
        />
        <AddGoalForm
          domainValues={domain.values}
          onAdd={(idxs, title, years) => addLongGoal(idxs, title, years)}
        />
      </div>
    </div>
  );
}

function ShortWithActions({
  goal,
  displayValues,
  habits,
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
  hideCompleted,
  editValuesActive,
  onEditValues,
  onChangeValues,
  valueIndexes,
  domainValues,
  isCollapsed,
  onToggleCollapse,
  isFocus,
  showDragHandle,
  domainVision: _domainVision,
}: {
  goal: Goal;
  displayValues: string[];
  habits: Habit[];
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
  onChangeGoalTimeframe: (id: string, t: number) => void;
  onDeleteHabit: (id: string) => void;
  onEditHabit: (id: string, updates: Partial<Habit>) => void;
  onToggleGoalComplete: (id: string) => void;
  onToggleHabit: (id: string) => void;
  hideCompleted: boolean;
  editValuesActive?: boolean;
  onEditValues?: () => void;
  onChangeValues?: (idxs: number[]) => void;
  valueIndexes?: number[];
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  isFocus?: boolean;
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
        onChangeTimeframe={(t) => onChangeGoalTimeframe(goal.id, t)}
        isComplete={!!goal.completedAt}
        onToggleComplete={() => onToggleGoalComplete(goal.id)}
        editValuesActive={editValuesActive}
        onEditValues={onEditValues}
        onChangeValues={onChangeValues}
        valueIndexes={valueIndexes}
        domainValues={domainValues}
        isCollapsed={isCollapsed}
        onToggleCollapse={onToggleCollapse}
        isFocus={isFocus}
        showDragHandle={showDragHandle}
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
            className={`${cls(`h:${h.id}`)} habit${done ? ' completed' : ''}`}
            onClick={() => setLit(lit === `h:${h.id}` ? null : `h:${h.id}`)}
          >
            <button
              className={`node-check${done ? ' on' : ''}`}
              title={done ? 'Mark incomplete' : 'Mark complete'}
              onClick={(e) => { e.stopPropagation(); onToggleHabit(h.id); }}
            />
            <div className="node-main">
              <div className="node-tag">
                {h.kind === 'task' ? 'Task' : 'Habit'}
              </div>
              <div
                className="node-title"
                onClick={(e) => { e.stopPropagation(); setEditingHabitId(editingHabitId === h.id ? null : h.id); }}
                title="Click to edit"
                style={{ cursor: 'text' }}
              >
                {h.title}
              </div>
              <div className="node-foot">
                <span className="goal-date">
                  {h.kind === 'task'
                    ? getTaskCountdown(h)
                    : getRecurrenceString(h)}
                </span>
              </div>
            </div>
            <div className="node-ctrls">
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
      {!isCollapsed && addingFor === goal.id && (
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
}: {
  goalId: string;
  onAdd?: (goalId: string, title: string, kind: ActionKind, input: ActionInput) => void;
  onSave?: (updates: Partial<Habit>) => void;
  onClose: () => void;
  initial?: Habit;
}) {
  const [kind, setKind] = useState<ActionKind>(initial?.kind ?? 'habit');
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
    </div>
  );
}

function AddShortGoalForm({
  domainValues,
  onAdd,
  forceOpen,
  onClose,
  indent,
}: {
  domainValues: string[];
  onAdd: (title: string, months: number, valueIndexes: number[]) => void;
  forceOpen?: boolean;
  onClose?: () => void;
  indent?: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [months, setMonths] = useState('1');
  const [picked, setPicked] = useState<number[]>([]);

  const isOpen = forceOpen || open;
  const cls = `inline-add${indent ? ` ${indent}` : ''}`;

  const reset = () => { setTitle(''); setMonths('1'); setPicked([]); };
  const close = () => { reset(); forceOpen ? onClose?.() : setOpen(false); };

  const submit = () => {
    if (!title.trim()) return;
    onAdd(title.trim(), Number(months), [...picked].sort((a, b) => a - b));
    close();
  };

  const togglePick = (i: number) =>
    setPicked((p) => p.includes(i) ? p.filter((x) => x !== i) : [...p, i]);

  if (!isOpen) return (
    <button className={`${cls} add-btn`} onClick={() => setOpen(true)}>
      + Short-term goal
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
              <button
                key={v}
                type="button"
                className={`value-chip small${picked.includes(i) ? ' on' : ''}`}
                onClick={() => togglePick(i)}
              >{v}</button>
            ))}
          </div>
        </>
      )}
      <select value={months} onChange={(e) => setMonths(e.target.value)}>
        {[1, 3, 6, 12].map((m) => (
          <option key={m} value={m}>{m === 12 ? '1 Year' : `${m} Month${m > 1 ? 's' : ''}`}</option>
        ))}
      </select>
      <div className="add-actions">
        <button className="mini-primary" onClick={submit}>Add</button>
        <button className="mini-ghost" onClick={close}>Cancel</button>
      </div>
    </div>
  );
}

function AddGoalForm({
  domainValues,
  onAdd,
}: {
  domainValues: string[];
  onAdd: (valueIndexes: number[], title: string, years: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [years, setYears] = useState('1');

  const reset = () => {
    setTitle('');
    setPicked([]);
    setYears('1');
  };

  const toggle = (i: number) =>
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));

  const submit = () => {
    if (!title.trim()) return;
    onAdd([...picked].sort((a, b) => a - b), title, Number(years));
    reset();
    setOpen(false);
  };

  if (!open) {
    return (
      <button className="inline-add add-btn" onClick={() => setOpen(true)}>
        + Long-term goal
      </button>
    );
  }

  return (
    <div className="inline-add add-form">
      <div className="ai-field">
        <input
          autoFocus
          placeholder="e.g. Ship a product I fully own"
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
              <button
                key={v}
                type="button"
                className={`value-chip small${picked.includes(i) ? ' on' : ''}`}
                onClick={() => toggle(i)}
              >
                {v}
              </button>
            ))}
          </div>
        </>
      )}
      <select value={years} onChange={(e) => setYears(e.target.value)}>
        {[1, 2, 3, 4, 5].map((y) => (
          <option key={y} value={y}>
            {y} Year{y > 1 ? 's' : ''}
          </option>
        ))}
      </select>
      <div className="add-actions">
        <button className="mini-primary" onClick={submit}>
          Add
        </button>
        <button
          className="mini-ghost"
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          Cancel
        </button>
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
  isFocus,
  showDragHandle,
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
  onChangeTimeframe?: (t: number) => void;
  editValuesActive?: boolean;
  onEditValues?: () => void;
  onChangeValues?: (idxs: number[]) => void;
  isComplete?: boolean;
  onToggleComplete?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  isFocus?: boolean;
  showDragHandle?: boolean;
}) {
  const canEditValues = !!onEditValues;
  const idxs = valueIndexes ?? [];
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingTimeframe, setEditingTimeframe] = useState(false);
  const [draft, setDraft] = useState(goal.title);


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
    <div className={`${className}${short ? ' short' : ''}${isComplete ? ' completed' : ''}${isFocus ? ' focus-goal' : ''}`} onClick={onClick}>
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
      {onToggleComplete && (
        <button
          className={`node-check${isComplete ? ' on' : ''}`}
          title={isComplete ? 'Mark incomplete' : 'Mark complete'}
          onClick={(e) => { e.stopPropagation(); onToggleComplete(); }}
        />
      )}
      <div className="node-main">
        <div className="node-tag">
          {goal.horizon === 'long' ? 'Long-term · ' : 'Short-term · '}
          {editingTimeframe && onChangeTimeframe ? (
            <select
              className="timeframe-select"
              value={goal.timeframe}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => { onChangeTimeframe(Number(e.target.value)); setEditingTimeframe(false); }}
              onBlur={() => setEditingTimeframe(false)}
            >
              {goal.horizon === 'long'
                ? [1,2,3,4,5].map((y) => <option key={y} value={y}>{y} yr</option>)
                : [1,3,6,12].map((m) => <option key={m} value={m}>{m === 12 ? '1 yr' : `${m} mo`}</option>)
              }
            </select>
          ) : (
            <span
              onClick={onChangeTimeframe ? (e) => { e.stopPropagation(); setEditingTimeframe(true); } : undefined}
              title={onChangeTimeframe ? 'Click to edit' : undefined}
              style={onChangeTimeframe ? { cursor: 'pointer', textDecoration: 'underline dotted' } : undefined}
            >
              {goal.horizon === 'long' ? `${goal.timeframe} yr` : goal.timeframe === 12 ? '1 yr' : `${goal.timeframe} mo`}
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
        {showDragHandle && <DragHandle />}
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
  onReflect,
}: {
  habits: Habit[];
  setHabits: React.Dispatch<React.SetStateAction<Habit[]>>;
  goals: Goal[];
  domains: Domain[];
  reflections: ReflectionEntry[];
  onReflect: () => void;
}) {
  const [showDone, setShowDone] = useState(false);
  const [collapsedDomains, setCollapsedDomains] = useState<Set<DomainId>>(
    () => new Set(domains.map((d) => d.id)),
  );
  const toggleDomain = (id: DomainId) =>
    setCollapsedDomains(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const [geminiFocus, setGeminiFocus] = useState<FocusPick[] | null>(null);
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [coachCard, setCoachCard] = useState<CoachCard | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachRating, setCoachRating] = useState<'up' | 'down' | null>(null);
  const today = toDateStr(new Date());

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

  const doneItems = [...doneHabits, ...completedToday];

  // Progress: today's habits + urgent tasks + tasks finished today
  const totalCount =
    scheduledHabits.length + overdueTasks.length + dueTodayTasks.length + completedToday.length;
  const done = doneHabits.length + completedToday.length;
  const pct = totalCount ? Math.round((done / totalCount) * 100) : 0;

  // Group today's open items (habits + upcoming tasks) by domain for the
  // main list, so balance across life areas is visible.
  const domainOf = (goalId: string) =>
    goals.find((g) => g.id === goalId)?.domainId;
  const horizonOf = (goalId: string) =>
    goals.find((g) => g.id === goalId)?.horizon;

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
  // Domains that have at least one active (non-completed) goal — used to
  // surface neglect when such a domain has nothing scheduled today.
  const domainHasGoals = (domainId: DomainId) =>
    goals.some((g) => g.domainId === domainId && !g.completedAt);

  const toggle = (id: string) => {
    setHabits((prev) => prev.map((h) => {
      if (h.id !== id) return h;
      if (h.kind === 'task') {
        const turningOn = !h.completed;
        return { ...h, completed: turningOn, completedAt: turningOn ? Date.now() : undefined };
      }
      const today = toDateStr(new Date());
      const completions = h.completions ?? [];
      const turningOn = !completions.includes(today);
      return {
        ...h,
        doneToday: turningOn,
        completions: turningOn ? [...completions, today] : completions.filter((d) => d !== today),
        streak: turningOn ? (h.streak || 0) + 1 : Math.max(0, (h.streak || 0) - 1),
        completedAt: turningOn ? Date.now() : undefined,
      };
    }));
  };

  const lineage = (goalId: string) => {
    const g = goals.find((x) => x.id === goalId);
    if (!g) return '';
    return g.title;
  };

  const allValues = domains.flatMap((d) => d.values);
  const weekValue = allValues.length
    ? allValues[getISOWeek(new Date()) % allValues.length]
    : null;

  // --- Today's focus: pick the 3 most important, theme-aligned items ---
  const goalAlignsWithTheme = (goalId: string): boolean => {
    if (!weekValue) return false;
    const g = goals.find((x) => x.id === goalId);
    if (!g) return false;
    const dom = domains.find((d) => d.id === g.domainId);
    if (!dom) return false;
    return g.valueIndexes.some((i) => dom.values[i] === weekValue);
  };
  const focusScore = (item: Habit): number => {
    let s = 0;
    if (goalAlignsWithTheme(item.goalId)) s += 50; // this week's theme
    if (horizonOf(item.goalId) === 'short') s += 12; // active push
    if (item.kind === 'task') {
      if (item.dueDate) {
        if (item.dueDate < today) s += 45; // overdue
        else if (item.dueDate === today) s += 35; // due today
        else {
          const dLeft = Math.round(
            (new Date(item.dueDate + 'T12:00').getTime() - Date.now()) / 86_400_000,
          );
          if (dLeft <= 3) s += 20;
          else if (dLeft <= 7) s += 10;
        }
      }
    } else {
      if (isNeglected(item)) s += 25;
      const since = daysSinceLastDone(item);
      const interval = naturalIntervalDays(item);
      s += since === Infinity ? 12 : Math.min(20, (since / interval) * 8);
      if ((item.streak ?? 0) >= 3) s += 6; // protect a streak
    }
    return s;
  };
  const todaysFocus = [...openHabits, ...openTasks]
    .map((item) => ({ item, score: focusScore(item) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.item);

  const allActionableIds = [...openHabits, ...openTasks].map((h) => h.id);

  useEffect(() => {
    if (!allActionableIds.length) return;
    setGeminiLoading(true);
    getGeminiFocusPicks(domains, goals, habits, allActionableIds)
      .then((picks) => {
        // Keep only IDs that are still actionable (in case of stale cache)
        const live = new Set(allActionableIds);
        setGeminiFocus(picks.filter((p) => live.has(p.id)));
      })
      .catch((err) => {
        console.warn('Gemini focus unavailable, using heuristic:', err);
        setGeminiFocus(null);
      })
      .finally(() => setGeminiLoading(false));
  }, []); // once per mount (cache handles per-day freshness)

  useEffect(() => {
    setCoachLoading(true);
    getGeminiCoachCard(domains, goals, habits, reflections)
      .then((card) => {
        setCoachCard(card);
        setCoachRating(getTodayCoachRating(today, card.title));
      })
      .catch((err) => {
        console.warn('Gemini coach unavailable:', err);
        setCoachCard(null);
      })
      .finally(() => setCoachLoading(false));
  }, []); // once per mount (cache handles per-day freshness)

  // Resolve the display focus: Gemini picks if available, else heuristic
  const habitMap = new Map(habits.map((h) => [h.id, h]));
  const focusDisplay: Array<{ item: Habit; reason?: string }> = geminiFocus
    ? geminiFocus
        .map((p) => ({ item: habitMap.get(p.id)!, reason: p.reason }))
        .filter((x) => !!x.item)
    : todaysFocus.map((item) => ({ item }));

  const renderRow = (h: Habit) => {
    const isDone = h.kind === 'task' ? !!h.completed : isHabitDoneThisPeriod(h);
    return (
      <div className="habit-row" key={h.id}>
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
            {h.kind === 'task' ? `Task · ${getTaskCountdown(h)}` : getRecurrenceString(h)}
            &nbsp;·&nbsp; serves <b>{lineage(h.goalId)}</b>
          </div>
        </div>
      </div>
    );
  };

  const hasAnythingToday = openHabits.length > 0 || openTasks.length > 0;

  return (
    <div className="screen">
      <div className="eyebrow">Today</div>
      <h1>Small, aligned acts</h1>
      <p className="lede">
        Not a to-do list. Just the habits and tasks that move your values
        forward.
      </p>

      {weekValue && (
        <div className="week-value">
          This week: leaning into <b>{weekValue}</b>
        </div>
      )}

      <div className="progress-wrap">
        <div className="progress-num">
          {done}
          <span> / {totalCount} today</span>
        </div>
        <div className="bar">
          <i style={{ width: `${pct}%` }} />
        </div>
        <button className="reflect-mini-btn" onClick={onReflect} title="Weekly reflection">✦ Reflect</button>
      </div>

      {/* Daily coaching card */}
      {(coachCard || coachLoading) && (
        <div className="today-section coach-card">
          <div className="today-section-head">
            ✦ Coach
            {coachLoading && <span className="focus-loading">thinking…</span>}
          </div>
          {coachCard && (
            <>
              <div className="coach-title">{coachCard.title}</div>
              <div className="coach-blurb">{coachCard.blurb}</div>
              <div className="coach-feedback">
                <button
                  className={`coach-feedback-btn up${coachRating === 'up' ? ' active' : ''}`}
                  onClick={() => {
                    const next = coachRating === 'up' ? null : 'up';
                    setCoachRating(next);
                    saveCoachFeedback(today, coachCard.title, next);
                  }}
                  aria-label="Helpful"
                >👍</button>
                <button
                  className={`coach-feedback-btn down${coachRating === 'down' ? ' active' : ''}`}
                  onClick={() => {
                    const next = coachRating === 'down' ? null : 'down';
                    setCoachRating(next);
                    saveCoachFeedback(today, coachCard.title, next);
                  }}
                  aria-label="Not helpful"
                >👎</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Today's focus: Gemini-powered top-3, heuristic fallback */}
      {(focusDisplay.length > 0 || geminiLoading) && (
        <div className="today-section focus">
          <div className="today-section-head">
            ✦ Today's focus
            {geminiLoading && <span className="focus-loading">thinking…</span>}
          </div>
          {focusDisplay.map(({ item, reason }) => (
            <React.Fragment key={item.id}>
              {renderRow(item)}
              {reason && <div className="focus-reason">{reason}</div>}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Today, grouped by domain */}
      {domains.map((dom) => {
        const items = todayItemsByDomain(dom.id);
        if (items.length === 0 && !domainHasGoals(dom.id)) return null;
        const collapsed = collapsedDomains.has(dom.id);
        return (
          <div className="today-section" key={dom.id}>
            <button
              className="today-domain-head"
              onClick={() => toggleDomain(dom.id)}
              aria-expanded={!collapsed}
            >
              {dom.name}
              {items.length > 0 && (
                <span className="today-count">{items.length}</span>
              )}
              <span className={`today-domain-chev${collapsed ? ' collapsed' : ''}`}>
                <Chevron up={false} />
              </span>
            </button>
            {!collapsed && (
              items.length > 0
                ? items.map(renderRow)
                : (
                  <div className="today-empty-domain">
                    Nothing scheduled for {dom.name} today.
                  </div>
                )
            )}
          </div>
        );
      })}

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
          {showDone && doneItems.map(renderRow)}
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
  goals,
  reflections,
  onClose,
  onSave,
}: {
  domains: Domain[];
  goals: Goal[];
  reflections: ReflectionEntry[];
  onClose: () => void;
  onSave: (scores: Record<string, number>, note: string, weekNumber: number, date: number) => void;
}) {
  const [weekOffset, setWeekOffset] = useState<0 | -1>(0);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [step, setStep] = useState<'score' | 'insight'>('score');

  useEffect(() => {
    const d = new Date();
    if (weekOffset === -1) d.setDate(d.getDate() - 7);
    const week = getISOWeek(d);
    const year = d.getFullYear();
    const existing = [...reflections]
      .filter((r) => r.weekNumber === week && new Date(r.date).getFullYear() === year)
      .sort((a, b) => b.date - a.date)[0];
    setScores(existing?.scores ?? {});
    setNote(existing?.note ?? '');
  }, [weekOffset]);

  const rows = domains.flatMap((d) =>
    d.values.map((v) => ({ d, v, key: `${d.id}:${v}` })),
  );

  const labelFor = (key: string) => {
    const [did, vi] = key.split(':');
    return domains.find((d) => d.id === did)?.values[Number(vi)] ?? key;
  };

  const handleSave = () => {
    const d = new Date();
    if (weekOffset === -1) d.setDate(d.getDate() - 7);
    onSave(scores, note, getISOWeek(d), d.getTime());
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
  const atRisk = goals.filter((g) => {
    const dom = domains.find((d) => d.id === g.domainId);
    if (!dom) return false;
    return g.valueIndexes.some((vi) => {
      const vName = dom.values[vi];
      if (!vName) return false;
      return (scores[`${g.domainId}:${vName}`] ?? 3) < 2;
    });
  });

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
          {atRisk.length > 0 && (
            <div className="insight-risk">
              <div className="insight-risk-label">Goals that need attention</div>
              {atRisk.map((g) => (
                <div key={g.id} className="insight-goal-chip">{g.title}</div>
              ))}
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
        <h2>{weekOffset === -1 ? 'Last week' : 'This week'}</h2>
        <div className="seg" style={{ marginBottom: 12 }}>
          <button type="button" className={weekOffset === 0 ? 'on' : ''} onClick={() => setWeekOffset(0)}>This week</button>
          <button type="button" className={weekOffset === -1 ? 'on' : ''} onClick={() => setWeekOffset(-1)}>Last week</button>
        </div>
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
  // Sub-goals of tagged long-term goals (inherit the value)
  const taggedLtIds = new Set(tagged.filter((g) => g.horizon === 'long').map((g) => g.id));
  const inherited = goals.filter(
    (g) => g.horizon === 'short' && g.parentGoalId && taggedLtIds.has(g.parentGoalId)
      && !tagged.some((t) => t.id === g.id),
  );
  const allTagged = [...tagged, ...inherited];
  const taggedIds = new Set(allTagged.map((g) => g.id));

  // Activity score (0–1): average health across tagged goals + their habits
  let actSum = 0, actCount = 0;
  for (const g of allTagged) {
    const h = g.horizon === 'long'
      ? vitalityFor(g, goals, habits).health
      : stGoalMetrics(g, habits).health;
    actSum += h; actCount++;
  }
  for (const h of habits.filter((h) => h.goalId && taggedIds.has(h.goalId))) {
    const streak = h.streak ?? 0;
    const recent = isHabitDoneThisPeriod(h) ? 1 : Math.max(0, 1 - streak / 14);
    actSum += Math.min(1, recent); actCount++;
  }
  const activityComponent = actCount > 0 ? actSum / actCount : null;

  // Reflection component (0–1)
  const hasRefl = reflections.some((r) => r.scores[key] !== undefined);
  const reflComponent = hasRefl ? decayedAvg(key, reflections) / 3 : null;

  // Blend
  let score: number;
  if (reflComponent !== null && activityComponent !== null) {
    score = 0.7 * reflComponent + 0.3 * activityComponent;
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

function vitalityFor(
  lg: Goal,
  goals: Goal[],
  habits: Habit[],
): { time: number; completion: number; health: number; completionRate: number; recencyScore: number; momentum: number } {
  const totalMs = (lg.timeframe || 1) * 365.25 * 86_400_000;
  const elapsed = Math.min(1, Math.max(0, (Date.now() - lg.createdAt) / totalMs));

  const shortGoals    = goals.filter((g) => g.parentGoalId === lg.id);
  const subtree       = new Set<string>([lg.id, ...shortGoals.map((g) => g.id)]);
  const subtreeHabits = habits.filter((h) => subtree.has(h.goalId));

  // Habit base weight 1, +0.2 per streak level, capped at 4.0
  const habitWeight = (h: Habit) => Math.min(1 + (h.streak || 0) * 0.2, 4.0);

  const FOUR_WEEKS = 28 * 86_400_000;
  const now = Date.now();
  // Standard recency: linear decay 1→0 over 4 weeks (ST goals, tasks)
  const recency = (ts?: number) =>
    ts ? Math.max(0, 1 - (now - ts) / FOUR_WEEKS) : 0;
  // Streak-extended recency for habits: window grows 4→8 weeks as streak 0→14+
  // Continuous habits stay "fresh" longer — rewarding sustained effort
  const habitRecency = (h: Habit, ts?: number): number => {
    const ext    = Math.min((h.streak || 0) / 14, 1); // 0.0–1.0
    const window = FOUR_WEEKS * (1 + ext);              // 4–8 weeks
    return ts ? Math.max(0, 1 - (now - ts) / window) : 0;
  };

  type Item = { w: number; done: boolean; r: number };

  // ALL items — includes LT goal (weight 50) for the Done bar
  const allItems: Item[] = [
    { w: 50, done: !!lg.completedAt,             r: recency(lg.completedAt) },
    ...shortGoals.map((g): Item =>
      ({ w: 10, done: !!g.completedAt,           r: recency(g.completedAt) })),
    ...subtreeHabits.filter((h) => h.kind === 'task').map((h): Item =>
      ({ w: 2,  done: !!h.completed,             r: recency(h.completedAt) })),
    ...subtreeHabits.filter((h) => h.kind === 'habit').map((h): Item =>
      ({ w: habitWeight(h), done: isHabitDoneThisPeriod(h), r: habitRecency(h, h.completedAt) })),
  ];

  // Done bar: weighted fraction of the entire tree (including LT goal)
  const totalW    = allItems.reduce((s, x) => s + x.w, 0);
  const doneW     = allItems.filter((x) => x.done).reduce((s, x) => s + x.w, 0);
  const completion = totalW > 0 ? doneW / totalW : 0;

  // Health bar: completionRate × recencyScore over active sub-items only
  // (ST goals, tasks, habits). LT goal completion lives in the Done bar.
  const activeItems     = allItems.slice(1);
  const activeTotalW    = activeItems.reduce((s, x) => s + x.w, 0);
  const activeDoneItems = activeItems.filter((x) => x.done);
  const activeDoneW     = activeDoneItems.reduce((s, x) => s + x.w, 0);
  const completionRate  = activeTotalW > 0 ? activeDoneW / activeTotalW : 0;
  const recencyScore    = activeDoneW > 0
    ? activeDoneItems.reduce((s, x) => s + x.r * x.w, 0) / activeDoneW : 0;
  const health = completionRate * recencyScore;

  const momentum = (completion + health) / 2;
  return { time: elapsed, completion, health, completionRate, recencyScore, momentum };
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


function stGoalMetrics(sg: Goal, habits: Habit[]): { time: number; completion: number; health: number; completionRate: number; recencyScore: number; momentum: number } {
  const totalMs = (sg.timeframe || 1) * 30.44 * 86_400_000;
  const elapsed = Math.min(1, Math.max(0, (Date.now() - sg.createdAt) / totalMs));
  const sgHabits = habits.filter((h) => h.goalId === sg.id);

  const habitWeight = (h: Habit) => Math.min(1 + (h.streak || 0) * 0.2, 4.0);
  const FOUR_WEEKS = 28 * 86_400_000;
  const now = Date.now();
  const recency = (ts?: number) => ts ? Math.max(0, 1 - (now - ts) / FOUR_WEEKS) : 0;
  const habitRecency = (h: Habit, ts?: number): number => {
    const ext    = Math.min((h.streak || 0) / 14, 1);
    const window = FOUR_WEEKS * (1 + ext);
    return ts ? Math.max(0, 1 - (now - ts) / window) : 0;
  };

  type Item = { w: number; done: boolean; r: number };
  const taskItems: Item[]  = sgHabits.filter((h) => h.kind === 'task').map((h) => ({ w: 2, done: !!h.completed, r: recency(h.completedAt) }));
  const habitItems: Item[] = sgHabits.filter((h) => h.kind === 'habit').map((h) => ({ w: habitWeight(h), done: isHabitDoneThisPeriod(h), r: habitRecency(h, h.completedAt) }));
  const allItems: Item[]   = [{ w: 10, done: !!sg.completedAt, r: recency(sg.completedAt) }, ...taskItems, ...habitItems];

  const totalW    = allItems.reduce((s, x) => s + x.w, 0);
  const doneW     = allItems.filter((x) => x.done).reduce((s, x) => s + x.w, 0);
  const completion = totalW > 0 ? doneW / totalW : 0;

  const activeItems     = [...taskItems, ...habitItems];
  const activeTotalW    = activeItems.reduce((s, x) => s + x.w, 0);
  const activeDoneItems = activeItems.filter((x) => x.done);
  const activeDoneW     = activeDoneItems.reduce((s, x) => s + x.w, 0);
  const completionRate  = activeTotalW > 0 ? activeDoneW / activeTotalW : 0;
  const recencyScore    = activeDoneW > 0 ? activeDoneItems.reduce((s, x) => s + x.r * x.w, 0) / activeDoneW : 0;
  const health = completionRate * recencyScore;
  const momentum = (completion + health) / 2;

  return { time: elapsed, completion, health, completionRate, recencyScore, momentum };
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
  metrics: { time: number; completion: number; health: number; completionRate: number; recencyScore: number };
  domainColor?: string;
  isShort?: boolean;
}) {
  const [showInfo, setShowInfo] = useState(false);
  const countdown    = getGoalCountdown(goal);
  const completePct  = Math.round(metrics.completion * 100);
  const healthPct    = Math.round(metrics.health * 100);
  const donePct      = Math.round(metrics.completionRate * 100);
  const freshPct     = Math.round(metrics.recencyScore * 100);
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
        <span className="strip-label">Done</span>
        <div className="strip-track">
          <div className="strip-fill" style={{ width: `${completePct}%`, background: domainColor, opacity: 0.5 }} />
        </div>
        <span className="strip-pct">{completePct}%</span>
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
              {donePct}% done × {freshPct}% fresh
            </span>
            <span className="health-popup-result" style={{ color: domainColor }}>= {healthPct}%</span>
          </div>
          <div className="health-popup-divider" />
          <div className="health-popup-weights">
            {!isShort && <span><b>10×</b> Short-term goal</span>}
            <span><b>2×</b> Task</span>
            <span><b>1–4×</b> Habit (streak scales weight)</span>
          </div>
          <div className="health-popup-note">
            {isShort
              ? 'Completion × recency of tasks and habits — both must be high. This goal\'s own completion is shown in the Done bar above.'
              : 'Completion × recency — both must be high. Driven by short-term sub-goals (10×), tasks (2×), and habits (1–4× by streak). Long-term goal completion is shown in the Done bar above.'}
          </div>
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
  const longGoals  = goals.filter((g) => g.horizon === 'long');
  const allShort   = goals.filter((g) => g.horizon === 'short');
  const ltMetrics  = new Map(longGoals.map((g) => [g.id, vitalityFor(g, goals, habits)] as const));
  const stMetrics  = new Map(allShort.map((g) => [g.id, stGoalMetrics(g, habits)] as const));

  const ltSpiderValues = longGoals.map((g) => ltMetrics.get(g.id)!.health);
  const stSpiderValues = allShort.map((g) => stMetrics.get(g.id)!.health);

  const [activeSlide, setActiveSlide] = useState<0 | 1>(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const scrollToSlide = (index: 0 | 1) => {
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
            if (idx !== -1) setActiveSlide(idx as 0 | 1);
          }
        });
      },
      { root: track, threshold: 0.5 }
    );
    slides.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  const stHealthNote = (
    <div className="dash-health-note">
      <div className="dash-health-note-title">How Health is calculated</div>
      <p>Health = <b>weighted % done</b> × <b>how recently</b> — both must be high.</p>
      <div className="dash-health-weights">
        <span><b>2×</b> Task</span>
        <span><b>1–4×</b> Habit (streak grows weight)</span>
      </div>
    </div>
  );

  const ltHealthNote = (
    <div className="dash-health-note">
      <div className="dash-health-note-title">How Health is calculated</div>
      <p>Health = <b>weighted % done</b> × <b>how recently</b> — both must be high.</p>
      <div className="dash-health-weights">
        <span><b>10×</b> Short-term sub-goal</span>
        <span><b>2×</b> Task</span>
        <span><b>1–4×</b> Habit (streak grows weight)</span>
      </div>
    </div>
  );

  return (
    <div className="review-panel">
      <div className="review-header">
        <h2>Goals</h2>
        <button className="icon-btn" onClick={onClose}>✕</button>
      </div>

      <div className="spider-pills">
        <button className={`spider-pill${activeSlide === 0 ? ' active' : ''}`} onClick={() => scrollToSlide(0)}>Short-term</button>
        <button className={`spider-pill${activeSlide === 1 ? ' active' : ''}`} onClick={() => scrollToSlide(1)}>Long-term</button>
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
                  const parent = sg.parentGoalId ? longGoals.find((lg) => lg.id === sg.parentGoalId) : null;
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
          {stHealthNote}
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
          {ltHealthNote}
        </div>
      </div>

      <div className="spider-dots">
        <button className={`spider-dot${activeSlide === 0 ? ' active' : ''}`} onClick={() => scrollToSlide(0)} aria-label="Short-term goals chart" />
        <button className={`spider-dot${activeSlide === 1 ? ' active' : ''}`} onClick={() => scrollToSlide(1)} aria-label="Long-term goals chart" />
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

  const latest = reflections[reflections.length - 1];

  const atRiskGoals = latest
    ? goals.filter(
        (g) =>
          g.horizon === 'long' &&
          g.valueIndexes.some((vi) => {
            const dom = domains.find((d) => d.id === g.domainId);
            const vName = dom?.values[vi];
            if (!vName) return false;
            return (latest.scores[`${g.domainId}:${vName}`] ?? 3) < 2;
          }),
      )
    : [];

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
              return (
                <div key={d.id} className="review-value-domain-group">
                  <button
                    className="review-value-domain-header"
                    style={{ color: domainColor }}
                    onClick={() => toggleDomain(d.id)}
                  >
                    <span>{d.name}</span>
                    <span className="review-domain-chevron">{isCollapsed ? '▾' : '▴'}</span>
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
              Score 0–100%: reflection 70%, goal &amp; habit activity 30%
            </div>
          </div>

          {/* Goals at risk */}
          {atRiskGoals.length > 0 && (
            <div className="review-risk-section">
              <div className="review-section-label">Goals at risk this week</div>
              {atRiskGoals.map((g) => {
                const d = domains.find((x) => x.id === g.domainId);
                return (
                  <div key={g.id} className="review-risk-row">
                    <span className="review-risk-domain">{d?.name}</span>
                    <span className="review-risk-title">{g.title}</span>
                  </div>
                );
              })}
            </div>
          )}

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

/** A habit has been neglected when it's overdue by ≥ 2× its natural interval. */
function isNeglected(h: Habit): boolean {
  if (h.kind !== 'habit') return false;
  return daysSinceLastDone(h) >= naturalIntervalDays(h) * 2;
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
