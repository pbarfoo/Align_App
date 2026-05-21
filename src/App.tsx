import React, { useEffect, useMemo, useState } from 'react';
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

type Tab = 'foundation' | 'align' | 'today';

interface ActionInput {
  startDate?: string;
  recurrence?: Recurrence;
  customInterval?: number;
  customUnit?: CustomUnit;
  dueDate?: string;
  dueTime?: string;
}

const DOMAINS_KEY = 'align-domains-v1';
const GOALS_KEY = 'align-goals-v1';
const HABITS_KEY = 'align-habits-v1';
const REFLECTIONS_KEY = 'align-reflections-v1';
const TAB_KEY = 'align-tab-v1';

function loadOr<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>(() => loadOr<Tab>(TAB_KEY, 'align'));
  const [domains, setDomains] = useState<Domain[]>(() => loadOr(DOMAINS_KEY, seedDomains));
  const [goals, setGoals] = useState<Goal[]>(() => loadOr(GOALS_KEY, initialGoals));
  const [habits, setHabits] = useState<Habit[]>(() => loadOr(HABITS_KEY, initialHabits));
  const [reflectOpen, setReflectOpen] = useState(false);
  const [reflections, setReflections] = useState<ReflectionEntry[]>(() =>
    dedupeByWeek(loadOr<ReflectionEntry[]>(REFLECTIONS_KEY, [])),
  );

  useEffect(() => {
    localStorage.setItem(DOMAINS_KEY, JSON.stringify(domains));
  }, [domains]);
  useEffect(() => {
    localStorage.setItem(GOALS_KEY, JSON.stringify(goals));
  }, [goals]);
  useEffect(() => {
    localStorage.setItem(HABITS_KEY, JSON.stringify(habits));
  }, [habits]);
  useEffect(() => {
    localStorage.setItem(REFLECTIONS_KEY, JSON.stringify(reflections));
  }, [reflections]);
  useEffect(() => {
    localStorage.setItem(TAB_KEY, JSON.stringify(tab));
  }, [tab]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  return (
    <div className="app">
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
          onReset={() => setReflections([])}
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
}: {
  domains: Domain[];
  goals: Goal[];
  setGoals: React.Dispatch<React.SetStateAction<Goal[]>>;
  habits: Habit[];
  setHabits: React.Dispatch<React.SetStateAction<Habit[]>>;
  flash: (m: string) => void;
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

  const addShortGoal = (parent: Goal, title: string, months: number) => {
    setGoals((prev) => [...prev, {
      id: uid('g'),
      domainId,
      valueIndexes: [],
      horizon: 'short' as const,
      title,
      parentGoalId: parent.id,
      createdAt: Date.now(),
      timeframe: months,
    }]);
    setAddingFor(null);
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

  const deleteGoal = (id: string) => {
    setGoals((prev) => {
      const remove = new Set<string>([id]);
      prev.forEach((g) => {
        if (g.parentGoalId && remove.has(g.parentGoalId)) remove.add(g.id);
      });
      if (addingFor && remove.has(addingFor)) setAddingFor(null);
      setHabits((ph) => ph.filter((h) => !remove.has(h.goalId)));
      return prev.filter((g) => !remove.has(g.id));
    });
    flash('Deleted');
  };

  const deleteHabit = (id: string) => {
    setHabits((prev) => prev.filter((h) => h.id !== id));
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
                  onDeleteHabit={deleteHabit}
                  onToggleGoalComplete={toggleGoalComplete}
                  onToggleHabit={toggleHabit}
                  hideCompleted={hideCompleted}
                />
              ))}
            {addingFor === lg.id && (
              <InlineAdd
                indent="short"
                forceOpen
                onClose={() => setAddingFor(null)}
                fields={[
                  {
                    key: 'title',
                    placeholder: 'e.g. Run 3x a week through spring',
                  },
                  {
                    key: 'timeframe',
                    type: 'select',
                    options: [
                      { label: '1 Month', value: '1' },
                      { label: '3 Months', value: '3' },
                      { label: '6 Months', value: '6' },
                    ],
                  },
                ]}
                onSubmit={(v) =>
                  addShortGoal(lg, v.title, Number(v.timeframe ?? '1'))
                }
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
            onDeleteHabit={deleteHabit}
            onToggleGoalComplete={toggleGoalComplete}
            onToggleHabit={toggleHabit}
            hideCompleted={hideCompleted}
          />
        ))}

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
  onDeleteHabit,
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
  onDeleteHabit: (id: string) => void;
  onToggleGoalComplete: (id: string) => void;
  onToggleHabit: (id: string) => void;
  hideCompleted: boolean;
}) {
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
          <div
            key={h.id}
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
              <div className="node-title">{h.title}</div>
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
  onClose,
}: {
  goalId: string;
  onAdd: (
    goalId: string,
    title: string,
    kind: ActionKind,
    input: ActionInput,
  ) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<ActionKind>('habit');
  const [title, setTitle] = useState('');
  const [recurrence, setRecurrence] = useState<Recurrence>('daily');
  const [startDate, setStartDate] = useState('');
  const [customInterval, setCustomInterval] = useState('1');
  const [customUnit, setCustomUnit] = useState<CustomUnit>('weeks');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');

  const submit = () => {
    if (!title.trim()) return;
    if (kind === 'habit') {
      onAdd(goalId, title, 'habit', {
        startDate,
        recurrence,
        customInterval: Number(customInterval) || 1,
        customUnit,
      });
    } else {
      onAdd(goalId, title, 'task', { dueDate, dueTime });
    }
  };

  return (
    <div className="inline-add habit add-form">
      <div className="seg">
        <button
          type="button"
          className={kind === 'habit' ? 'on' : ''}
          onClick={() => setKind('habit')}
        >
          Habit
        </button>
        <button
          type="button"
          className={kind === 'task' ? 'on' : ''}
          onClick={() => setKind('task')}
        >
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
            <select
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value as Recurrence)}
            >
              <option value="daily">Daily</option>
              <option value="weekdays">Every weekday</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="custom">Custom…</option>
            </select>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              title="Start date"
            />
          </div>
          {recurrence === 'custom' && (
            <div className="field-row">
              <span className="field-label">Every</span>
              <input
                type="number"
                min="1"
                max="99"
                value={customInterval}
                onChange={(e) => setCustomInterval(e.target.value)}
                style={{ width: '64px' }}
              />
              <select
                value={customUnit}
                onChange={(e) => setCustomUnit(e.target.value as CustomUnit)}
              >
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
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            title="Due date"
          />
          <input
            type="time"
            value={dueTime}
            onChange={(e) => setDueTime(e.target.value)}
            title="Due time"
          />
        </div>
      )}

      <div className="add-actions">
        <button className="mini-primary" onClick={submit}>
          Add
        </button>
        <button className="mini-ghost" onClick={onClose}>
          Cancel
        </button>
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
  editValuesActive?: boolean;
  onEditValues?: () => void;
  onChangeValues?: (idxs: number[]) => void;
  isComplete?: boolean;
  onToggleComplete?: () => void;
}) {
  const canEditValues = !short && !!onEditValues;
  const idxs = valueIndexes ?? [];

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
          {goal.horizon === 'long'
            ? `Long-term · ${goal.timeframe} yr`
            : `Short-term · ${goal.timeframe} mo`}
        </div>
        <div className="node-title">{goal.title}</div>
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

type Field = {
  key: string;
  type?: 'text' | 'date' | 'select';
  placeholder?: string;
  options?: { label: string; value: string }[];
};

function InlineAdd({
  label,
  fields,
  onSubmit,
  indent,
  forceOpen,
  onClose,
}: {
  label?: string;
  fields: Field[];
  onSubmit: (values: Record<string, string>) => void;
  indent?: 'short' | 'habit';
  forceOpen?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});

  const isOpen = forceOpen || open;

  const close = () => {
    setValues({});
    if (forceOpen) onClose?.();
    else setOpen(false);
  };

  const submit = () => {
    if (!values.title || !values.title.trim()) return;
    onSubmit(values);
    close();
  };

  const cls = `inline-add${indent ? ` ${indent}` : ''}`;

  if (!isOpen) {
    return (
      <button className={`${cls} add-btn`} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  return (
    <div className={`${cls} add-form`}>
      {fields.map((f) =>
        f.type === 'select' ? (
          <select
            key={f.key}
            value={values[f.key] ?? f.options?.[0]?.value ?? ''}
            onChange={(e) =>
              setValues((v) => ({ ...v, [f.key]: e.target.value }))
            }
          >
            {f.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            key={f.key}
            autoFocus={f.key === 'title'}
            type={f.type === 'date' ? 'date' : 'text'}
            placeholder={f.placeholder}
            value={values[f.key] ?? ''}
            onChange={(e) =>
              setValues((v) => ({ ...v, [f.key]: e.target.value }))
            }
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        ),
      )}
      <div className="add-actions">
        <button className="mini-primary" onClick={submit}>
          Add
        </button>
        <button className="mini-ghost" onClick={close}>
          Cancel
        </button>
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
      <div className="scrim" onClick={onClose}>
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
    <div className="scrim" onClick={onClose}>
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

  // Health bar: completionRate × recencyScore over ACTIVE items only
  // (LT goal excluded — it can't be realistically "done" until years from now)
  const activeItems     = allItems.slice(1); // drop LT goal entry
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
  career: '#d4836a',      // coral
  self: '#6ab8c8',        // teal
  community: '#a96ac8',   // violet
};

function DashSpider({
  longGoals,
  values,
}: {
  longGoals: Goal[];
  values: number[];
}) {
  const N = longGoals.length;
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
    <svg viewBox="0 0 320 350" className="radar-chart">
      {/* Grid rings */}
      {rings.map((t) => {
        const pts = longGoals.map((_, i) => pt(i, t));
        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';
        return <path key={t} d={d} fill="none" stroke="var(--line)" strokeWidth="1" />;
      })}
      {/* Domain-coloured spokes */}
      {longGoals.map((g, i) => {
        const end   = pt(i, 1);
        const color = DOMAIN_COLORS[g.domainId] ?? 'var(--line)';
        return <line key={i} x1={cx} y1={cy} x2={end.x} y2={end.y}
          stroke={color} strokeWidth="1.5" opacity="0.5" />;
      })}
      {/* Data polygon */}
      <polygon points={poly} fill="var(--accent)" fillOpacity="0.2" stroke="var(--accent)" strokeWidth="2" />
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="4" fill={DOMAIN_COLORS[longGoals[i].domainId] ?? 'var(--accent)'} />
      ))}
      {/* Labels: goal title only, coloured by domain */}
      {longGoals.map((g, i) => {
        const color = DOMAIN_COLORS[g.domainId] ?? 'var(--muted)';
        const lp    = pt(i, 1.34);
        const anchor = labelAnchor(i);
        const title  = g.title.length > 18 ? g.title.slice(0, 17) + '…' : g.title;
        return (
          <text key={i} x={lp.x} y={lp.y} textAnchor={anchor} dominantBaseline="middle"
            fontSize="11" fill={color}>
            {title}
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
}: {
  goal: Goal;
  metrics: { time: number; completion: number; health: number; completionRate: number; recencyScore: number };
  domainColor?: string;
}) {
  const [showInfo, setShowInfo] = useState(false);
  const countdown    = getGoalCountdown(goal);
  const completePct  = Math.round(metrics.completion * 100);
  const healthPct    = Math.round(metrics.health * 100);
  const donePct      = Math.round(metrics.completionRate * 100);
  const freshPct     = Math.round(metrics.recencyScore * 100);
  return (
    <div className="goal-strip">
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
            <span><b>10×</b> Short-term goal</span>
            <span><b>2×</b> Task</span>
            <span><b>1–4×</b> Habit (streak scales weight)</span>
          </div>
          <div className="health-popup-note">
            ST goals, tasks &amp; habits only. Completion × recency — both must be high. Habits with longer streaks stay fresh longer.
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
  const longGoals = goals.filter((g) => g.horizon === 'long');
  const metricsByGoal = new Map(
    longGoals.map((g) => [g.id, vitalityFor(g, goals, habits)] as const),
  );
  const spiderValues = longGoals.map((g) => metricsByGoal.get(g.id)!.health);

  return (
    <div className="review-panel">
      <div className="review-header">
        <h2>Goals</h2>
        <button className="icon-btn" onClick={onClose}>✕</button>
      </div>

      <DashSpider longGoals={longGoals} values={spiderValues} />

      {domains.map((d) => {
        const dLong = longGoals.filter((g) => g.domainId === d.id);
        if (!dLong.length) return null;
        const domainColor = DOMAIN_COLORS[d.id] ?? 'var(--accent)';
        return (
          <div key={d.id} className="dash-domain-section">
            <div className="dash-domain-label" style={{ color: domainColor }}>{d.name}</div>
            {dLong.map((lg) => (
              <GoalStrip
                key={lg.id}
                goal={lg}
                metrics={metricsByGoal.get(lg.id)!}
                domainColor={domainColor}
              />
            ))}
          </div>
        );
      })}

      <div className="dash-health-note">
        <div className="dash-health-note-title">How Health is calculated</div>
        <p>
          Health = <b>% of active items done</b> × <b>how recently</b> you did them. Both must be high for a strong score. The long-term goal is excluded — use the Done bar for that.
        </p>
        <div className="dash-health-weights">
          <span><b>10×</b> Short-term goal</span>
          <span><b>2×</b> Task</span>
          <span><b>1–4×</b> Habit (streak grows weight &amp; extends freshness window)</span>
        </div>
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
    <svg viewBox="0 0 320 310" className="radar-chart">
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
        return (
          <text key={i} x={lp.x} y={lp.y} textAnchor={labelAnchor(i)}
            dominantBaseline="middle" fontSize="10" fill={ax.color} opacity="0.9">
            {ax.label}
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
/** Collapse entries that share a week+year, keeping the most recent. One reflection per week. */
function dedupeByWeek(entries: ReflectionEntry[]): ReflectionEntry[] {
  const byKey = new Map<string, ReflectionEntry>();
  for (const e of entries) {
    const key = `${new Date(e.date).getFullYear()}-${e.weekNumber}`;
    const existing = byKey.get(key);
    if (!existing || e.date > existing.date) byKey.set(key, e);
  }
  return [...byKey.values()].sort((a, b) => a.date - b.date);
}

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
