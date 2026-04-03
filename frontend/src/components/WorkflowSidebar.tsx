import { useEffect, useRef, useState } from 'react';
import {
  Plus, Trash2, Loader2, GitBranch, ChevronRight,
  FolderOpen, Folder, Share2, FolderPlus, MoreHorizontal, Pencil, Check, X,
  GripVertical,
} from 'lucide-react';
import { useWorkflowList, useDeleteWorkflow, useUpdateWorkflow } from '../hooks/useWorkflows';
import { ConfirmModal } from './ui/ConfirmModal';
import { useWorkflowStore } from '../store/workflowStore';
import { deserialize } from './canvas/canvasUtils';
import type { WorkflowDefinition } from '../types/workflow';

// ── Project types & persistence ───────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  workflowIds: string[];
}

const PROJECTS_KEY = 'wap_projects';
const OPEN_PROJECTS_KEY = 'wap_open_projects';

function loadProjects(): Project[] {
  try {
    return JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveProjects(projects: Project[]) {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

function loadOpenProjects(): Set<string> {
  try {
    const arr = JSON.parse(localStorage.getItem(OPEN_PROJECTS_KEY) ?? '[]') as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function saveOpenProjects(ids: Set<string>) {
  localStorage.setItem(OPEN_PROJECTS_KEY, JSON.stringify([...ids]));
}

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

// ── Uniform workflow icon ─────────────────────────────────────────────────────

function WorkflowIcon() {
  return <Share2 className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />;
}

// ── Single workflow row ───────────────────────────────────────────────────────

interface WorkflowRowProps {
  wf: WorkflowDefinition;
  isActive: boolean;
  onLoad: (wf: WorkflowDefinition) => void;
  onDelete: (wf: WorkflowDefinition) => void;
  onRename: (wf: WorkflowDefinition, newName: string) => void;
  onDragStart: (e: React.DragEvent, wfId: string) => void;
}

function WorkflowRow({ wf, isActive, onLoad, onDelete, onRename, onDragStart }: WorkflowRowProps) {
  const [menuOpen, setMenuOpen]   = useState(false);
  const [editing, setEditing]     = useState(false);
  const [draft, setDraft]         = useState(wf.name);
  const menuRef   = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [menuOpen]);

  useEffect(() => {
    if (editing) { setDraft(wf.name); inputRef.current?.focus(); }
  }, [editing, wf.name]);

  function commitRename() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== wf.name) onRename(wf, trimmed);
    setEditing(false);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => { if (!editing) onLoad(wf); }}
      onKeyDown={(e) => { if (!editing && (e.key === 'Enter' || e.key === ' ')) onLoad(wf); }}
      className={[
        'group relative flex items-center gap-1.5 px-1.5 py-1.5 rounded-lg text-left select-none',
        'transition-colors duration-100',
        editing ? 'cursor-default' : 'cursor-pointer',
        isActive
          ? 'bg-blue-100 dark:bg-blue-500/25 ring-1 ring-blue-300 dark:ring-blue-500/40'
          : 'hover:bg-black/5 dark:hover:bg-white/8',
      ].join(' ')}
    >
      {/* Drag handle */}
      <div
        draggable
        onDragStart={(e) => { e.stopPropagation(); onDragStart(e, wf.id); }}
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 cursor-grab active:cursor-grabbing text-slate-300 dark:text-slate-600
                   hover:text-slate-500 dark:hover:text-slate-400 transition-colors"
        title="Drag to move"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </div>

      <WorkflowIcon />

      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter')  commitRename();
            if (e.key === 'Escape') { setDraft(wf.name); setEditing(false); }
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 bg-transparent text-[12px] font-medium
                     text-slate-700 dark:text-slate-200 outline-none
                     border-b border-blue-400 dark:border-blue-500"
        />
      ) : (
        <span
          className={[
            'flex-1 min-w-0 text-[12px] font-medium truncate',
            isActive
              ? 'text-blue-700 dark:text-blue-200 font-semibold'
              : 'text-slate-600 dark:text-slate-300',
          ].join(' ')}
        >
          {wf.name}
        </span>
      )}

      {/* Context menu trigger */}
      <div className="relative shrink-0" ref={menuRef}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((p) => !p); }}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded
                     text-slate-400 dark:text-slate-500
                     hover:text-slate-600 dark:hover:text-slate-300 transition-all"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 z-50 w-36 bg-white dark:bg-slate-800
                          border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg overflow-hidden">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                setEditing(true);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[12px]
                         text-slate-600 dark:text-slate-300
                         hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              <Pencil className="w-3 h-3" />
              Rename
            </button>
            <div className="h-px bg-slate-100 dark:bg-slate-700/60" />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(wf); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-red-500
                         hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Project section ───────────────────────────────────────────────────────────

