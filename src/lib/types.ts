export type AppointmentStatus =
  | 'pending'
  | 'scheduled'
  | 'checked_in'
  | 'waiting'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export interface Profile {
  id: string;
  full_name: string;
  role: string;
  device_label?: string | null;
}

export interface Doctor {
  id: string;
  profile_id?: string | null;
  full_name: string;
  specialty?: string | null;
  is_active: boolean;
}

export interface DoctorSchedule {
  id: string;
  doctor_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
}

export interface DoctorUnavailable {
  id: string;
  doctor_id: string;
  date: string;
  reason?: string | null;
}

export interface Patient {
  id: string;
  full_name: string;
  date_of_birth?: string | null;
  contact_number?: string | null;
  address?: string | null;
  /** Auth link (added by patient-booking migration). Null on older databases. */
  user_id?: string | null;
}

export interface Appointment {
  id: string;
  patient_id: string;
  doctor_id: string;
  scheduled_time: string;
  source: 'walk_in' | 'pre_booked';
  is_recurring: boolean;
  recurrence_parent_id?: string | null;
  status: AppointmentStatus;
  room?: string | null;
  checked_in_at?: string | null;
  /** Reason for visit (added by patient-booking migration; nullable on older DBs). */
  reason?: string | null;
}

export interface AppointmentJoined extends Appointment {
  patient?: Patient;
  doctor?: Doctor;
}

export const STATUS_FLOW: AppointmentStatus[] = [
  'scheduled',
  'checked_in',
  'waiting',
  'in_progress',
  'completed',
];

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
