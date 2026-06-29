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

  const [entryDate, setEntryDate] = useState(fmtDateISO(new Date()));
  const [entryStart, setEntryStart] = useState('');
  const [entryEnd, setEntryEnd] = useState('');
  const [entryNote, setEntryNote] = useState('');
  const [range, setRange] = useState(14);

  const [dailyTarget, setDailyTarget] = useState(profile.daily_target_hrs ?? 4);
  const [goalTotal, setGoalTotal] = useState<string>(profile.goal_total_hrs?.toString() ?? '');
  const [goalDeadline, setGoalDeadline] = useState(profile.goal_deadline ?? '');

  const [todayISO, setTodayISO] = useState(fmtDateISO(new Date()));

  // Refresh todayISO at midnight so the date heading stays correct
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

    // Real-time subscription for own sessions
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
          const { start } = JSON.parse(saved);
          if (typeof start === 'number' && start > 0 && start < Date.now()) {
            setTimerStart(start);
            setTimerRunning(true);
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
      event: '*',
      schema: 'public',
      table: 'active_sessions',
      filter: `user_id=eq.${user.id}`,
    }, (payload) => {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        // Another device started the timer
        const startMs = new Date((payload.new as { start_time: string }).start_time).getTime();
        setTimerStart(startMs);
        setTimerRunning(true);
      } else if (payload.eventType === 'DELETE') {
        // Another device stopped the timer
        setTimerRunning(false);
        setTimerStart(null);
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
    const now = new Date();
    const nowMs = now.getTime();

    await supabase.from('active_sessions').upsert({
      user_id: user.id,
      start_time: now.toISOString(),
    });

    setTimerStart(nowMs);
    setTimerRunning(true);
    localStorage.setItem('logbook_active_timer', JSON.stringify({ start: nowMs }));
  }

  async function stopTimer() {
    const endDate = new Date();

    // Get the real start time from Supabase (works across devices)
    const { data: activeData } = await supabase
      .from('active_sessions')
      .select('start_time')
      .eq('user_id', user.id)
      .single();

    const realStart = activeData?.start_time ? new Date(activeData.start_time).getTime() : timerStart;
    if (!realStart) return;
    const startDate = new Date(realStart);

    setTimerRunning(false);
    setTimerStart(null);
    localStorage.removeItem('logbook_active_timer');

    await supabase.from('active_sessions').delete().eq('user_id', user.id);

    const dateStr = fmtDateISO(startDate);

    await addSession({
      date: dateStr,
      startISO: startDate.toISOString(),
      endISO: endDate.toISOString(),
      note: '',
    });
  }

  async function addSession({ date, startISO, endISO, note }: { date: string; startISO: string; endISO: string; note: string }) {
    const dur = Math.max(0, Math.round((new Date(endISO).getTime() - new Date(startISO).getTime()) / 60000));
    await supabase.from('sessions').insert({
      user_id: user.id,
      username: profile.username,
      date,
      start: startISO,
      end: endISO,
      note: note || '',
      duration_minutes: dur,
    });
    // fetchSessions triggered by realtime
  }

  async function deleteSession(id: string) {
    if (!confirm('Delete this session? This cannot be undone.')) return;
    await supabase.from('sessions').delete().eq('id', id).eq('user_id', user.id);
  }

  async function handleAddEntry() {
    if (!entryDate || !entryStart || !entryEnd) { alert('Enter a date, start time, and end time.'); return; }

    // Parse as local time by splitting manually — avoids UTC misinterpretation
    const [year, month, day] = entryDate.split('-').map(Number);
    const [startHr, startMin] = entryStart.split(':').map(Number);
    const [endHr, endMin] = entryEnd.split(':').map(Number);

    const startDate = new Date(year, month - 1, day, startHr, startMin, 0);
    let endDate = new Date(year, month - 1, day, endHr, endMin, 0);

    // If end <= start, session crosses midnight — push end to next day
    if (endDate <= startDate) {
      endDate = new Date(year, month - 1, day + 1, endHr, endMin, 0);
    }

    const now = new Date();

    // Prevent logging future sessions
    if (startDate > now) {
      alert('Start time cannot be in the future.');
      return;
    }
    if (endDate > now) {
      alert('End time cannot be in the future.');
      return;
    }

    // Prevent overlapping sessions on the same date
    const sameDaySessions = sessions.filter(s => s.date === entryDate);
    const hasOverlap = sameDaySessions.some(s => {
      const existStart = new Date(s.start).getTime();
      const existEnd = new Date(s.end).getTime();
      const newStart = startDate.getTime();
      const newEnd = endDate.getTime();
      return newStart < existEnd && newEnd > existStart;
    });

    if (hasOverlap) {
      alert('This session overlaps with an existing session on that day. Please check your times.');
      return;
    }

    await addSession({
      date: entryDate,
      startISO: startDate.toISOString(),
      endISO: endDate.toISOString(),
      note: entryNote.trim(),
    });
    setEntryStart(''); setEntryEnd(''); setEntryNote('');
  }

  async function saveTargets() {
    await supabase.from('profiles').update({
      daily_target_hrs: dailyTarget,
      goal_total_hrs: goalTotal ? parseFloat(goalTotal) : null,
      goal_deadline: goalDeadline || null,
    }).eq('id', user.id);
    onProfileUpdate();
  }

  // Derived stats
  const todaySessions = sessions.filter(s => s.date === todayISO);
  const todayMins = todaySessions.reduce((sum, s) => sum + durationMinutes(s), 0);
  const allMins = sessions.reduce((sum, s) => sum + durationMinutes(s), 0);
  const targetMins = (dailyTarget || 0) * 60;
  const progressPct = targetMins > 0 ? Math.min(100, Math.round((todayMins / targetMins) * 100)) : 0;

  const goalMins = goalTotal ? parseFloat(goalTotal) * 60 : 0;
  const goalPct = goalMins > 0 ? Math.min(999, Math.round((allMins / goalMins) * 100)) : 0;

  let daysLeft: number | null = null;
  let neededPerDay: number | null = null;
  if (goalDeadline) {
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const deadline = new Date(goalDeadline + 'T00:00:00');
    daysLeft = Math.ceil((deadline.getTime() - today0.getTime()) / 86400000);
    const remainingMins = Math.max(0, goalMins - allMins);
    if (daysLeft > 0) neededPerDay = remainingMins / daysLeft;
    else if (daysLeft === 0) neededPerDay = remainingMins;
  }

  // Group sessions by date for logbook display
  const byDate: Record<string, Session[]> = {};
  sessions.forEach(s => { (byDate[s.date] = byDate[s.date] || []).push(s); });
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a)).slice(0, 14);

  return (
    <>
      {/* HERO */}
      <div className="hero">
        <div className="hero-top">
          <div>
            <div className="hero-label">Today's study time</div>
            <div className="hero-total">{minutesToLabel(todayMins)}</div>
            <div className="hero-sub">{todaySessions.length === 1 ? '1 session logged today' : `${todaySessions.length} sessions logged today`}</div>
          </div>
          <div className="timer-block">
            <div className="hero-label" style={{ textAlign: 'right' }}>Live timer</div>
            <div className={`timer-display${timerRunning ? ' running' : ''}`}>{timerDisplay}</div>
            <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              {!timerRunning ? (
                <button className="btn btn-amber" onClick={startTimer}>Start session</button>
              ) : (
                <button className="btn btn-stop" onClick={stopTimer}>Stop &amp; log</button>
              )}
            </div>
          </div>
        </div>

        <div className="progress-row" style={{ marginTop: 22 }}>
          <div className="progress-track">
            <div className={`progress-fill${progressPct >= 100 ? ' over' : ''}`} style={{ width: `${progressPct}%` }} />
          </div>
          <div className="progress-meta">
            <span>{targetMins > 0 ? `${minutesToLabel(todayMins)} of ${minutesToLabel(targetMins)} daily target` : `${minutesToLabel(todayMins)} logged — no daily target set`}</span>
            <span>{targetMins > 0 ? progressPct + '%' : '—'}</span>
          </div>
        </div>

        <div className="target-row">
          <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <label htmlFor="dailyTargetInput">Daily target (hrs)</label>
            <input type="number" id="dailyTargetInput" min="0" step="0.5" style={{ width: 70 }}
              value={dailyTarget} onChange={e => setDailyTarget(parseFloat(e.target.value) || 0)} />
          </div>
          <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <label htmlFor="goalTotalInput">Total goal (hrs)</label>
            <input type="number" id="goalTotalInput" min="0" step="1" style={{ width: 80 }}
              value={goalTotal} onChange={e => setGoalTotal(e.target.value)} />
          </div>
          <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <label htmlFor="goalDeadlineInput">Deadline</label>
            <input type="date" id="goalDeadlineInput" value={goalDeadline}
              onChange={e => setGoalDeadline(e.target.value)} />
          </div>
          <button className="btn btn-ghost small" onClick={saveTargets}>Save targets</button>
        </div>
      </div>

      {/* STAT STRIP */}
      <div className="stat-strip">
        <div className="stat">
          <div className="stat-label">Total logged</div>
          <div className="stat-value">{hoursShort(allMins)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Toward goal</div>
          <div className="stat-value amber">{goalMins > 0 ? goalPct + '%' : '—'}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Days left</div>
          <div className={`stat-value sage${daysLeft !== null && daysLeft < 0 ? ' brick' : ''}`}>
            {daysLeft !== null ? (daysLeft >= 0 ? daysLeft : 'past due') : '—'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Needed / day</div>
          <div className="stat-value">{neededPerDay !== null ? hoursShort(neededPerDay) : '—'}</div>
        </div>
      </div>

      {/* MANUAL ENTRY */}
      <section className="panel">
        <div className="panel-head"><h2>Add a session</h2></div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 20, paddingBottom: 20, borderBottom: '1px dashed var(--ink-line)' }}>
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
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="entryNote">Note (optional)</label>
            <input type="text" id="entryNote" value={entryNote} onChange={e => setEntryNote(e.target.value)} placeholder="e.g. Organic chemistry, ch. 4" />
          </div>
          <button className="btn btn-amber" onClick={handleAddEntry}>Log session</button>
        </div>

        {/* Logbook list */}
        {loading ? (
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

              return (
                <div key={date} className="day-group">
                  <div className="day-head">
                    <span className="day-name">{dayName} <span className="tally">{tally}</span></span>
                    <span className="day-total mono">{minutesToLabel(dayTotal)}</span>
                  </div>
                  {daySessions.map((s, idx) => {
                    const startT = new Date(s.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                    const endT = new Date(s.end).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                    const dur = durationMinutes(s);
                    return (
                      <div key={s.id} className="entry-line">
                        <span className="entry-num">{idx + 1}</span>
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
        )}
      </section>

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
