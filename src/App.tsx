import React, { useEffect, useMemo, useRef, useState } from 'react';
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
    due_date: h.dueDate ?? null, due_time: h.dueTime ?? null,
    completed: h.completed ?? null, completed_at: h.completedAt ?? null,
    streak: h.streak ?? 0,
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
    dueDate: row.due_date ?? undefined,
    dueTime: row.due_time ?? undefined,
    completed: row.completed ?? undefined,
    completedAt: row.completed_at ?? undefined,
    streak: row.streak ?? 0,
  };
}

function reflToRow(r: ReflectionEntry, userId: string): Row {
  const year = new Date(r.date).getFullYear();
  return {
    id: `${userId.slice(0, 8)}-${year}-W${r.weekNumber}`,
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
    if (localMode) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) setDataLoaded(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  // App state
  const [tab, setTab] = useState<Tab>(() => loadOr<Tab>(TAB_KEY, 'align'));
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
    if (!session) return;
    const userId = session.user.id;
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
            onReflect={() => setReflectOpen(true)}
          />
        )}
      </main>

      {reflectOpen && (() => {
        const week = getISOWeek(new Date());
        const year = new Date().getFullYear();
        const thisWeek = reflections.find(
          (x) => x.weekNumber === week && new Date(x.date).getFullYear() === year,
        );
        return (
        <Reflect
          domains={domains}
          goals={goals}
          initialScores={thisWeek?.scores}
          initialNote={thisWeek?.note}
          onClose={() => setReflectOpen(false)}
          onSave={(scores, note) => {
            const now = new Date();
            const week = getISOWeek(now);
            const year = now.getFullYear();
            const entry: ReflectionEntry = {
              weekNumber: week,
              date: Date.now(),
              scores,
              note,
            };
            setReflections((r) => {
              // One reflection per week — overwrite if this week already has one
              const existingIdx = r.findIndex(
                (x) => x.weekNumber === week && new Date(x.date).getFullYear() === year,
              );
              if (existingIdx === -1) return [...r, entry];
              const next = [...r];
              next[existingIdx] = entry;
              return next;
            });
            flash(
              reflections.some(
                (x) => x.weekNumber === week && new Date(x.date).getFullYear() === year,
              )
                ? 'This week’s reflection updated'
                : 'Reflection saved',
            );
          }}
        />
        );
      })()}

      {reviewOpen && (
        <ReviewPanel
          domains={domains}
          goals={goals}
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
  const [domainId, setDomainId] = useState<DomainId>('self');
  const [lit, setLit] = useState<string | null>(null);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [editValuesFor, setEditValuesFor] = useState<string | null>(null);
  const [hideCompleted, setHideCompleted] = useState(() => loadOr('align-hide-completed-v1', false));
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
          }
        : {
            dueDate: input.dueDate || undefined,
            dueTime: input.dueTime || undefined,
          }),
    }]);
    setAddingFor(null);
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
      const currentlyDone = h.kind === 'task' ? !!h.completed : isHabitDoneThisPeriod(h);
      const turningOn = !currentlyDone;
      return {
        ...h,
        doneToday: h.kind === 'habit' ? turningOn : h.doneToday,
        ...(h.kind === 'task' ? { completed: turningOn } : {}),
        ...(h.kind === 'habit'
          ? { streak: turningOn ? (h.streak || 0) + 1 : 0 }
          : {}),
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
        {longGoals
          .filter((lg) => !(hideCompleted && !!lg.completedAt))
          .map((lg) => {
          const lgValues = lg.valueIndexes.map((i) => domain.values[i]).filter(Boolean);
          return (
          <div key={lg.id}>
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
              onAddChild={() =>
                setAddingFor(addingFor === lg.id ? null : lg.id)
              }
              onDelete={() => deleteGoal(lg.id)}
              onRename={(title) => updateGoalTitle(lg.id, title)}
              onChangeTimeframe={(t) => updateGoalTimeframe(lg.id, t)}
              isComplete={!!lg.completedAt}
              onToggleComplete={() => toggleGoalComplete(lg.id)}
            />
            {domainGoals
              .filter((s) => s.parentGoalId === lg.id)
              .map((sg) => (
                <ShortWithActions
                  key={sg.id}
                  goal={sg}
                  displayValues={lgValues}
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
                />
              ))}
            {addingFor === lg.id && (
              <AddShortGoalForm
                domainValues={domain.values}
                forceOpen
                onClose={() => setAddingFor(null)}
                indent="short"
                onAdd={(title, months, vi) => addShortGoal(lg, title, months, vi)}
              />
            )}
          </div>
          );
        })}

        {looseShort
          .filter((sg) => !(hideCompleted && !!sg.completedAt))
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
          />
        ))}

        <AddShortGoalForm domainValues={domain.values} onAdd={addLooseShortGoal} />
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
}: {
  goal: Goal;
  displayValues: string[];
  habits: Habit[];
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
      />
      {habits
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
  const [startDate, setStartDate] = useState(initial?.startDate ?? '');
  const [customInterval, setCustomInterval] = useState(String(initial?.customInterval ?? 1));
  const [customUnit, setCustomUnit] = useState<CustomUnit>(initial?.customUnit ?? 'weeks');
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '');
  const [dueTime, setDueTime] = useState(initial?.dueTime ?? '');

  const submit = () => {
    if (!title.trim()) return;
    if (onSave) {
      if (kind === 'habit') {
        onSave({ title: title.trim(), kind, recurrence, startDate: startDate || undefined,
          customInterval: Number(customInterval) || 1, customUnit,
          dueDate: undefined, dueTime: undefined });
      } else {
        onSave({ title: title.trim(), kind, dueDate: dueDate || undefined,
          dueTime: dueTime || undefined, recurrence: undefined, startDate: undefined });
      }
    } else if (onAdd) {
      if (kind === 'habit') {
        onAdd(goalId, title, 'habit', { startDate, recurrence,
          customInterval: Number(customInterval) || 1, customUnit });
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

      <input
        autoFocus
        placeholder={kind === 'habit' ? 'e.g. Run' : 'e.g. Write the launch post'}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />

      {kind === 'habit' ? (
        <>
          <div className="field-row">
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
              <option value="daily">Daily</option>
              <option value="weekdays">Every weekday</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="custom">Custom…</option>
            </select>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} title="Start date" />
          </div>
          {recurrence === 'custom' && (
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
          )}
        </>
      ) : (
        <div className="field-row">
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} title="Due date" />
          <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} title="Due time" />
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
      <input
        autoFocus
        placeholder="e.g. Run a 5K"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
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
        {[1, 3, 6].map((m) => (
          <option key={m} value={m}>{m} Month{m > 1 ? 's' : ''}</option>
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
      <input
        autoFocus
        placeholder="e.g. Ship a product I fully own"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
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
}) {
  const canEditValues = !short && !!onEditValues;
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
    <div className={`${className}${short ? ' short' : ''}${isComplete ? ' completed' : ''}`} onClick={onClick}>
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
                : [1,3,6].map((m) => <option key={m} value={m}>{m} mo</option>)
              }
            </select>
          ) : (
            <span
              onClick={onChangeTimeframe ? (e) => { e.stopPropagation(); setEditingTimeframe(true); } : undefined}
              title={onChangeTimeframe ? 'Click to edit' : undefined}
              style={onChangeTimeframe ? { cursor: 'pointer', textDecoration: 'underline dotted' } : undefined}
            >
              {goal.horizon === 'long' ? `${goal.timeframe} yr` : `${goal.timeframe} mo`}
            </span>
          )}
        </div>
        {editingTitle ? (
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
  onReflect,
}: {
  habits: Habit[];
  setHabits: React.Dispatch<React.SetStateAction<Habit[]>>;
  goals: Goal[];
  domains: Domain[];
  onReflect: () => void;
}) {
  const done = habits.filter((h) => h.kind === 'task' ? !!h.completed : isHabitDoneThisPeriod(h)).length;
  const pct = habits.length ? Math.round((done / habits.length) * 100) : 0;

  const toggle = (id: string) => {
    setHabits((prev) => prev.map((h) => {
      if (h.id !== id) return h;
      const currentlyDone = h.kind === 'task' ? !!h.completed : isHabitDoneThisPeriod(h);
      const turningOn = !currentlyDone;
      return {
        ...h,
        doneToday: h.kind === 'habit' ? turningOn : h.doneToday,
        ...(h.kind === 'task' ? { completed: turningOn } : {}),
        ...(h.kind === 'habit'
          ? { streak: turningOn ? (h.streak || 0) + 1 : 0 }
          : {}),
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
          <span> / {habits.length} done</span>
        </div>
        <div className="bar">
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>

      {habits.map((h) => (
        <div className="habit-row" key={h.id}>
          <button
            className={`check${(h.kind === 'task' ? !!h.completed : isHabitDoneThisPeriod(h)) ? ' on' : ''}`}
            onClick={() => toggle(h.id)}
            aria-label="toggle"
          >
            <Tick />
          </button>
          <div>
            <div className={`habit-title${(h.kind === 'task' ? !!h.completed : isHabitDoneThisPeriod(h)) ? ' done' : ''}`}>
              {h.title}
            </div>
            <div className="habit-meta">
              {h.kind === 'task'
                ? `Task · ${getTaskCountdown(h)}`
                : getRecurrenceString(h)}
              &nbsp;·&nbsp; serves <b>{lineage(h.goalId)}</b>
            </div>
          </div>
        </div>
      ))}

      {new Date().getDay() === 0 && (
        <button className="reflect-prompt" onClick={onReflect}>
          It's Sunday — take two minutes to reflect on the week →
        </button>
      )}
    </div>
  );
}

/* ---------------- Reflect ---------------- */
function Reflect({
  domains,
  goals,
  onClose,
  onSave,
  initialScores,
  initialNote,
}: {
  domains: Domain[];
  goals: Goal[];
  onClose: () => void;
  onSave: (scores: Record<string, number>, note: string) => void;
  initialScores?: Record<string, number>;
  initialNote?: string;
}) {
  const [scores, setScores] = useState<Record<string, number>>(initialScores ?? {});
  const [note, setNote] = useState(initialNote ?? '');
  const [step, setStep] = useState<'score' | 'insight'>('score');

  const rows = domains.flatMap((d) =>
    d.values.map((v, i) => ({ d, v, i, key: `${d.id}:${i}` })),
  );

  const labelFor = (key: string) => {
    const [did, vi] = key.split(':');
    return domains.find((d) => d.id === did)?.values[Number(vi)] ?? key;
  };

  const handleSave = () => {
    onSave(scores, note);
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
  const atRisk = goals.filter((g) =>
    g.valueIndexes.some((vi) => {
      const key = `${g.domainId}:${vi}`;
      return (scores[key] ?? 3) < 2;
    }),
  );

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
        <h2>This week</h2>
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
    ? activeDoneItems.reduce((s, x) => s + x.r * x.w, 0) / activeDoneW
    : 0;
  const health = completionRate * recencyScore;

  const momentum = (completion + health) / 2;
  return { time: elapsed, completion, health, completionRate, recencyScore, momentum };
}

const DOMAIN_COLORS: Record<string, string> = {
  career: '#e8883c',      // orange
  self: '#4eb8e8',        // sky blue
  community: '#72ce6a',   // green
};

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
  if (N < 3) return null;
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
      {/* Grid rings */}
      {rings.map((t) => {
        const pts = topGoals.map((_, i) => pt(i, t));
        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';
        return <path key={t} d={d} fill="none" stroke="var(--line)" strokeWidth="1" />;
      })}
      {/* Domain-coloured spokes */}
      {topGoals.map((g, i) => {
        const end   = pt(i, 1);
        const color = DOMAIN_COLORS[g.domainId] ?? 'var(--line)';
        return <line key={i} x1={cx} y1={cy} x2={end.x} y2={end.y}
          stroke={color} strokeWidth="1.5" opacity="0.5" />;
      })}
      {/* Data polygon */}
      <polygon points={poly} fill="var(--accent)" fillOpacity="0.2" stroke="var(--accent)" strokeWidth="2" />
      {dataPoints.map((p, i) => {
        const color = DOMAIN_COLORS[topGoals[i].domainId] ?? 'var(--accent)';
        return <circle key={i} cx={p.x} cy={p.y} r="4" fill={color} />;
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
  const looseShort = goals.filter((g) => g.horizon === 'short' && !g.parentGoalId);
  const ltMetrics  = new Map(longGoals.map((g) => [g.id, vitalityFor(g, goals, habits)] as const));
  const stMetrics  = new Map(looseShort.map((g) => [g.id, stGoalMetrics(g, habits)] as const));

  const ltSpiderValues = longGoals.map((g) => ltMetrics.get(g.id)!.health);
  const stSpiderValues = looseShort.map((g) => stMetrics.get(g.id)!.health);

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

  return (
    <div className="review-panel">
      <div className="review-header">
        <h2>Goals</h2>
        <button className="icon-btn" onClick={onClose}>✕</button>
      </div>

      <div className="spider-carousel-wrapper">
        <div className="spider-pills">
          <button className={`spider-pill${activeSlide === 0 ? ' active' : ''}`} onClick={() => scrollToSlide(0)}>Long-term</button>
          <button className={`spider-pill${activeSlide === 1 ? ' active' : ''}`} onClick={() => scrollToSlide(1)}>Short-term</button>
        </div>
        <div className="spider-track" ref={trackRef} role="region" aria-label="Goal charts">
          <div className="spider-slide">
            {longGoals.length >= 3
              ? <DashSpider goals={longGoals} values={ltSpiderValues} />
              : <p className="spider-empty">Add at least 3 long-term goals to see this chart.</p>}
          </div>
          <div className="spider-slide">
            {looseShort.length >= 3
              ? <DashSpider goals={looseShort} values={stSpiderValues} />
              : <p className="spider-empty">Add at least 3 standalone short-term goals to see this chart.</p>}
          </div>
        </div>
        <div className="spider-dots">
          <button className={`spider-dot${activeSlide === 0 ? ' active' : ''}`} onClick={() => scrollToSlide(0)} aria-label="Long-term goals chart" />
          <button className={`spider-dot${activeSlide === 1 ? ' active' : ''}`} onClick={() => scrollToSlide(1)} aria-label="Short-term goals chart" />
        </div>
      </div>

      {domains.map((d) => {
        const dLong  = longGoals.filter((g) => g.domainId === d.id);
        const dShort = looseShort.filter((g) => g.domainId === d.id);
        if (!dLong.length && !dShort.length) return null;
        const domainColor = DOMAIN_COLORS[d.id] ?? 'var(--accent)';
        return (
          <div key={d.id} className="dash-domain-section">
            <div className="dash-domain-label" style={{ color: domainColor }}>{d.name}</div>
            {dLong.map((lg) => (
              <GoalStrip key={lg.id} goal={lg} metrics={ltMetrics.get(lg.id)!} domainColor={domainColor} />
            ))}
            {dShort.map((sg) => (
              <GoalStrip key={sg.id} goal={sg} metrics={stMetrics.get(sg.id)!} domainColor={domainColor} isShort />
            ))}
          </div>
        );
      })}

      <div className="dash-health-note">
        <div className="dash-health-note-title">How Health is calculated</div>
        <p>
          Health = <b>% done</b> × <b>how recently</b> — both must be high for a strong score.
        </p>
        <p style={{ marginTop: 6 }}>
          <b>Long-term goals</b> — driven by short-term sub-goals <b>(10×)</b>, tasks <b>(2×)</b>, and habits <b>(1–4×)</b>. The LT goal's own completion appears in the Done bar.
        </p>
        <p style={{ marginTop: 6 }}>
          <b>Short-term goals</b> — driven by tasks <b>(2×)</b> and habits <b>(1–4×)</b>. The goal's own completion appears in the Done bar.
        </p>
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

/* ---------------- ValueLineChart ---------------- */
function ValueLineChart({
  valueKey,
  reflections,
  color,
}: {
  valueKey: string;
  reflections: ReflectionEntry[];
  color: string;
}) {
  const points = reflections
    .filter((r) => r.scores[valueKey] !== undefined)
    .sort((a, b) => a.date - b.date);

  if (!points.length) {
    return <p className="chart-empty">No data yet</p>;
  }

  const W = 280, H = 82, PL = 6, PR = 6, PT = 8, PB = 16;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;
  const n = points.length;

  // Equal index-based spacing — right for weekly data, avoids same-day collapse
  const cx = (i: number) =>
    n === 1 ? PL + chartW / 2 : PL + (i / (n - 1)) * chartW;
  const cy = (i: number) =>
    PT + chartH - (points[i].scores[valueKey] / 3) * chartH;

  const linePath = points
    .map((_, i) => `${i === 0 ? 'M' : 'L'}${cx(i).toFixed(1)},${cy(i).toFixed(1)}`)
    .join(' ');

  const areaPath =
    linePath +
    ` L${cx(n - 1).toFixed(1)},${(PT + chartH).toFixed(1)}` +
    ` L${cx(0).toFixed(1)},${(PT + chartH).toFixed(1)} Z`;

  // Only label every Nth dot so text doesn't overlap on dense charts
  const labelEvery = n <= 6 ? 1 : n <= 12 ? 2 : 3;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="value-line-chart">
      {/* gridlines */}
      {[0, 1, 2, 3].map((v) => {
        const y = PT + chartH - (v / 3) * chartH;
        return (
          <line key={v} x1={PL} y1={y} x2={W - PR} y2={y}
            stroke="var(--line)" strokeWidth={v === 0 ? 1 : 0.5}
            strokeDasharray={v > 0 ? '3 3' : ''} />
        );
      })}
      {/* area */}
      <path d={areaPath} fill={color} fillOpacity="0.12" />
      {/* line */}
      {n > 1 && (
        <path d={linePath} fill="none" stroke={color} strokeWidth="2"
          strokeLinejoin="round" strokeLinecap="round" />
      )}
      {/* dots */}
      {points.map((_, i) => (
        <circle key={i} cx={cx(i)} cy={cy(i)} r="3.5" fill={color} />
      ))}
      {/* date label under every Nth dot */}
      {points.map((p, i) => {
        if (i % labelEvery !== 0 && i !== n - 1) return null;
        const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
        return (
          <text key={i} x={cx(i)} y={H - 3} textAnchor={anchor}
            fontSize="6.5" fill="var(--muted)">
            {formatReviewDate(p.date)}
          </text>
        );
      })}
    </svg>
  );
}

/* ---------------- RadarChart ---------------- */
function RadarChart({
  domains,
  reflections,
}: {
  domains: Domain[];
  reflections: ReflectionEntry[];
}) {
  const axes = domains.flatMap((d) =>
    d.values.map((v, i) => ({
      label: v,
      key: `${d.id}:${i}`,
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
  const dataPoints = axes.map((ax, i) => pt(i, decayedAvg(ax.key, reflections) / 3));
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

function formatReviewDate(ts: number): string {
  const d = new Date(ts);
  return `${REVIEW_MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

function formatReviewDateFull(ts: number): string {
  const d = new Date(ts);
  return `${REVIEW_MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function ReviewPanel({
  domains,
  goals,
  reflections,
  onReset,
  onClose,
}: {
  domains: Domain[];
  goals: Goal[];
  reflections: ReflectionEntry[];
  onReset: () => void;
  onClose: () => void;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  const latest = reflections[reflections.length - 1];

  const atRiskGoals = latest
    ? goals.filter(
        (g) =>
          g.horizon === 'long' &&
          g.valueIndexes.some((vi) => {
            const key = `${g.domainId}:${vi}`;
            return (latest.scores[key] ?? 3) < 2;
          }),
      )
    : [];

  return (
    <div className="review-panel">
      <div className="review-header">
        <h2>Reflection</h2>
        <div className="review-header-actions">
          {reflections.length > 0 && (
            confirmReset ? (
              <div className="review-reset-confirm">
                <span>Delete all {reflections.length} entries?</span>
                <button className="review-reset-yes" onClick={() => { onReset(); setConfirmReset(false); }}>Delete</button>
                <button className="review-reset-cancel" onClick={() => setConfirmReset(false)}>Cancel</button>
              </div>
            ) : (
              <button className="review-reset-btn" onClick={() => setConfirmReset(true)}>Reset</button>
            )
          )}
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
      </div>

      {reflections.length === 0 ? (
        <p className="review-empty">No reflections yet. Check in on Sunday.</p>
      ) : (
        <>
          {/* Radar chart */}
          <div className="radar-wrap">
            <RadarChart domains={domains} reflections={reflections} />
          </div>

          {/* Domain-grouped value breakdown */}
          <div className="review-values-section">
            {domains.map((d) => {
              const domainColor = DOMAIN_COLORS[d.id] ?? 'var(--accent)';
              if (!d.values.length) return null;
              return (
                <div key={d.id} className="review-value-domain-group">
                  <div className="review-value-domain-header" style={{ color: domainColor }}>
                    {d.name}
                  </div>
                  {d.values.map((v, vi) => {
                    const key = `${d.id}:${vi}`;
                    const avg = decayedAvg(key, reflections);
                    const pct = avg / 3;
                    const isOpen = selectedKey === key;
                    return (
                      <div key={key} className="review-value-row">
                        <button
                          className={`review-value-btn${isOpen ? ' open' : ''}`}
                          onClick={() => setSelectedKey(isOpen ? null : key)}
                        >
                          <span className="review-value-name">{v}</span>
                          <div className="review-value-bar-wrap">
                            <div
                              className="review-value-bar"
                              style={{ width: `${Math.round(pct * 100)}%`, background: domainColor }}
                            />
                          </div>
                          <span className="review-value-score">{avg.toFixed(1)}</span>
                          <span className="review-value-chevron">{isOpen ? '▴' : '▾'}</span>
                        </button>
                        {isOpen && (
                          <div className="review-value-chart">
                            <ValueLineChart
                              valueKey={key}
                              reflections={reflections}
                              color={domainColor}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            <div className="review-decay-note">
              Scores weighted by recency — recent weeks count more
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

          {/* Full log */}
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
                      const hasScores = d.values.some((_, vi) => r.scores[`${d.id}:${vi}`] != null);
                      if (!hasScores) return null;
                      return (
                        <div key={d.id} className="review-log-domain">
                          <div className="review-log-domain-label" style={{ color }}>{d.name}</div>
                          {d.values.map((v, vi) => {
                            const score = r.scores[`${d.id}:${vi}`];
                            if (score == null) return null;
                            return (
                              <div key={vi} className="review-log-value-row">
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
function isHabitDoneThisPeriod(h: Habit): boolean {
  if (!h.completedAt) return false;
  const now = new Date();
  const done = new Date(h.completedAt);
  const sameDay =
    done.getFullYear() === now.getFullYear() &&
    done.getMonth() === now.getMonth() &&
    done.getDate() === now.getDate();

  switch (h.recurrence ?? 'daily') {
    case 'daily':
      return sameDay;
    case 'weekdays':
      return sameDay && now.getDay() !== 0 && now.getDay() !== 6;
    case 'weekly':
      return (
        getISOWeek(done) === getISOWeek(now) &&
        done.getFullYear() === now.getFullYear()
      );
    case 'monthly':
      return (
        done.getFullYear() === now.getFullYear() &&
        done.getMonth() === now.getMonth()
      );
    case 'yearly':
      return done.getFullYear() === now.getFullYear();
    case 'custom': {
      const unit = h.customUnit ?? 'weeks';
      const interval = Math.max(1, h.customInterval ?? 1);
      const windowMs =
        unit === 'days'   ? interval * 86_400_000 :
        unit === 'weeks'  ? interval * 7 * 86_400_000 :
        unit === 'months' ? interval * 30.44 * 86_400_000 :
        /* years */         interval * 365.25 * 86_400_000;
      return Date.now() - h.completedAt < windowMs;
    }
    default:
      return sameDay;
  }
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
