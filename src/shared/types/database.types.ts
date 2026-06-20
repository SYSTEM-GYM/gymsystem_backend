// Shared TypeScript interfaces mirroring public Supabase schema.
// Keep in sync with migrations — generated types (supabase gen types) can replace these later.

export type UserRole = 'admin' | 'trainer' | 'customer';
export type UserStatus = 'active' | 'inactive' | 'blocked';
export type PlanType = 'basic' | 'premium' | 'vip';

export interface Gym {
  id: string;
  name: string;
  city: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  full_name: string;
  phone: string | null;
  plan_type: PlanType;
  status: UserStatus;
  role: UserRole;
  home_gym_id: string | null;
  global_access: boolean;
  experience_points: number;
  face_embedding_hash: string | null;
  created_at: string;
  updated_at: string;
}

export type TransactionType = 'income' | 'expense';
export type TransactionStatus = 'pending' | 'paid' | 'overdue';
export type TransactionCategory =
  | 'subscription' | 'ecommerce'
  | 'rent' | 'energy' | 'water' | 'payroll'
  | 'maintenance' | 'supplies' | 'equipment' | 'other';

export interface FinancialTransaction {
  id: string;
  user_id: string | null;
  gym_id: string | null; // TODO: make required once all writers pass gym_id
  type: TransactionType;
  category: TransactionCategory;
  status: TransactionStatus;
  amount: number;
  description: string | null;
  due_date: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export type OccupancyEventType = 'entry' | 'exit';

export interface OccupancyLog {
  id: string;
  user_id: string;
  gym_id: string | null; // TODO: make required once edge service sends gym_id
  event_type: OccupancyEventType;
  qr_hash: string | null;
  validated_at: string;
  synced_at: string;
  turnstile_id: string | null;
  notes: string | null;
}

export interface RecurringExpense {
  id: string;
  name: string;
  description: string | null;
  amount: number;
  category: TransactionCategory;
  day_of_month: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Exercise {
  id: string;
  title: string;
  description: string | null;
  youtube_url: string | null;
  webm_path: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}
