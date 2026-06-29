import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Session = {
  id: string;
  user_id: string;
  username: string;
  date: string;
  start: string;
  end: string;
  note: string;
  subject: string;
  duration_minutes: number;
  created_at: string;
};

export type SubjectGoal = {
  id: string;
  name: string;
  totalHrs: string;
  deadline: string;
};

export type UserProfile = {
  id: string;
  username: string;
  daily_target_hrs: number;
  goal_total_hrs: number | null;
  goal_deadline: string | null;
  goals: SubjectGoal[] | null;
  created_at: string;
};