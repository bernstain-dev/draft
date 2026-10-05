import { clinicDateKey, validateDateKey } from './clinicTime';
export const validUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function textError(value: string, label: string, max: number, required = false) {
  if (required && !value.trim()) return `${label} is required.`;
  if (value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) return `${label} must be at most ${max} characters without control characters.`;
  return null;
}
export function patientFormError(form: { full_name: string; date_of_birth: string; contact_number: string; address: string }) {
  const error = textError(form.full_name, 'Full name', 300, true) || textError(form.address, 'Address', 500);
  if (error) return error;
  if (form.date_of_birth) {
    try { validateDateKey(form.date_of_birth); } catch { return 'Enter a valid date of birth.'; }
    if (form.date_of_birth < '1900-01-01' || form.date_of_birth > clinicDateKey()) return 'Date of birth must be from 1900 through today.';
  }
  const phone = form.contact_number.trim();
  if (phone && (!/^\+?[0-9][0-9 ()-]{5,24}$/.test(phone) || !/^\d{7,15}$/.test(phone.replace(/\D/g, '')))) return 'Enter a valid contact number with 7–15 digits.';
  return null;
}
export function doctorFormError(name: string, specialty: string) { return textError(name, 'Doctor name', 200, true) || textError(specialty, 'Specialty', 120) || (specialty && !specialty.trim() ? 'Specialty must be nonblank or empty.' : null); }
