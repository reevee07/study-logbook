'use client';

import { useState, useEffect, useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { UserProfile } from '@/lib/supabase';
import LogbookView from './LogbookView';
import LeaderboardView from './LeaderboardView';

export default function AppShell({ user }: { user: User }) {
  const [tab, setTab] = useState<'logbook' | 'leaderboard'>('logbook');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchProfile();
  }, [user.id]);

  // Close the profile dropdown when clicking outside of it
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setShowProfileMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  function handleChooseAvatar() {
    setShowProfileMenu(false);
    avatarInputRef.current?.click();
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${user.id}/avatar.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const avatarUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;
      await supabase.from('profiles').update({ avatar_url: avatarUrl }).eq('id', user.id);
      await fetchProfile();
    } catch (err) {
      console.error('Avatar upload failed:', err);
    } finally {
      setUploadingAvatar(false);
    }
  }

  // Swipe navigation between tabs — swipe right from "My Sessions" goes to
  // "Leaderboard"; swipe left from "Leaderboard" goes back to "My Sessions".
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const SWIPE_MIN_DISTANCE = 60; // px, horizontal distance required to count as a swipe
  const SWIPE_MAX_OFF_AXIS = 60; // px, max vertical drift allowed (so scrolling isn't hijacked)
  const SWIPE_MAX_TIME = 700; // ms, max duration for a swipe gesture

  function handleTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const dt = Date.now() - start.t;
    if (dt > SWIPE_MAX_TIME) return;
    if (Math.abs(dy) > SWIPE_MAX_OFF_AXIS) return;
    if (dx > SWIPE_MIN_DISTANCE && tab === 'logbook') {
      setTab('leaderboard');
    } else if (dx < -SWIPE_MIN_DISTANCE && tab === 'leaderboard') {
      setTab('logbook');
    }
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
          <h1 className="topbar-logo">Focus<span className="topbar-logo-accent">club</span></h1>
          <span className="topbar-date mono">{new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</span>
        </div>

        <div className="topbar-user" ref={profileMenuRef}>
          <button
            type="button"
            className="topbar-avatar-ring"
            onClick={() => setShowProfileMenu(p => !p)}
            aria-label="Profile menu"
          >
            {(profile as any)?.avatar_url ? (
              <img src={(profile as any).avatar_url} alt="Profile" className="topbar-avatar-img" />
            ) : (
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
              </svg>
            )}
            {uploadingAvatar && <span className="topbar-avatar-spinner" />}
          </button>

          {showProfileMenu && (
            <div className="profile-menu">
              <button type="button" className="profile-menu-item" onClick={handleChooseAvatar}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="9" cy="9" r="2" />
                  <path d="m21 15-3.5-3.5a2 2 0 0 0-2.83 0L5 21" />
                </svg>
                Set profile image
              </button>
              <button type="button" className="profile-menu-item danger" onClick={handleSignOut}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Log out
              </button>
            </div>
          )}

          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleAvatarChange}
          />
        </div>
      </header>

      <div className="nav-tabs">
        <button className={`nav-tab${tab === 'logbook' ? ' active' : ''}`} onClick={() => setTab('logbook')}>My Sessions</button>
        <button className={`nav-tab${tab === 'leaderboard' ? ' active' : ''}`} onClick={() => setTab('leaderboard')}>
          <span className="live-dot" />Leaderboard
        </button>
      </div>

      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{ touchAction: 'pan-y' }}
      >
        {tab === 'logbook' ? (
          <LogbookView user={user} profile={profile} onProfileUpdate={fetchProfile} />
        ) : (
          <LeaderboardView currentUserId={user.id} />
        )}
      </div>

      <footer>synced in real-time via Supabase — data lives in the cloud</footer>
    </div>
  );
}
