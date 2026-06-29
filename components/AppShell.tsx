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
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 30, letterSpacing: '-0.01em' }}>Studyclash</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="user-chip">
            <div className="user-avatar">{profile.username[0].toUpperCase()}</div>
            <div>
              <div className="user-name">{profile.username}</div>
              <div className="user-since mono" style={{ fontSize: 11 }}>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
            </div>
          </div>
          <button className="btn btn-ghost small" onClick={handleSignOut}>Sign out</button>
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
