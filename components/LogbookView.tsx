'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Session, UserProfile } from '@/lib/supabase';
import StudyChart from './StudyChart';

const pad = (n: number) => String(n).padStart(2, '0');
const fmtDateISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function minutesToLabel(mins: number) {
  mins = Math.max(0, Math.round(mins));
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h}h ${pad(m)}m`;
}
function hoursShort(mins: number) {
  return (mins / 60).toFixed(1) + 'h';
}
function durationMinutes(s: Session) {
  return Math.max(0, Math.round((new Date(s.end).getTime() - new Date(s.start).getTime()) / 60000));
}

// Circular ring gauge — used for the per-goal stat cards
const RING_R = 32;
const RING_C = 2 * Math.PI * RING_R;
function ringDashoffset(pct: number) {
  const clamped = Math.max(0, Math.min(100, pct));
  return RING_C * (1 - clamped / 100);
}
function Ring({ pct, value, label, accent }: { pct: number; value: string; label: string; accent: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flex: '1 1 68px', minWidth: 68 }}>
      <svg width="72" height="72" viewBox="0 0 76 76">
        <circle cx="38" cy="38" r={RING_R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
        <circle
          cx="38" cy="38" r={RING_R} fill="none"
          stroke={accent} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={RING_C} strokeDashoffset={ringDashoffset(pct)}
          transform="rotate(-90 38 38)"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
        <text x="38" y="43" textAnchor="middle" fill="var(--paper)" fontSize={value.length > 4 ? 12 : 14} fontWeight={700}>{value}</text>
      </svg>
      <span style={{ color: 'var(--muted)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'center' }}>{label}</span>
    </div>
  );
}

// Subject goal colors — cycling through these for each goal pill
const SUBJECT_COLORS = [
  { bg: 'rgba(100,200,150,0.12)', border: 'rgba(100,200,150,0.45)', accent: '#64c896', label: 'sage' },
  { bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.45)',  accent: '#fbbf24', label: 'amber' },
  { bg: 'rgba(139,92,246,0.12)',  border: 'rgba(139,92,246,0.45)',  accent: '#8b5cf6', label: 'violet' },
  { bg: 'rgba(244,113,113,0.12)', border: 'rgba(244,113,113,0.45)', accent: '#f47171', label: 'brick' },
  { bg: 'rgba(56,189,248,0.12)',  border: 'rgba(56,189,248,0.45)',  accent: '#38bdf8', label: 'sky' },
];

interface SubjectGoal {
  id: string;
  name: string;
  totalHrs: string;
  deadline: string;
}

function makeGoalId() {
  return Math.random().toString(36).slice(2, 8);
}

export default function LogbookView({ user, profile, onProfileUpdate }: {
  user: User;
  profile: UserProfile;
  onProfileUpdate: () => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerStart, setTimerStart] = useState<number | null>(null);
  const [timerDisplay, setTimerDisplay] = useState('00:00:00');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const actionLockRef = useRef(false);

  const [entryDate, setEntryDate] = useState(fmtDateISO(new Date()));
  const [entryStart, setEntryStart] = useState('');
  const [entryEnd, setEntryEnd] = useState('');
  const [entryNote, setEntryNote] = useState('');
  const [entrySubject, setEntrySubject] = useState('');
  const [range, setRange] = useState(14);

  const [timerSubject, setTimerSubject] = useState('');
  const [showSubjectPicker, setShowSubjectPicker] = useState(false);

  const [dailyTarget, setDailyTarget] = useState(profile.daily_target_hrs ?? 4);

  // Multi-subject goals
  const [goals, setGoals] = useState<SubjectGoal[]>(() => {
    const saved = (profile as any).goals;
    if (Array.isArray(saved) && saved.length > 0) return saved;
    // Migrate legacy single goal
    if (profile.goal_total_hrs || profile.goal_deadline) {
      return [{
        id: makeGoalId(),
        name: 'Study',
        totalHrs: profile.goal_total_hrs?.toString() ?? '',
        deadline: profile.goal_deadline ?? '',
      }];
    }
    return [{ id: makeGoalId(), name: 'Study', totalHrs: '', deadline: '' }];
  });

  const [todayISO, setTodayISO] = useState(fmtDateISO(new Date()));

  useEffect(() => {
    const now = new Date();
    const msUntilMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
    const t = setTimeout(() => setTodayISO(fmtDateISO(new Date())), msUntilMidnight);
    return () => clearTimeout(t);
  }, [todayISO]);

  const fetchSessions = useCallback(async () => {
    const { data } = await supabase
      .from('sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('start', { ascending: false });
    if (data) setSessions(data as Session[]);
    setLoading(false);
  }, [user.id]);

  useEffect(() => {
    fetchSessions();
    const channel = supabase
      .channel(`sessions_user_${user.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'sessions',
        filter: `user_id=eq.${user.id}`
      }, () => fetchSessions())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user.id, fetchSessions]);

  useEffect(() => {
    async function restoreTimer() {
      const { data } = await supabase
        .from('active_sessions')
        .select('start_time')
        .eq('user_id', user.id)
        .single();
      if (data?.start_time) {
        const startMs = new Date(data.start_time).getTime();
        if (startMs > 0 && startMs < Date.now()) {
          setTimerStart(startMs);
          setTimerRunning(true);
          localStorage.setItem('logbook_active_timer', JSON.stringify({ start: startMs }));
          return;
        }
      }
      const saved = localStorage.getItem('logbook_active_timer');
      if (saved) {
        try {
          const { start, subject } = JSON.parse(saved);
          const hoursElapsed = (Date.now() - start) / (1000 * 60 * 60);
if (typeof start === 'number' && start > 0 && start < Date.now() && hoursElapsed < 12) {
            setTimerStart(start);
            setTimerRunning(true);
            if (subject) setTimerSubject(subject);
          } else {
            localStorage.removeItem('logbook_active_timer');
          }
        } catch {
          localStorage.removeItem('logbook_active_timer');
        }
      }
    }
    restoreTimer();
  }, [user.id]);

  useEffect(() => {
    const channel = supabase
      .channel(`active_session_${user.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'active_sessions',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const startMs = new Date((payload.new as { start_time: string }).start_time).getTime();
          setTimerStart(startMs);
          setTimerRunning(true);
        } else if (payload.eventType === 'DELETE') {
          setTimerRunning(false);
          setTimerStart(null);
          setTimerDisplay('00:00:00');
          localStorage.removeItem('logbook_active_timer');
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user.id]);

  useEffect(() => {
    if (timerRunning && timerStart) {
      const tick = () => {
        const elapsed = Math.floor((Date.now() - timerStart) / 1000);
        const h = Math.floor(elapsed / 3600);
        const m = Math.floor((elapsed % 3600) / 60);
        const s = elapsed % 60;
        setTimerDisplay(`${pad(h)}:${pad(m)}:${pad(s)}`);
      };
      tick();
      timerRef.current = setInterval(tick, 1000);
    } else {
      setTimerDisplay('00:00:00');
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning, timerStart]);

  async function startTimer() {
  if (actionLockRef.current) return;
  actionLockRef.current = true;
  try {
    const now = new Date();
    const nowMs = now.getTime();
    await supabase.from('active_sessions').upsert({ user_id: user.id, start_time: now.toISOString() });
    setTimerStart(nowMs);
    setTimerRunning(true);
    localStorage.setItem('logbook_active_timer', JSON.stringify({ start: nowMs, subject: timerSubject }));
  } finally {
    actionLockRef.current = false;
  }
}

  async function stopTimer() {
  if (actionLockRef.current) return;
  actionLockRef.current = true;
  try {
    const endDate = new Date();
    const { data: activeData } = await supabase
      .from('active_sessions').select('start_time').eq('user_id', user.id).single();
    const realStart = activeData?.start_time ? new Date(activeData.start_time).getTime() : timerStart;
    if (!realStart) return;
    const startDate = new Date(realStart);
    setTimerRunning(false);
    setTimerStart(null);
    localStorage.removeItem('logbook_active_timer');
    await supabase.from('active_sessions').delete().eq('user_id', user.id);
    await addSession({
      date: fmtDateISO(startDate),
      startISO: startDate.toISOString(),
      endISO: endDate.toISOString(),
      note: '',
      subject: timerSubject,
    });
    setTimerSubject('');
  } finally {
    actionLockRef.current = false;
  }
}

  async function addSession({ date, startISO, endISO, note, subject }: {
    date: string; startISO: string; endISO: string; note: string; subject: string;
  }) {
    const dur = Math.max(0, Math.round((new Date(endISO).getTime() - new Date(startISO).getTime()) / 60000));
    await supabase.from('sessions').insert({
      user_id: user.id,
      username: profile.username,
      date,
      start: startISO,
      end: endISO,
      note: note || '',
      duration_minutes: dur,
      subject: subject || '',
    });
  }

  async function deleteSession(id: string) {
    if (!confirm('Delete this session? This cannot be undone.')) return;
    await supabase.from('sessions').delete().eq('id', id).eq('user_id', user.id);
  }

  async function handleAddEntry() {
    if (!entryDate || !entryStart || !entryEnd) { alert('Enter a date, start time, and end time.'); return; }
    const [year, month, day] = entryDate.split('-').map(Number);
    const [startHr, startMin] = entryStart.split(':').map(Number);
    const [endHr, endMin] = entryEnd.split(':').map(Number);
    const startDate = new Date(year, month - 1, day, startHr, startMin, 0);
    let endDate = new Date(year, month - 1, day, endHr, endMin, 0);
    if (endDate <= startDate) endDate = new Date(year, month - 1, day + 1, endHr, endMin, 0);
    const now = new Date();
    if (startDate > now) { alert('Start time cannot be in the future.'); return; }
    if (endDate > now) { alert('End time cannot be in the future.'); return; }
    const sameDaySessions = sessions.filter(s => s.date === entryDate);
    const hasOverlap = sameDaySessions.some(s => {
      const existStart = new Date(s.start).getTime();
      const existEnd = new Date(s.end).getTime();
      return startDate.getTime() < existEnd && endDate.getTime() > existStart;
    });
    if (hasOverlap) { alert('This session overlaps with an existing session on that day. Please check your times.'); return; }
    await addSession({
      date: entryDate,
      startISO: startDate.toISOString(),
      endISO: endDate.toISOString(),
      note: entryNote.trim(),
      subject: entrySubject,
    });
    setEntryStart(''); setEntryEnd(''); setEntryNote('');
  }

  const [targetsSaved, setTargetsSaved] = useState(false);
  const [showAddSession, setShowAddSession] = useState(false);
  const [showGoalEditor, setShowGoalEditor] = useState(false);
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());
  const [showLog, setShowLog] = useState(false);

  function toggleDate(date: string) {
    setCollapsedDates(prev => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });
  }
  async function saveTargets() {
    await supabase.from('profiles').update({
      daily_target_hrs: dailyTarget,
      goals: goals,
      // keep legacy columns in sync with first goal for backwards compat
      goal_total_hrs: goals[0]?.totalHrs ? parseFloat(goals[0].totalHrs) : null,
      goal_deadline: goals[0]?.deadline || null,
    }).eq('id', user.id);
    onProfileUpdate();
    setTargetsSaved(true);
    setTimeout(() => setTargetsSaved(false), 2000);
  }

  function updateGoal(id: string, field: keyof SubjectGoal, value: string) {
    setGoals(prev => prev.map(g => g.id === id ? { ...g, [field]: value } : g));
  }

  function addGoal() {
    if (goals.length >= 5) return;
    setGoals(prev => [...prev, { id: makeGoalId(), name: '', totalHrs: '', deadline: '' }]);
  }

  async function removeGoal(id: string) {
    if (goals.length <= 1) return;
    if (!confirm('Delete this goal? This cannot be undone.')) return;
const updatedGoals = goals.filter(g => g.id !== id);
    setGoals(updatedGoals);
    await supabase.from('profiles').update({
      goals: updatedGoals,
      goal_total_hrs: updatedGoals[0]?.totalHrs ? parseFloat(updatedGoals[0].totalHrs) : null,
      goal_deadline: updatedGoals[0]?.deadline || null,
    }).eq('id', user.id);
    onProfileUpdate();
  }

  // Derived stats
  const todaySessions = sessions.filter(s => s.date === todayISO);
  const todayMins = todaySessions.reduce((sum, s) => sum + durationMinutes(s), 0);
  const allMins = sessions.reduce((sum, s) => sum + durationMinutes(s), 0);
  const targetMins = (dailyTarget || 0) * 60;
  const progressPct = targetMins > 0 ? Math.min(100, Math.round((todayMins / targetMins) * 100)) : 0;

  // Per-goal stats
  function goalStats(goal: SubjectGoal) {
    const subjectSessions = goal.name
      ? sessions.filter(s => ((s as any).subject || '').toLowerCase() === goal.name.toLowerCase())
      : sessions;
    const subjectMins = subjectSessions.reduce((sum, s) => sum + durationMinutes(s), 0);
    const goalMins = goal.totalHrs ? parseFloat(goal.totalHrs) * 60 : 0;
    const goalPct = goalMins > 0 ? Math.min(999, Math.round((subjectMins / goalMins) * 100)) : 0;
    let daysLeft: number | null = null;
    let neededPerDay: number | null = null;
    if (goal.deadline) {
      const today0 = new Date(); today0.setHours(0, 0, 0, 0);
      const deadline = new Date(goal.deadline + 'T00:00:00');
      daysLeft = Math.ceil((deadline.getTime() - today0.getTime()) / 86400000);
      const remainingMins = Math.max(0, goalMins - subjectMins);
      if (daysLeft > 0) neededPerDay = remainingMins / daysLeft;
      else if (daysLeft === 0) neededPerDay = remainingMins;
    }
    return { subjectMins, goalMins, goalPct, daysLeft, neededPerDay };
  }

  // Unique subjects from goals for the session dropdown
  const subjectOptions = goals.map(g => g.name).filter(Boolean);

  // Group sessions by date
  const byDate: Record<string, Session[]> = {};
  sessions.forEach(s => { (byDate[s.date] = byDate[s.date] || []).push(s); });
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a)).slice(0, 14);

  return (
    <>
      {/* HERO */}
      <div className="hero" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '32px 28px 30px', position: 'relative', overflow: 'hidden' }}>

        {/* Big total number inside a pill capsule */}
        {(() => {
          const label = minutesToLabel(todayMins);
          const [hrsPart, minsPart] = label.split(' ');
          return (
            <div style={{
              display: 'inline-flex',
              alignItems: 'baseline',
              gap: 14,
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--ink-line)',
              borderRadius: 99,
              padding: '14px 48px',
              marginTop: 8,
              marginBottom: 32,
              fontSize: 56,
              fontWeight: 700,
              lineHeight: 1,
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              <span style={{ color: '#34d399' }}>{hrsPart}</span>
              <span style={{ color: 'var(--paper)' }}>{minsPart}</span>
            </div>
          );
        })()}

        <div style={{ width: '100%', borderTop: '1px solid var(--ink-line)', marginBottom: 34 }} />

        <div style={{
          fontSize: 40,
          fontWeight: 700,
          letterSpacing: '0.02em',
          fontFamily: "'JetBrains Mono', monospace",
          marginBottom: 32,
          color: timerRunning ? 'var(--amber)' : 'var(--paper)',
        }}>{timerDisplay}</div>


        {/* Subject picker — shown before starting */}
        {showSubjectPicker && !timerRunning && (
          <div style={{
            width: '100%',
            maxWidth: 360,
            margin: '0 auto 20px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 10,
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}>
            <div style={{ color: 'var(--muted)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, textAlign: 'center' }}>What are you studying?</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              {subjectOptions.map((s, idx) => {
                const color = SUBJECT_COLORS[idx % SUBJECT_COLORS.length];
                const selected = timerSubject === s;
                return (
                  <button
                    key={s}
                    onClick={() => setTimerSubject(s)}
                    style={{
                      background: selected ? color.accent : color.bg,
                      border: `1px solid ${color.border}`,
                      color: selected ? '#0d1f17' : color.accent,
                      borderRadius: 20,
                      padding: '5px 14px',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      letterSpacing: '0.04em',
                    }}
                  >{s}</button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 2 }}>
              <button
                className="btn btn-ghost small"
                onClick={() => { setShowSubjectPicker(false); setTimerSubject(''); }}
              >Cancel</button>
              <button
                className="btn btn-amber"
                onClick={() => { setShowSubjectPicker(false); startTimer(); }}
              >Start →</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', marginBottom: 34 }}>
          {!timerRunning ? (
            !showSubjectPicker && (
              <button
                className="btn btn-amber"
                style={{ minWidth: 200, justifyContent: 'center', padding: '12px 28px', fontSize: 15 }}
                onClick={() => {
                  if (subjectOptions.length > 0) {
                    setTimerSubject(subjectOptions[0]);
                    setShowSubjectPicker(true);
                  } else {
                    startTimer();
                  }
                }}
              >Start session</button>
            )
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {timerSubject && (() => {
                const idx = subjectOptions.indexOf(timerSubject);
                const color = SUBJECT_COLORS[idx >= 0 ? idx % SUBJECT_COLORS.length : 0];
                return (
                  <span style={{
                    background: color.bg,
                    border: `1px solid ${color.border}`,
                    color: color.accent,
                    borderRadius: 20,
                    padding: '3px 10px',
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}>{timerSubject}</span>
                );
              })()}
              <button className="btn btn-stop" style={{ minWidth: 200, justifyContent: 'center', padding: '12px 28px', fontSize: 15 }} onClick={stopTimer}>Stop &amp; log</button>
            </div>
          )}
        </div>

        <div className="progress-row" style={{ width: '100%' }}>
          <div className="progress-track">
            <div className={`progress-fill${progressPct >= 100 ? ' over' : ''}`} style={{ width: `${progressPct}%`, background: progressPct >= 100 ? undefined : '#34d399' }} />
          </div>
          <div className="progress-meta" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#34d399', marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            <span>{targetMins > 0 ? `${minutesToLabel(todayMins)} of ${minutesToLabel(targetMins)} daily target` : `${minutesToLabel(todayMins)} logged — no daily target set`}</span>
            <span>{targetMins > 0 ? progressPct + '%' : '—'}</span>
          </div>
        </div>
      </div>

      {/* STAT STRIP — one card per goal */}
      <div className="stat-strip" style={{ flexWrap: 'wrap', gap: 12 }}>
        {goals.map((goal, idx) => {
          const color = SUBJECT_COLORS[idx % SUBJECT_COLORS.length];
          const { subjectMins, goalMins, goalPct, daysLeft, neededPerDay } = goalStats(goal);
          return (
            <div
              key={goal.id}
              style={{
                flex: '1 1 320px',
                background: 'var(--ink-soft)',
                border: '1px solid var(--ink-line)',
                borderRadius: 12,
                padding: '16px 18px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ color: color.accent, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {goal.name || 'Unnamed goal'}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}>
                <Ring
                  pct={goalPct}
                  value={hoursShort(subjectMins)}
                  label="Logged"
                  accent="var(--sage)"
                />
                <Ring
                  pct={goalPct}
                  value={goalMins > 0 ? goalPct + '%' : '—'}
                  label="Toward goal"
                  accent="var(--sage)"
                />
                <Ring
                  pct={daysLeft !== null ? Math.min(100, Math.max(0, daysLeft)) : 0}
                  value={daysLeft !== null ? (daysLeft >= 0 ? String(daysLeft) : 'past due') : '—'}
                  label="Days left"
                  accent="var(--sage)"
                />
                <Ring
                  pct={dailyTarget > 0 && neededPerDay !== null ? (neededPerDay / dailyTarget) * 100 : 0}
                  value={neededPerDay !== null ? hoursShort(neededPerDay) : '—'}
                  label="Needed / day"
                  accent="var(--sage)"
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* TARGETS, GOALS & ADD SESSION — merged into one section */}
      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="target-row" style={{ flexDirection: 'column', gap: 12, alignItems: 'stretch', margin: 0, padding: 0, border: 'none' }}>
          {/* Daily target */}
          <div className="target-card">
            <div className="target-card-label">
              <span style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 30, height: 30, borderRadius: '50%',
                background: 'rgba(52,211,153,0.12)', color: '#34d399', flexShrink: 0,
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <circle cx="12" cy="12" r="4.5" />
                  <circle cx="12" cy="12" r="0.8" fill="currentColor" />
                </svg>
              </span>
              <label htmlFor="dailyTargetInput" style={{ color: 'var(--paper)', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>Daily target</label>
            </div>
            <div className="target-card-controls">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="number" id="dailyTargetInput" min="0" step="0.5"
                  style={{
                    width: 64, textAlign: 'center', background: 'var(--ink-soft)', border: '1px solid var(--ink-line)',
                    color: 'var(--paper)', borderRadius: 99, padding: '7px 10px', fontFamily: "'JetBrains Mono', monospace", fontSize: 14,
                  }}
                  value={dailyTarget} onChange={e => setDailyTarget(parseFloat(e.target.value) || 0)} />
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>hrs</span>
              </div>
              <button
                className="btn btn-ghost small"
                onClick={saveTargets}
                style={{ background: targetsSaved ? 'rgba(52,211,153,0.12)' : undefined, borderColor: targetsSaved ? 'rgba(52,211,153,0.4)' : undefined, color: targetsSaved ? '#34d399' : undefined, whiteSpace: 'nowrap' }}
              >{targetsSaved ? '✓ Saved' : 'Save targets'}</button>
            </div>
          </div>

         {/* Subject goals */}
          <div className="subject-card">
            <div className="subject-card-head">
              <div className="target-card-label">
                <span style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 30, height: 30, borderRadius: '50%',
                  background: 'rgba(52,211,153,0.12)', color: '#34d399', flexShrink: 0,
                }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4v16" />
                    <path d="M4 4h13l-2.5 4L17 12H4" />
                  </svg>
                </span>
                <span style={{ color: 'var(--paper)', fontSize: 13, fontWeight: 600 }}>Subject goals</span>
              </div>
              <div className="subject-card-actions">
                <button className="btn btn-ghost small" onClick={() => setShowGoalEditor(p => !p)}>
                  {showGoalEditor ? 'Done' : 'Edit goals'}
                </button>
              {goals.length < 5 && showGoalEditor && (
                <button
                  onClick={addGoal}
                  style={{
                    background: 'rgba(100,200,150,0.10)',
                    border: '1px solid rgba(100,200,150,0.35)',
                    color: '#64c896',
                    borderRadius: 6,
                    padding: '3px 10px',
                    fontSize: 12,
                    cursor: 'pointer',
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    whiteSpace: 'nowrap',
                  }}
                >+ Add goal</button>
              )}
              </div>
            </div>

            {showGoalEditor && goals.map((goal, idx) => {
              const color = SUBJECT_COLORS[idx % SUBJECT_COLORS.length];
              const { subjectMins, goalMins, goalPct } = goalStats(goal);
              return (
                <div
                  key={goal.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto auto auto auto',
                    gap: 8,
                    alignItems: 'center',
                    background: color.bg,
                    border: `1px solid ${color.border}`,
                    borderRadius: 10,
                    padding: '10px 14px',
                  }}
                >
                  {/* Subject name */}
                  <input
                    type="text"
                    placeholder="Subject name (e.g. Study, Trading)"
                    value={goal.name}
                    onChange={e => updateGoal(goal.id, 'name', e.target.value)}
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: `1px solid ${color.border}`,
                      borderRadius: 6,
                      padding: '5px 10px',
                      color: color.accent,
                      fontSize: 13,
                      fontWeight: 700,
                      outline: 'none',
                      minWidth: 120,
                    }}
                  />

                  {/* Goal hrs */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ color: 'var(--ink-dim)', fontSize: 11, whiteSpace: 'nowrap' }}>Goal hrs</span>
                    <input
                      type="number" min="0" step="10"
                      placeholder="e.g. 1000"
                      value={goal.totalHrs}
                      onChange={e => updateGoal(goal.id, 'totalHrs', e.target.value)}
                      style={{ width: 75, background: 'rgba(255,255,255,0.05)', border: `1px solid ${color.border}`, borderRadius: 6, padding: '5px 8px', color: 'var(--ink)', fontSize: 13 }}
                    />
                  </div>

                  {/* Deadline */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ color: 'var(--ink-dim)', fontSize: 11, whiteSpace: 'nowrap' }}>Deadline</span>
                    <input
                      type="date"
                      value={goal.deadline}
                      onChange={e => updateGoal(goal.id, 'deadline', e.target.value)}
                      style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${color.border}`, borderRadius: 6, padding: '5px 8px', color: 'var(--ink)', fontSize: 13 }}
                    />
                  </div>

                  {/* Progress mini badge */}
                  {goalMins > 0 && (
                    <div style={{
                      background: `${color.accent}22`,
                      border: `1px solid ${color.accent}55`,
                      borderRadius: 20,
                      padding: '3px 10px',
                      fontSize: 11,
                      fontWeight: 700,
                      color: color.accent,
                      whiteSpace: 'nowrap',
                    }}>
                      {hoursShort(subjectMins)} / {goal.totalHrs}h · {goalPct}%
                    </div>
                  )}

                  {/* Remove button */}
                  {goals.length > 1 && (
                    <button
                      onClick={() => removeGoal(goal.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--ink-dim)',
                        cursor: 'pointer',
                        fontSize: 16,
                        lineHeight: 1,
                        padding: '0 4px',
                        opacity: 0.6,
                      }}
                      title="Remove goal"
                    >×</button>
                  )}
                </div>
              );
            })}
          </div>
          {/* Add a session */}
          <div className="session-card">
            <div className="session-card-head">
              <div className="target-card-label">
                <span style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 30, height: 30, borderRadius: '50%',
                  background: 'rgba(52,211,153,0.12)', color: '#34d399', flexShrink: 0,
                }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
                <span style={{ color: 'var(--paper)', fontSize: 13, fontWeight: 600 }}>Add a session</span>
              </div>
              <button className="btn btn-ghost small" onClick={() => setShowAddSession(p => !p)}>
                {showAddSession ? '▲ Hide' : '+ Add session'}
              </button>
            </div>
            <button
              className="btn btn-ghost small"
              onClick={() => setShowLog(prev => !prev)}
              style={{ width: '100%', textAlign: 'center' }}
            >
              {showLog ? '▲ Hide session log' : '▼ View session log'}
            </button>
          </div>
        </div>

        {showAddSession && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 20, paddingBottom: 20, borderBottom: '1px dashed var(--ink-line)' }}>
          <div className="field">
            <label htmlFor="entryDate">Date</label>
            <input type="date" id="entryDate" value={entryDate} max={todayISO} onChange={e => setEntryDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="entryStart">Start time</label>
            <input type="time" id="entryStart" value={entryStart} onChange={e => setEntryStart(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="entryEnd">End time</label>
            <input type="time" id="entryEnd" value={entryEnd} onChange={e => setEntryEnd(e.target.value)} />
          </div>
          {/* Subject picker */}
          <div className="field">
            <label htmlFor="entrySubject">Subject</label>
            {subjectOptions.length > 0 ? (
              <select
                id="entrySubject"
                value={entrySubject}
                onChange={e => setEntrySubject(e.target.value)}
                style={{ minWidth: 120 }}
              >
                <option value="">— none —</option>
                {subjectOptions.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                id="entrySubject"
                value={entrySubject}
                onChange={e => setEntrySubject(e.target.value)}
                placeholder="e.g. Study"
                style={{ width: 120 }}
              />
            )}
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="entryNote">Note (optional)</label>
            <input type="text" id="entryNote" value={entryNote} onChange={e => setEntryNote(e.target.value)} placeholder="e.g. Organic chemistry, ch. 4" />
          </div>
          <button className="btn btn-amber" onClick={handleAddEntry}>Log session</button>
        </div>}

        {showLog && (loading ? (
          <div style={{ padding: '20px', display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>
        ) : sessions.length === 0 ? (
          <div className="empty-state">
            <div className="big">Your logbook is empty</div>
            Log your first session above, or start the timer.
          </div>
        ) : (
          <div>
            {dates.map(date => {
              const daySessions = byDate[date].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
              const dayTotal = daySessions.reduce((sum, s) => sum + durationMinutes(s), 0);
              const dateObj = new Date(date + 'T00:00:00');
              const isToday = date === todayISO;
              const dayName = isToday ? 'Today' : dateObj.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
              const tally = '|'.repeat(Math.min(daySessions.length, 12));
const isCollapsed = collapsedDates.has(date);
              return (
                <div key={date} className="day-group">
                  <div className="day-head" onClick={() => toggleDate(date)} style={{ cursor: 'pointer', userSelect: 'none' }}>
                    <span className="day-name">{dayName} <span className="tally">{tally}</span></span>
                    <span className="day-total mono">{minutesToLabel(dayTotal)} <span style={{ opacity: 0.4, fontSize: 11 }}>{isCollapsed ? '▼' : '▲'}</span></span>
                  </div>
                  {!isCollapsed && daySessions.map((s, idx) => {
                    const startT = new Date(s.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                    const endT = new Date(s.end).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                    const dur = durationMinutes(s);
                    const subj = (s as any).subject;
                    const subjIdx = goals.findIndex(g => g.name.toLowerCase() === (subj || '').toLowerCase());
                    const subjColor = subjIdx >= 0 ? SUBJECT_COLORS[subjIdx % SUBJECT_COLORS.length] : null;
                    return (
                      <div key={s.id} className="entry-line">
                        <span className="entry-num">{idx + 1}</span>
                        {subj && subjColor && (
                          <span style={{
                            background: subjColor.bg,
                            border: `1px solid ${subjColor.border}`,
                            color: subjColor.accent,
                            borderRadius: 20,
                            padding: '1px 8px',
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            whiteSpace: 'nowrap',
                          }}>{subj}</span>
                        )}
                        <span className="entry-range">{startT}<span className="arrow">→</span>{endT}</span>
                        <span className="entry-dur">{minutesToLabel(dur)}</span>
                        <span className="entry-note">{s.note}</span>
                        <button className="entry-del" onClick={() => deleteSession(s.id)} aria-label="Delete session">×</button>
                      </div>
);
            })}
            </div>
          );
        })}
          </div>
        ))}
      </div>

      {/* CHART */}
      <section className="panel">
        <div className="panel-head">
          <h2>Study time graph</h2>
          <div className="range-toggle">
            {([14, 30, 90] as const).map(r => (
              <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>{r} days</button>
            ))}
          </div>
        </div>
        <StudyChart sessions={sessions} range={range} dailyTargetHrs={dailyTarget} />
      </section>
    </>
  );
}
