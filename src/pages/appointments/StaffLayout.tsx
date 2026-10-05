import { CalendarPlus, ChartNoAxesCombined, ClipboardCheck, Hospital, LayoutDashboard, LogOut, Menu, Settings, Stethoscope, Users, X } from 'lucide-react';
import AppIcon from '../../components/AppIcon';
import AuthRecovery from '../../components/AuthRecovery';
import { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useStaffAuth } from './auth/staffAuth';

// Resolve the session and require the exact administrative role.
const NAV = [
  { to: '/appointments/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/appointments/booking', label: 'Booking', icon: CalendarPlus },
  { to: '/appointments/check-in', label: 'Check-in', icon: ClipboardCheck },
  { to: '/appointments/patients', label: 'Patients', icon: Users },
  { to: '/appointments/doctors', label: 'Doctors', icon: Stethoscope },
  { to: '/appointments/reports', label: 'Reports', icon: ChartNoAxesCombined },
  { to: '/appointments/settings', label: 'Settings', icon: Settings },
];

const COLLAPSE_KEY = 'staff-sidebar-collapsed';

export default function StaffLayout() {
  const { user, profile, role, loading, error, refreshIdentity, signOut } = useStaffAuth();
  const loc = useLocation();
  // Desktop: expanded (icon + text) vs collapsed (icon only). Persisted.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  // Mobile: sidebar behaves as an overlay drawer, closed by default.
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      // private mode — preference just won't persist
    }
  }, [collapsed]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [loc.pathname]);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  if (loading) return <p className="staff-dark p-8 text-center text-sm">Loading session…</p>;
  if (error) return <AuthRecovery error={error} retry={refreshIdentity} signOut={signOut} />;
  if (!user || !profile || role !== 'admin') return <Navigate to="/appointments/login" replace />;

  const activePage = NAV.find((n) => loc.pathname.startsWith(n.to))?.label ?? '';

  const linkCls = (active: boolean, centered: boolean) =>
    `portal-nav-link transition-colors ${
      centered ? 'justify-center' : ''
    } ${active ? 'bg-[#0e4a3a] font-semibold text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`;

  const renderLinks = (showLabels: boolean) => (
    <nav className="portal-nav">
      {NAV.map((n) => {
        const active = loc.pathname.startsWith(n.to);
        return (
          <Link
            key={n.to}
            to={n.to}
            title={n.label}
            aria-label={n.label}
            aria-current={active ? 'page' : undefined}
            className={linkCls(active, !showLabels)}
          >
            <span className="portal-nav-icon"><AppIcon icon={n.icon} size={20} /></span>
            {showLabels && <span className="truncate">{n.label}</span>}
          </Link>
        );
      })}
    </nav>
  );

  return (
    // Fixed viewport-height shell: the page itself never scrolls. The sidebar
    // stays pinned at full height while <main> below owns the only scroll
    // container. dvh (with vh fallback) keeps mobile browser chrome correct.
    <div className="staff-dark flex h-screen overflow-hidden supports-[height:100dvh]:h-[100dvh]">
      {/* Mobile top bar with hamburger (drawer trigger) */}
      <header className="portal-mobile-header fixed inset-x-0 top-0 z-30 flex items-center gap-2 border-b border-white/5 bg-black/70 backdrop-blur md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={mobileOpen}
          aria-controls="staff-mobile-nav"
          className="icon-button portal-menu-button rounded-lg text-slate-200 hover:bg-white/10 hover:text-white"
        >
          <AppIcon icon={Menu} size={22} />
        </button>
        <span className="portal-brand-icon rounded bg-[#0e4a3a] font-bold text-white"><AppIcon icon={Hospital} size={22} /></span>
        <span className="portal-brand-text truncate">Clinic admin</span>
        {activePage && <span className="portal-mobile-page ml-1 text-xs text-slate-400">· {activePage}</span>}
      </header>

      {/* Desktop sidebar: pinned full-height, never scrolls with content.
          Expanded (icon + text) / collapsed (icon only). */}
      <aside
        id="staff-sidebar"
        className={`portal-sidebar portal-sidebar--desktop hidden h-full shrink-0 flex-col border-r border-white/5 bg-black/50 transition-[width] duration-200 ease-in-out md:flex ${
          collapsed ? 'portal-sidebar--collapsed' : ''
        }`}
      >
        <div className="portal-sidebar-header">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            aria-controls="staff-sidebar"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="icon-button portal-menu-button rounded-lg text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
          >
            <AppIcon icon={Menu} size={22} />
          </button>
          <span className="portal-brand-icon rounded bg-[#0e4a3a] font-bold text-white"><AppIcon icon={Hospital} size={22} /></span>
          {!collapsed && <span className="portal-brand-text truncate">Clinic admin</span>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">{renderLinks(!collapsed)}</div>

        <div className="portal-account">
          {collapsed ? (
            <div
              title={`${profile.full_name} · ${role}`}
              className="portal-account-avatar mx-auto flex items-center justify-center rounded-full bg-[#0e4a3a]/40 font-bold text-[#9fd8cb]"
            >
              {(profile.full_name.trim()[0] ?? '?').toUpperCase()}
            </div>
          ) : (
            <div className="portal-account-card bg-white/5">
              <p className="portal-account-name truncate">{profile.full_name}</p>
              <p className="portal-account-role uppercase tracking-wider text-[#4ea895]">{role}</p>
            </div>
          )}
          <button
            className={`portal-signout text-slate-300 hover:bg-white/5 hover:text-white ${
              collapsed ? 'justify-center' : ''
            }`}
            onClick={() => {
              void signOut();
            }}
            title="Sign out"
            aria-label="Sign out"
          >
            <span className="portal-nav-icon"><AppIcon icon={LogOut} size={18} /></span>
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      {/* Mobile drawer backdrop */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
        />
      )}

      {/* Mobile drawer: full labels, slides in as an overlay */}
      <aside
        id="staff-mobile-nav"
        aria-hidden={!mobileOpen}
        className={`portal-sidebar portal-sidebar--mobile fixed inset-y-0 left-0 z-40 flex flex-col border-r border-white/5 bg-[#0b1210] transition-transform duration-200 ease-in-out md:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="portal-sidebar-header">
          <span className="portal-brand-icon rounded bg-[#0e4a3a] font-bold text-white"><AppIcon icon={Hospital} size={22} /></span>
          <span className="portal-brand-text truncate">Clinic admin</span>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation menu"
            className="icon-button portal-menu-button ml-auto rounded-lg text-slate-300 hover:bg-white/5 hover:text-white"
          >
            <AppIcon icon={X} size={22} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">{renderLinks(true)}</div>

        <div className="portal-account">
          <div className="portal-account-card bg-white/5">
            <p className="portal-account-name truncate">{profile.full_name}</p>
            <p className="portal-account-role uppercase tracking-wider text-[#4ea895]">{role}</p>
          </div>
          <button
            className="portal-signout text-slate-300 hover:bg-white/5 hover:text-white"
            onClick={() => {
              void signOut();
            }}
            title="Sign out"
            aria-label="Sign out"
          >
            <span className="portal-nav-icon"><AppIcon icon={LogOut} size={18} /></span>
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main content owns the only scroll container — sidebar stays put. */}
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 pt-16 md:p-6 md:pt-6">
        <div className="mx-auto w-full max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