interface ProjectSectionProps {
  project: Project;
  workflows: WorkflowDefinition[];
  activeWorkflowId: string | null;
  isOpen: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onNewWorkflow: () => void;
  onLoadWorkflow: (wf: WorkflowDefinition) => void;
  onDeleteWorkflow: (wf: WorkflowDefinition) => void;
  onRenameWorkflow: (wf: WorkflowDefinition, newName: string) => void;
  onWorkflowDragStart: (e: React.DragEvent, wfId: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, projectId: string) => void;
}

function ProjectSection({
  project, workflows, activeWorkflowId, isOpen,
  onToggle, onRename, onDelete, onNewWorkflow,
  onLoadWorkflow, onDeleteWorkflow, onRenameWorkflow, onWorkflowDragStart,
  onDragOver, onDrop,
}: ProjectSectionProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commitRename() {
    const trimmed = draft.trim();
    if (trimmed) onRename(trimmed);
    else setDraft(project.name);
    setEditing(false);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); onDragOver(e); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => { setIsDragOver(false); onDrop(e, project.id); }}
      className={[
        'rounded-lg transition-colors duration-150',
        isDragOver ? 'bg-blue-500/8 dark:bg-blue-500/12 ring-1 ring-blue-400/30' : '',
      ].join(' ')}
    >
      {/* Project header */}
      <div className="group flex items-center gap-1 px-1.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/8 transition-colors cursor-pointer">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-1.5 flex-1 min-w-0"
        >
          <ChevronRight
            className={`w-3 h-3 text-slate-400 dark:text-slate-500 shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`}
          />
          {isOpen
            ? <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            : <Folder     className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          }
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') { setDraft(project.name); setEditing(false); }
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-w-0 bg-transparent text-[12px] font-semibold
                         text-slate-700 dark:text-slate-200 outline-none border-b
                         border-blue-400 dark:border-blue-500"
            />
          ) : (
            <span className="flex-1 min-w-0 text-[12px] font-semibold text-slate-600 dark:text-slate-300 truncate text-left">
              {project.name}
            </span>
          )}
        </button>

        {/* Project actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {editing ? (
            <>
              <button type="button" onClick={commitRename} className="p-0.5 rounded text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10">
                <Check className="w-3 h-3" />
              </button>
              <button type="button" onClick={() => { setDraft(project.name); setEditing(false); }} className="p-0.5 rounded text-slate-400 hover:bg-black/5 dark:hover:bg-white/8">
                <X className="w-3 h-3" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                title="Rename project"
                onClick={(e) => { e.stopPropagation(); setDraft(project.name); setEditing(true); }}
                className="p-0.5 rounded text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-black/5 dark:hover:bg-white/8"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                type="button"
                title="New workflow in project"
                onClick={(e) => { e.stopPropagation(); onNewWorkflow(); }}
                className="p-0.5 rounded text-slate-400 dark:text-slate-500 hover:text-blue-500 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10"
              >
                <Plus className="w-3 h-3" />
              </button>
              <button
                type="button"
                title="Delete project"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="p-0.5 rounded text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Workflow list */}
      {isOpen && (
        <div className="ml-4 pl-2 border-l border-slate-200/70 dark:border-slate-700/60 space-y-0.5 pb-1">
          {workflows.length === 0 ? (
            <p className="text-[11px] text-slate-400 dark:text-slate-600 px-2 py-1.5 italic">
              Drop workflows here
            </p>
          ) : (
            workflows.map((wf) => (
              <WorkflowRow
                key={wf.id}
                wf={wf}
                isActive={activeWorkflowId === wf.id}
                onLoad={onLoadWorkflow}
                onDelete={onDeleteWorkflow}
                onRename={onRenameWorkflow}
                onDragStart={onWorkflowDragStart}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Main sidebar ──────────────────────────────────────────────────────────────

export function WorkflowSidebar() {
  const { data: workflows, isLoading } = useWorkflowList();
  const deleteWf  = useDeleteWorkflow();
  const updateWf  = useUpdateWorkflow();
  const {
    activeWorkflow,
    setActiveWorkflow,
    setNodes,
    setEdges,
    setDirty,
    setSelectedNodeId,
    pendingNewProjectName,
    setPendingNewProjectName,
  } = useWorkflowStore();

  const [projects, setProjectsState] = useState<Project[]>(loadProjects);
  const [openProjects, setOpenProjects] = useState<Set<string>>(loadOpenProjects);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const newProjectInputRef = useRef<HTMLInputElement>(null);
  const [, setDraggingWfId] = useState<string | null>(null);
  const [ungroupedDragOver, setUngroupedDragOver] = useState(false);
  // Tracks the previous activeWorkflow id so the project-assignment effect
  // only fires when a __new__ workflow transitions to a real saved id.
  const prevActiveIdRef = useRef<string | null>(null);

  // ── Modal state ────────────────────────────────────────────────────────────
  type ModalState = {
    open: boolean; title: string; message: string;
    confirmLabel: string; danger: boolean;
    onConfirm: () => void;
  };
  const MODAL_CLOSED: ModalState = {
    open: false, title: '', message: '', confirmLabel: 'Confirm', danger: false, onConfirm: () => {},
  };
  const [modal, setModal] = useState<ModalState>(MODAL_CLOSED);
  const closeModal = () => setModal(MODAL_CLOSED);

  function showConfirm(
    title: string, message: string,
    confirmLabel: string, danger: boolean,
    onConfirm: () => void,
  ) {
    setModal({ open: true, title, message, confirmLabel, danger, onConfirm: () => { closeModal(); onConfirm(); } });
  }

  useEffect(() => { saveProjects(projects); }, [projects]);
  useEffect(() => { saveOpenProjects(openProjects); }, [openProjects]);

  // React to a project name submitted from the canvas modal
  useEffect(() => {
    if (!pendingNewProjectName) return;
    const name = pendingNewProjectName.trim();
    setPendingNewProjectName(null);
    if (!name) return;
    const id = newId();
    setProjectsState((prev) => [...prev, { id, name, workflowIds: [] }]);
    setOpenProjects((prev) => new Set([...prev, id]));
  }, [pendingNewProjectName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (creatingProject) newProjectInputRef.current?.focus();
  }, [creatingProject]);

  // Warn on browser refresh / tab close while a new unsaved workflow is open
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (activeWorkflow?.id === '__new__') {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [activeWorkflow?.id]);

  // Auto-load the first workflow on initial page load
  useEffect(() => {
    if (workflows?.length && !activeWorkflow) {
      loadWorkflow(workflows[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflows]);

  const list = workflows ?? [];

  // ── Helpers ────────────────────────────────────────────────────────────────

  function loadWorkflowImpl(wf: WorkflowDefinition) {
    sessionStorage.removeItem('wap_new_wf_project');
    const { nodes, edges } = deserialize(wf);
    setActiveWorkflow(wf);
    setNodes(nodes);
    setEdges(edges);
    setDirty(false);
    setSelectedNodeId(null);
  }

  function loadWorkflow(wf: WorkflowDefinition) {
    if (activeWorkflow?.id === '__new__') {
      showConfirm(
        'Discard new workflow?',
        'You have an unsaved new workflow. It will be lost if you continue.',
        'Discard', true,
        () => loadWorkflowImpl(wf),
      );
      return;
    }
    loadWorkflowImpl(wf);
  }

  function createNewWorkflowImpl(projectId?: string) {
    const newWf: WorkflowDefinition = {
      id: '__new__', name: 'New Workflow', version: 1, nodes: [], entryNodeId: '',
    };
    setActiveWorkflow(newWf);
    setNodes([]);
    setEdges([]);
    setDirty(true);
    setSelectedNodeId(null);
    if (projectId) {
      sessionStorage.setItem('wap_new_wf_project', projectId);
    } else {
      sessionStorage.removeItem('wap_new_wf_project');
    }
  }

  function createNewWorkflow(projectId?: string) {
    if (activeWorkflow?.id === '__new__') {
      showConfirm(
        'Discard current workflow?',
        'The current unsaved workflow will be lost if you continue.',
        'Discard', true,
        () => createNewWorkflowImpl(projectId),
      );
      return;
    }
    createNewWorkflowImpl(projectId);
  }

  function handleRenameWorkflow(wf: WorkflowDefinition, newName: string) {
    updateWf.mutate({ id: wf.id, body: { name: newName } });
    // Update the active workflow in the store if it's the one being renamed
    if (activeWorkflow?.id === wf.id) {
      setActiveWorkflow({ ...activeWorkflow, name: newName });
    }
  }

  function handleDeleteWorkflow(wf: WorkflowDefinition) {
    showConfirm(
      `Delete "${wf.name}"?`,
      'This workflow will be permanently deleted and cannot be recovered.',
      'Delete', true,
      () => {
        deleteWf.mutate(wf.id);
        setProjectsState((prev) =>
          prev.map((p) => ({ ...p, workflowIds: p.workflowIds.filter((id) => id !== wf.id) }))
        );
        if (activeWorkflow?.id === wf.id) {
          setActiveWorkflow(null);
          setNodes([]);
          setEdges([]);
        }
      },
    );
  }

  // ── Project CRUD ───────────────────────────────────────────────────────────

  function commitCreateProject() {
    const name = newProjectName.trim();
    if (!name) { setCreatingProject(false); return; }
    const id = newId();
    setProjectsState((prev) => [...prev, { id, name, workflowIds: [] }]);
    setOpenProjects((prev) => new Set([...prev, id]));
    setNewProjectName('');
    setCreatingProject(false);
  }

  function renameProject(projectId: string, name: string) {
    setProjectsState((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, name } : p))
    );
  }

  function deleteProject(projectId: string) {
    showConfirm(
      'Delete project?',
      'The project will be removed. Workflows inside will become ungrouped and are not deleted.',
      'Delete', true,
      () => {
        setProjectsState((prev) => prev.filter((p) => p.id !== projectId));
        setOpenProjects((prev) => { const s = new Set(prev); s.delete(projectId); return s; });
      },
    );
  }

  function toggleProject(projectId: string) {
    setOpenProjects((prev) => {
      const s = new Set(prev);
      if (s.has(projectId)) s.delete(projectId);
      else s.add(projectId);
      return s;
    });
  }

  // ── Drag & drop ────────────────────────────────────────────────────────────

  function handleWorkflowDragStart(e: React.DragEvent, wfId: string) {
    e.dataTransfer.setData('wap/workflow-id', wfId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingWfId(wfId);
  }

  function handleDropOnProject(e: React.DragEvent, projectId: string) {
    e.preventDefault();
    const wfId = e.dataTransfer.getData('wap/workflow-id');
    if (!wfId) return;
    setProjectsState((prev) =>
      prev.map((p) => {
        if (p.id === projectId) {
          // Add to target if not already there
          return p.workflowIds.includes(wfId)
            ? p
            : { ...p, workflowIds: [...p.workflowIds, wfId] };
        }
        // Remove from all other projects
        return { ...p, workflowIds: p.workflowIds.filter((id) => id !== wfId) };
      })
    );
    setDraggingWfId(null);
  }

  function handleDropOnUngrouped(e: React.DragEvent) {
    e.preventDefault();
    const wfId = e.dataTransfer.getData('wap/workflow-id');
    if (!wfId) return;
    // Remove from all projects (makes it ungrouped)
    setProjectsState((prev) =>
      prev.map((p) => ({ ...p, workflowIds: p.workflowIds.filter((id) => id !== wfId) }))
    );
    setUngroupedDragOver(false);
    setDraggingWfId(null);
  }

  // ── Derived data ───────────────────────────────────────────────────────────

  const allProjectedIds = new Set(projects.flatMap((p) => p.workflowIds));
  const ungrouped = list.filter((wf) => !allProjectedIds.has(wf.id));

  // After a newly-saved workflow gets a real ID, assign it to the pending project.
  // Only fires when the transition is __new__ → real ID to prevent accidentally
  // adding an existing workflow to a project when the user clicks away.
  useEffect(() => {
    const currentId = activeWorkflow?.id ?? null;
    const wasNew = prevActiveIdRef.current === '__new__';
    prevActiveIdRef.current = currentId;

    if (!wasNew || !currentId || currentId === '__new__') return;

    const pendingProjectId = sessionStorage.getItem('wap_new_wf_project');
    if (!pendingProjectId) return;

    const project = projects.find((p) => p.id === pendingProjectId);
    if (!project || project.workflowIds.includes(currentId)) return;

    setProjectsState((prev) =>
      prev.map((p) =>
        p.id === pendingProjectId
          ? { ...p, workflowIds: [...p.workflowIds, currentId] }
          : p
      )
    );
    sessionStorage.removeItem('wap_new_wf_project');
  }, [activeWorkflow?.id, projects]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
    <ConfirmModal
      open={modal.open}
      title={modal.title}
      message={modal.message}
      confirmLabel={modal.confirmLabel}
      danger={modal.danger}
      onConfirm={modal.onConfirm}
      onCancel={closeModal}
    />
    <aside id="tour-sidebar" className="w-72 glass-surface border-r border-black/[0.07] dark:border-white/10 flex flex-col shrink-0 overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="px-3 pt-3 pb-2.5 border-b border-black/[0.07] dark:border-white/10 shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
            Workflows
          </span>
          {list.length > 0 && (
            <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 bg-black/5 dark:bg-white/8 px-1.5 py-0.5 rounded-full">
              {list.length}
            </span>
          )}
        </div>
        <button
          onClick={() => createNewWorkflow()}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg
                     bg-blue-500 hover:bg-blue-600 active:bg-blue-700
                     text-white text-[12px] font-semibold
                     shadow-sm shadow-blue-500/25 transition-all duration-150 select-none"
        >
          <Plus className="w-3.5 h-3.5" />
          New Workflow
        </button>
      </div>

      {/* ── List ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0 py-1.5 px-2 space-y-0.5">

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-4 h-4 text-slate-400 dark:text-slate-500 animate-spin" />
          </div>

        ) : list.length === 0 && projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800/60 flex items-center justify-center mb-2.5">
              <GitBranch className="w-5 h-5 text-slate-400 dark:text-slate-500" />
            </div>
            <p className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">No workflows yet</p>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">
              Click <strong>New Workflow</strong> to get started
            </p>
          </div>

        ) : (
          <>
            {/* Ungrouped workflows */}
            {ungrouped.length > 0 && (
              <div
                onDragOver={(e) => { e.preventDefault(); setUngroupedDragOver(true); }}
                onDragLeave={() => setUngroupedDragOver(false)}
                onDrop={handleDropOnUngrouped}
                className={[
                  'rounded-lg space-y-0.5 transition-colors',
                  ungroupedDragOver ? 'bg-blue-500/8 dark:bg-blue-500/12 ring-1 ring-blue-400/30' : '',
                ].join(' ')}
              >
                {ungrouped.map((wf) => (
                  <WorkflowRow
                    key={wf.id}
                    wf={wf}
                    isActive={activeWorkflow?.id === wf.id}
                    onLoad={loadWorkflow}
                    onDelete={handleDeleteWorkflow}
                    onRename={handleRenameWorkflow}
                    onDragStart={handleWorkflowDragStart}
                  />
                ))}
              </div>
            )}

            {/* Project accordions */}
            {projects.map((project) => {
              const projectWorkflows = project.workflowIds
                .map((id) => list.find((wf) => wf.id === id))
                .filter((wf): wf is WorkflowDefinition => Boolean(wf));

              return (
                <ProjectSection
                  key={project.id}
                  project={project}
                  workflows={projectWorkflows}
                  activeWorkflowId={activeWorkflow?.id ?? null}
                  isOpen={openProjects.has(project.id)}
                  onToggle={() => toggleProject(project.id)}
                  onRename={(name) => renameProject(project.id, name)}
                  onDelete={() => deleteProject(project.id)}
                  onNewWorkflow={() => {
                    if (!openProjects.has(project.id)) toggleProject(project.id);
                    createNewWorkflow(project.id);
                  }}
                  onLoadWorkflow={loadWorkflow}
                  onDeleteWorkflow={handleDeleteWorkflow}
                  onRenameWorkflow={handleRenameWorkflow}
                  onWorkflowDragStart={handleWorkflowDragStart}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDropOnProject}
                />
              );
            })}
          </>
        )}
      </div>

      {/* ── Footer: new project ──────────────────────────────────────────────── */}
      <div className="shrink-0 px-2 pb-2.5 pt-1.5 border-t border-black/[0.07] dark:border-white/10">
        {creatingProject ? (
          <div className="flex items-center gap-1.5 px-2 py-1.5 bg-slate-100 dark:bg-slate-800/60 rounded-lg">
            <FolderPlus className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <input
              ref={newProjectInputRef}
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitCreateProject();
                if (e.key === 'Escape') { setCreatingProject(false); setNewProjectName(''); }
              }}
              placeholder="Project name…"
              className="flex-1 min-w-0 bg-transparent text-[12px] text-slate-700 dark:text-slate-200
                         placeholder-slate-400 dark:placeholder-slate-500 outline-none"
            />
            <button type="button" onClick={commitCreateProject} className="text-emerald-500 hover:text-emerald-600">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => { setCreatingProject(false); setNewProjectName(''); }} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreatingProject(true)}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg
                       text-[12px] text-slate-500 dark:text-slate-400
                       hover:bg-black/5 dark:hover:bg-white/8
                       hover:text-slate-700 dark:hover:text-slate-200
                       transition-colors duration-100 select-none"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            New Project
          </button>
        )}
      </div>
    </aside>
    </>
  );
}
