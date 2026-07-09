'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function AuthScreen() {
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);
    if (!username.trim()) { setError('Pick a display name.'); setLoading(false); return; }
    if (username.length > 20) { setError('Display name must be 20 chars or less.'); setLoading(false); return; }

    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { username: username.trim() } } });
    if (error) { setError(error.message); setLoading(false); return; }

    // Insert profile row
    if (data.user) {
      await supabase.from('profiles').upsert({
        id: data.user.id,
        username: username.trim(),
        daily_target_hrs: 4,
      });
    }
    setSuccess('Account created! Check your email to confirm, then sign in.');
    setLoading(false);
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="topbar-logo auth-logo-text">Focus<span className="topbar-logo-accent">club</span></h1>
        <p className="auth-subtitle">Where focus becomes a habit.</p>

        <div className="auth-tabs">
          <button className={`auth-tab${tab === 'signin' ? ' active' : ''}`} onClick={() => { setTab('signin'); setError(''); setSuccess(''); }}>Sign in</button>
          <button className={`auth-tab${tab === 'signup' ? ' active' : ''}`} onClick={() => { setTab('signup'); setError(''); setSuccess(''); }}>Create account</button>
        </div>

        {error && <div className="auth-error">{error}</div>}
        {success && <div className="auth-success">{success}</div>}

        {tab === 'signin' ? (
          <form onSubmit={handleSignIn}>
            <div className="auth-field">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div className="auth-field">
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" />
            </div>
            <button type="submit" className="btn btn-amber auth-submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSignUp}>
            <div className="auth-field">
              <label>Display name (shown on leaderboard)</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)} required maxLength={20} placeholder="e.g. Arjun" />
            </div>
            <div className="auth-field">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div className="auth-field">
              <label>Password (min 6 chars)</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} autoComplete="new-password" />
            </div>
            <button type="submit" className="btn btn-amber auth-submit" disabled={loading}>
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
