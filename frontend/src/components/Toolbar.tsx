import { LogOut, KeyRound, Sun, Moon, Shield, Clock, ChevronDown, HelpCircle, Eye, History } from 'lucide-react';
import { useWorkflowStore } from '../store/workflowStore';
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { CredentialsModal } from './ui/CredentialsModal';
import { useAuthStore } from '../store/authStore';
import { useTourStore } from '../store/tourStore';
import { useQuery } from '@tanstack/react-query';
import { fetchAdminStats } from '../api/auth';
import { OwnerDashboard } from './admin/OwnerDashboard';
import { SurveillanceDashboard } from './admin/SurveillanceDashboard';

export function Toolbar() {
  const {
    activeWorkflow,
    setActiveWorkflow,
    isDirty,
    setDirty,
    theme,
    setTheme,
  } = useWorkflowStore();

  const { user, logout } = useAuthStore();
  const { start: startTour } = useTourStore();
  const navigate = useNavigate();
  const isOwner = user?.role === 'owner';

  // Pending user count badge — only fetched for owners, every 60 s
  const { data: adminStats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: fetchAdminStats,
    enabled: isOwner,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const [ownerDashOpen, setOwnerDashOpen] = useState(false);
  const [surveillanceOpen, setSurveillanceOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 });
  const profileRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [nameEdit, setNameEdit] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [credentialsOpen, setCredentialsOpen] = useState(false);

  const isNew = activeWorkflow?.id?.startsWith('__new__') ?? false;

  // Close profile dropdown when clicking outside
  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      const target = e.target as Node;
      const insideTrigger  = profileRef.current?.contains(target) ?? false;
      const insideDropdown = dropdownRef.current?.contains(target) ?? false;
      if (!insideTrigger && !insideDropdown) setProfileOpen(false);
    }
    if (profileOpen) document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, [profileOpen]);

  function openProfile() {
    if (profileRef.current) {
      const rect = profileRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    }
    setProfileOpen(v => !v);
  }

  return (
    <>
    <header className="h-12 glass-surface border-b border-black/[0.07] dark:border-white/10 flex items-center px-4 gap-4 shrink-0">
      <div className="flex items-center gap-2">
        <img src="/logo.png" alt="Flux Workflow" className="w-6 h-6 rounded-md object-contain" />
        <span className="font-semibold text-sm text-slate-700 dark:text-slate-200">Flux Workflow</span>
      </div>

      <div className="w-px h-6 glass-divider" />

      {activeWorkflow ? (
        nameEdit ? (
          <input
            autoFocus
            className="bg-black/5 dark:bg-white/8 border border-black/10 dark:border-white/15 text-gray-900 dark:text-white text-sm rounded px-2 py-0.5 w-56 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={() => {
              if (nameValue.trim()) {
                setActiveWorkflow({ ...activeWorkflow, name: nameValue.trim() });
                setDirty(true);
              }
              setNameEdit(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setNameEdit(false);
            }}
          />
        ) : (
          <button
            className="text-gray-900 dark:text-white text-sm font-medium hover:text-blue-600 dark:hover:text-blue-300 transition-colors"
            onClick={() => { setNameValue(activeWorkflow.name); setNameEdit(true); }}
          >
            {activeWorkflow.name}
            {!isNew && (
              <span className="ml-1.5 text-slate-400 dark:text-slate-500 text-xs font-normal">
                v{activeWorkflow.version}
              </span>
            )}
            {isDirty && <span className="ml-1 text-amber-500 dark:text-amber-400 text-xs">●</span>}
          </button>
        )
      ) : (
        <span className="text-slate-400 dark:text-slate-500 text-sm">No workflow selected</span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <button
          id="tour-credentials-btn"
          onClick={() => setCredentialsOpen(true)}
          title="Manage Google Workspace credentials"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
          <KeyRound className="w-3.5 h-3.5" />
          Credentials
        </button>

        <button
          onClick={() => {
            if (activeWorkflow && !isNew) {
              navigate(`/workflows/${activeWorkflow.id}/history`);
            }
          }}
          disabled={!activeWorkflow || isNew}
          title={activeWorkflow && !isNew ? `View execution history for ${activeWorkflow.name}` : 'Select a saved workflow to view history'}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
            activeWorkflow && !isNew
              ? 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10'
              : 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          History
        </button>

        <div className="w-px h-5 glass-divider" />

        {/* ── Help / Tour ─────────────────────────────────────────────── */}
        <button
          onClick={startTour}
          title="Start interactive tour"
          className="flex items-center justify-center w-7 h-7 rounded text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors"
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>

        {/* ── Theme toggle ──────────────────────────────────────────────── */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="flex items-center justify-center w-7 h-7 rounded text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
          {theme === 'dark'
            ? <Sun className="w-3.5 h-3.5" />
            : <Moon className="w-3.5 h-3.5" />
          }
        </button>

        {/* Platform Owner dashboard buttons */}
        {isOwner && (
          <>
            <button
              onClick={() => setSurveillanceOpen(true)}
              title="Workflow Surveillance — monitor all running, scheduled, and flagged workflows"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
              Surveillance
            </button>

            <button
              onClick={() => setOwnerDashOpen(true)}
              title="Platform Owner Dashboard"
              className="relative flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition-colors"
            >
              <Shield className="w-3.5 h-3.5" />
              Owners
              {(adminStats?.pending ?? 0) > 0 && (
                <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold leading-none">
                  <Clock className="w-2.5 h-2.5" />
                  {adminStats!.pending}
                </span>
              )}
            </button>
          </>
        )}

        <div className="w-px h-5 glass-divider" />

        {/* User avatar — trigger */}
        <div ref={profileRef}>
          <button
            id="tour-avatar"
            onClick={openProfile}
            className="flex items-center gap-1.5 rounded-full hover:ring-2 hover:ring-blue-400/50 transition-all focus:outline-none"
            title="Your profile"
          >
            {user?.avatar ? (
              <img src={user.avatar} alt={user?.name ?? 'User'} className="w-7 h-7 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-600" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-violet-500 flex items-center justify-center text-white text-xs font-bold">
                {user?.name?.charAt(0).toUpperCase() ?? '?'}
              </div>
            )}
            <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform duration-200 ${profileOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>
    </header>

    {ownerDashOpen && <OwnerDashboard onClose={() => setOwnerDashOpen(false)} />}
    {surveillanceOpen && <SurveillanceDashboard onClose={() => setSurveillanceOpen(false)} />}

    <CredentialsModal open={credentialsOpen} onClose={() => setCredentialsOpen(false)} />

    {/* Profile dropdown — rendered via portal so it escapes overflow:hidden parents */}
    {profileOpen && createPortal(
      <div
        ref={dropdownRef}
        style={{ position: 'fixed', top: dropdownPos.top, right: dropdownPos.right, zIndex: 9999 }}
        className="w-64 bg-white dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-3 flex items-center gap-3 border-b border-slate-100 dark:border-slate-700/60">
          {user?.avatar ? (
            <img src={user.avatar} alt={user?.name ?? 'User'} className="w-11 h-11 rounded-full object-cover ring-2 ring-blue-400/30 shrink-0" />
          ) : (
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-blue-400 to-violet-500 flex items-center justify-center text-white text-base font-bold shrink-0">
              {user?.name?.charAt(0).toUpperCase() ?? '?'}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 dark:text-white truncate leading-tight">{user?.name ?? '—'}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{user?.email ?? '—'}</p>
          </div>
        </div>

        {/* Role */}
        <div className="px-4 py-2.5 flex items-center justify-between border-b border-slate-100 dark:border-slate-700/60">
          <span className="text-xs text-slate-500 dark:text-slate-400">Role</span>
          {user?.role === 'owner' ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 text-[11px] font-semibold">
              <Shield className="w-3 h-3" />
              Platform Owner
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 text-[11px] font-semibold">
              User
            </span>
          )}
        </div>

        {/* Status */}
        <div className="px-4 py-2.5 flex items-center justify-between border-b border-slate-100 dark:border-slate-700/60">
          <span className="text-xs text-slate-500 dark:text-slate-400">Status</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
            Active
          </span>
        </div>

        {/* Sign out */}
        <div className="px-2 py-2">
          <button
            onClick={() => { setProfileOpen(false); logout(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors font-medium"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </div>,
      document.body,
    )}
    </>
  );
}
