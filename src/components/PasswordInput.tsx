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

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {off ? (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c7 0 10 7 10 7a17.6 17.6 0 0 1-2.9 3.9M6.6 6.6C4 8.2 2 12 2 12s3 7 10 7a9.6 9.6 0 0 0 4.4-1.1" />
          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
        </>
      ) : (
        <>
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
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
        className={`absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg transition-colors focus:outline-none focus:ring-2 focus:ring-[#4ea895] ${toggleClassName}`}
      >
        <EyeIcon off={show} />
      </button>
    </div>
  );
}
