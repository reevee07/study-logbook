'use client';

import { useState, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { UserProfile } from '@/lib/supabase';
import LogbookView from './LogbookView';
import LeaderboardView from './LeaderboardView';

export default function AppShell({ user }: { user: User }) {
  const [tab, setTab] = useState<'logbook' | 'leaderboard'>('logbook');
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    fetchProfile();
  }, [user.id]);

  async function fetchProfile() {
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (data) setProfile(data as UserProfile);
    else {
      // Auto-create profile if missing (e.g. OAuth users)
      const username = user.user_metadata?.username || user.email?.split('@')[0] || 'Unnamed';
      const { data: newProfile } = await supabase.from('profiles').upsert({
        id: user.id,
        username,
        daily_target_hrs: 4,
      }).select().single();
      if (newProfile) setProfile(newProfile as UserProfile);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  if (!profile) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="wrap">
      <header className="topbar">
        <div className="topbar-pill">
          <span className="topbar-mark">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 2 3 14h7l-1 8 11-14h-7l1-6z" />
            </svg>
          </span>
          <h1 className="topbar-logo">Focus<span className="topbar-logo-accent">club</span></h1>
          <span className="topbar-date mono">{new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</span>
        </div>

        <div className="topbar-user">
          <span className="topbar-avatar-ring">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
            </svg>
          </span>
        </div>
      </header>

      <div className="nav-tabs">
        <button className={`nav-tab${tab === 'logbook' ? ' active' : ''}`} onClick={() => setTab('logbook')}>My Sessions</button>
        <button className={`nav-tab${tab === 'leaderboard' ? ' active' : ''}`} onClick={() => setTab('leaderboard')}>
          <span className="live-dot" />Leaderboard
        </button>
      </div>

      {tab === 'logbook' ? (
        <LogbookView user={user} profile={profile} onProfileUpdate={fetchProfile} />
      ) : (
        <LeaderboardView currentUserId={user.id} />
      )}

      <footer>synced in real-time via Supabase — data lives in the cloud</footer>
    </div>
  );
}
