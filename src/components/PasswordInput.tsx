import { Eye, EyeOff } from 'lucide-react';
import AppIcon from './AppIcon';
import { useState } from 'react';

// Reusable password field with a Show/Hide (eye) toggle.
// Masked by default; the toggle is type="button" so it never submits forms.
// Used by login pages and Settings (change password).
interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Extra classes for the <input> (styling stays with the caller). */
  className?: string;
  /** Classes for the eye button — caller picks tones visible on its surface. */
  toggleClassName?: string;
  autoComplete?: string;
  required?: boolean;
}

export default function PasswordInput({
  value,
  onChange,
  placeholder = '••••••',
  className = '',
  toggleClassName = 'text-slate-500 hover:text-slate-800',
  autoComplete = 'current-password',
  required = true,
}: PasswordInputProps) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      <input
        className={`${className} pr-10`}
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
        title={show ? 'Hide password' : 'Show password'}
        className={`icon-button absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg transition-colors focus:outline-none focus:ring-2 focus:ring-[#4ea895] ${toggleClassName}`}
      >
        <AppIcon icon={show ? EyeOff : Eye} size={18} />
      </button>
    </div>
  );
}
