'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

const pad = (n: number) => String(n).padStart(2, '0');
const fmtDateISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function minutesToLabel(mins: number) {
  mins = Math.max(0, Math.round(mins));
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h}h ${pad(m)}m`;
}

type LeaderEntry = {
  user_id: string;
  username: string;
  total_mins: number;
  today_mins: number;
  week_mins: number;
  sessions_count: number;
};

type SortKey = 'total' | 'today' | 'week';

export default function LeaderboardView({ currentUserId }: { currentUserId: string }) {
  const [entries, setEntries] = useState<LeaderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>('today');
 const [lastRefresh, setLastRefresh] = useState(new Date());
  const [showAll, setShowAll] = useState(false);

  // Stable date strings — computed once on mount, not on every render
  const todayISO = useRef(fmtDateISO(new Date())).current;
  const weekISO = useRef(fmtDateISO(new Date(Date.now() - 7 * 86400000))).current;

  const buildLeaderboard = useCallback(async () => {
    const { data: sessions } = await supabase
      .from('sessions')
      .select('user_id, username, date, start, end, duration_minutes');

    if (!sessions) return;

    const byUser: Record<string, LeaderEntry> = {};

    sessions.forEach((s: any) => {
      // Always recompute from start/end — stored duration_minutes may be stale from old bugs
      const mins = Math.max(0, Math.round((new Date(s.end).getTime() - new Date(s.start).getTime()) / 60000));
      if (!byUser[s.user_id]) {
        byUser[s.user_id] = {
          user_id: s.user_id,
          username: s.username,
          total_mins: 0,
          today_mins: 0,
          week_mins: 0,
          sessions_count: 0,
        };
      }
      const entry = byUser[s.user_id];
      entry.total_mins += mins;
      entry.sessions_count += 1;
      if (s.date === todayISO) entry.today_mins += mins;
      if (s.date >= weekISO) entry.week_mins += mins;
    });

    setEntries(Object.values(byUser));
    setLastRefresh(new Date());
    setLoading(false);
  }, [todayISO, weekISO]);

  useEffect(() => {
    buildLeaderboard();

    // Real-time: refresh leaderboard whenever any session changes
    const channel = supabase
      .channel('leaderboard_global')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, () => {
        buildLeaderboard();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [buildLeaderboard]);

  const sortedEntries = [...entries].sort((a, b) => {
    if (sort === 'today') return b.today_mins - a.today_mins;
    if (sort === 'week') return b.week_mins - a.week_mins;
    return b.total_mins - a.total_mins;
  });

  const maxMins = sortedEntries[0]?.[sort === 'today' ? 'today_mins' : sort === 'week' ? 'week_mins' : 'total_mins'] ?? 1;

  const rankClass = (i: number) => i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
  const rankLabel = (i: number) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" /></div>;
  }

  if (entries.length === 0) {
    return (
      <div className="panel">
        <div className="empty-state">
          <div className="big">No data yet</div>
          Be the first to log a session — then invite friends to compete.
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Sort tabs */}
      <section className="panel">
        <div className="panel-head">
          <h2>Leaderboard</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'JetBrains Mono' }}>
              <span className="live-dot" />
              updated {lastRefresh.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>

        <div className="range-toggle" style={{ marginBottom: 20 }}>
          <button className={sort === 'today' ? 'active' : ''} onClick={() => setSort('today')}>Today</button>
          <button className={sort === 'week' ? 'active' : ''} onClick={() => setSort('week')}>This week</button>
          <button className={sort === 'total' ? 'active' : ''} onClick={() => setSort('total')}>All time</button>
        </div>

        <div>
          {(showAll ? sortedEntries : sortedEntries.slice(0, 3)).map((entry, i) => {
            const isMe = entry.user_id === currentUserId;
            const displayMins = sort === 'today' ? entry.today_mins : sort === 'week' ? entry.week_mins : entry.total_mins;
            const pct = maxMins > 0 ? (displayMins / maxMins) * 100 : 0;

            return (
              <div key={entry.user_id} className={`lb-row${isMe ? ' is-me' : ''}`}>
                <div className={`lb-rank ${rankClass(i)}`}>{rankLabel(i)}</div>
                <div>
                  <div className="lb-name">
                    {entry.username}
                    {isMe && <span className="you-tag">you</span>}
                  </div>
                  <div className="lb-bar-wrap">
                    <div className={`lb-bar${isMe ? ' is-me' : ''}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, fontFamily: 'JetBrains Mono' }}>
                    {entry.sessions_count} session{entry.sessions_count !== 1 ? 's' : ''} total
                  </div>
                </div>
                <div className="lb-hours">{minutesToLabel(displayMins)}</div>
                <div className="lb-today">
                  {sort !== 'today' && <div style={{ color: 'var(--amber)', fontSize: 11 }}>Today: {minutesToLabel(entry.today_mins)}</div>}
                  {sort !== 'total' && <div style={{ fontSize: 11 }}>All time: {minutesToLabel(entry.total_mins)}</div>}
                </div>
              </div>
            );
          })}
        </div>

        {sortedEntries.length > 3 && (
          <button
            className="btn btn-ghost small"
            onClick={() => setShowAll(prev => !prev)}
            style={{ width: '100%', textAlign: 'center', marginTop: 12 }}
          >
            {showAll ? '▲ Show less' : `▼ Show all ${sortedEntries.length} players`}
          </button>
        )}
      </section>

      {/* Your snapshot */}
      {(() => {
        const me = entries.find(e => e.user_id === currentUserId);
        if (!me) return null;
        const myRankToday = [...entries].sort((a, b) => b.today_mins - a.today_mins).findIndex(e => e.user_id === currentUserId);
        const myRankTotal = [...entries].sort((a, b) => b.total_mins - a.total_mins).findIndex(e => e.user_id === currentUserId);
        return (
          <section className="panel">
            <div className="panel-head"><h2>Your standing</h2></div>
            <div className="stat-strip" style={{ marginBottom: 0 }}>
              <div className="stat">
                <div className="stat-label">Today's rank</div>
                <div className="stat-value amber">#{myRankToday + 1}</div>
              </div>
              <div className="stat">
                <div className="stat-label">All-time rank</div>
                <div className="stat-value sage">#{myRankTotal + 1}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Today</div>
                <div className="stat-value">{minutesToLabel(me.today_mins)}</div>
              </div>
              <div className="stat">
                <div className="stat-label">All time</div>
                <div className="stat-value">{minutesToLabel(me.total_mins)}</div>
              </div>
            </div>
          </section>
        );
      })()}
    </>
  );
}
