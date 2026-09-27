// Patient-facing helpers: friendly status labels, formatting, and messages.
// No queue terminology here — the patient portal never shows queue numbers,
// queue positions, or internal staff statuses (checked_in / waiting /
// in_progress are displayed as "Confirmed").

/** Patient-visible appointment status. */
export type PatientStatus = 'Pending' | 'Confirmed' | 'Completed' | 'Cancelled' | 'No-show';

/** Map a database status to the patient-visible label. */
export function patientStatusLabel(dbStatus: string): PatientStatus {
  switch (dbStatus) {
    case 'pending':
      return 'Pending';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    case 'no_show':
      return 'No-show';
    case 'scheduled':
    case 'checked_in':
    case 'waiting':
    case 'in_progress':
    case 'confirmed':
    default:
      return 'Confirmed';
  }
}

export function patientStatusPill(dbStatus: string): string {
  switch (patientStatusLabel(dbStatus)) {
    case 'Pending':
      return 'bg-amber-500/15 text-amber-400';
    case 'Confirmed':
      return 'bg-[#4ea895]/15 text-[#4ea895]';
    case 'Completed':
      return 'bg-green-500/15 text-green-400';
    case 'Cancelled':
      return 'bg-slate-500/15 text-slate-400';
    case 'No-show':
      return 'bg-red-500/15 text-red-400';
  }
}

export function formatDateLong(isoOrKey: string): string {
  const d = isoOrKey.includes('T') ? new Date(isoOrKey) : new Date(`${isoOrKey}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function formatDateShort(isoOrKey: string): string {
  const d = isoOrKey.includes('T') ? new Date(isoOrKey) : new Date(`${isoOrKey}T12:00:00`);
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** "09:00" -> "9:00 AM" for slot buttons. */
export function formatSlotTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
}

export const MSG = {
  doctorUnavailable:
    'This doctor is not available for appointments on the selected date. Please choose another date.',
  timeUnavailable: 'This appointment time is no longer available. Please choose another time.',
  conflict: 'This appointment slot has already been booked. Please select another available time.',
  failure: "We couldn't book your appointment right now. Please try again.",
  success: 'Your appointment has been booked successfully.',
} as const;
