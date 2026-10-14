import { useEffect, useState } from 'react';
import { listBuilds, updateWorkflow } from '../services/workflowApi';
import { RecordedSteps } from './RecordedSteps';
import { renumber } from '../utils/recorderCore';
import { useRun } from '../hooks/useRun';
import { useWorkflows } from '../hooks/useWorkflows';
import { isTerminal, type WorkflowBuild } from '../types/build';
import type { Workflow, WorkflowStep } from '../types/workflow';

interface WorkflowRunsSectionProps {
  token: string;
  hasToken: boolean;
  /** True while a snapshot-queue finalize is running (Percy is single-instance). */
  busy: boolean;
}

const STATUS_LABEL: Record<WorkflowBuild['status'], string> = {
  queued: 'Queued',
  running: 'Running',
  passed: 'Passed',
  failed: 'Failed',
  partial: 'Partially completed',
  cancelled: 'Cancelled',
};

const STEP_ICON: Record<string, string> = {
  pending: '○',
  running: '◐',
  passed: '✓',
  failed: '✕',
  skipped: '–',
};

function secretNames(workflow: Workflow): string[] {
  return [...new Set(workflow.steps.map((s) => s.valueRef).filter((r): r is string => !!r))];
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * Saved workflows on the Snapshots page: pick one, replay it to create a Percy
 * build, follow progress, and browse earlier builds.
 */
export function WorkflowRunsSection({ token, hasToken, busy }: WorkflowRunsSectionProps) {
  const { workflows, error: listError, refresh } = useWorkflows(true);
  // Inline editor: a working copy of the selected workflow's steps.
  const [editSteps, setEditSteps] = useState<WorkflowStep[] | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const run = useRun(token, () => setHistoryKey((k) => k + 1));
  const [selectedId, setSelectedId] = useState('');
  // Secrets live only in this component's state for the run: never persisted.
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [builds, setBuilds] = useState<WorkflowBuild[]>([]);

  useEffect(() => {
    let cancelled = false;
    listBuilds()
      .then((b) => {
        if (!cancelled) setBuilds(b);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [historyKey]);

  const selected = workflows.find((w) => w.workflowId === selectedId) ?? workflows[0];
  const needed = selected ? secretNames(selected) : [];
  const missing = needed.filter((n) => !secrets[n]);
  const editing = editSteps !== null;
  const canStart =
    hasToken && !busy && !!selected && !run.running && !run.starting && missing.length === 0 && !editing;

  function closeEditor() {
    if (editSaving) return;
    setEditSteps(null);
    setEditError(null);
  }

  async function handleSaveEdit() {
    if (!selected?.workflowId || !editSteps) return;
    setEditSaving(true);
    setEditError(null);
    try {
      await updateWorkflow(selected.workflowId, { ...selected, steps: renumber(editSteps) });
      await refresh();
      setEditSteps(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e));
    } finally {
      setEditSaving(false);
    }
  }

  async function handleStart() {
    if (!selected?.workflowId) return;
    await run.start(selected.workflowId, Object.fromEntries(needed.map((n) => [n, secrets[n]])));
    setSecrets({});
  }

  const build = run.build;
  const done = build ? isTerminal(build.status) : false;
  const passedSteps = build ? build.steps.filter((s) => s.status === 'passed').length : 0;
  const firstError = build?.errors[0];

  return (
    <section className="workflow-runs" aria-label="Recorded workflows">
      <div className="page-header">
        <div>
          <h1>Recorded Workflows</h1>
          <p>Replay a recorded journey to create a new Percy build. Record one from the extension popup.</p>
        </div>
        <div className="stat-pill">
          <span className="stat-pill__value">{workflows.length}</span>
          <span className="stat-pill__label">Saved</span>
        </div>
      </div>

      {listError && <p className="message message--error">{listError}</p>}

      {workflows.length === 0 && !listError && (
        <div className="empty-state">
          No workflows yet. Click “Record Workflow” in the extension popup, use the floating panel on the page, and
          save.
        </div>
      )}

      {workflows.length > 0 && !build && (
        <div className="workflow-runs__card">
          <div className="token-section">
            <label htmlFor="wf-select">Workflow</label>
            <select
              id="wf-select"
              className="input"
              value={selected?.workflowId ?? ''}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setEditSteps(null);
                setEditError(null);
              }}
              disabled={editing}
            >
              {workflows.map((w) => (
                <option key={w.workflowId} value={w.workflowId}>
                  {w.name} (v{w.version}, {w.steps.filter((s) => s.type === 'snapshot').length} snapshots)
                </option>
              ))}
            </select>

            {selected && !editing && (
              <div>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => {
                    setEditSteps(selected.steps);
                    setEditError(null);
                  }}
                >
                  Edit workflow
                </button>
              </div>
            )}

            {needed.map((name) => (
              <div key={name} className="token-section">
                <label htmlFor={`wf-secret-${name}`}>{name}</label>
                <input
                  id={`wf-secret-${name}`}
                  className="input"
                  type="password"
                  autoComplete="off"
                  value={secrets[name] ?? ''}
                  onChange={(e) => setSecrets((s) => ({ ...s, [name]: e.target.value }))}
                />
              </div>
            ))}
            {needed.length > 0 && <span className="snapshot-edit-help">Used for this run only. Never saved.</span>}
          </div>

          {!hasToken && (
            <p className="message message--error">
              A Percy token is required. Click the ⚙ icon in the extension popup to set it.
            </p>
          )}
          {busy && (
            <p className="message message--error">A snapshot build is being finalized. Wait for it to finish.</p>
          )}

          <div>
            <button type="button" className="button button--primary" onClick={handleStart} disabled={!canStart}>
              {run.starting ? 'Starting…' : 'Replay / Create Build'}
            </button>
          </div>
          {run.error && <p className="message message--error">{run.error}</p>}
        </div>
      )}

      {selected && editSteps && (
        <div
          className="snapshot-edit-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeEditor();
          }}
        >
          <div
            className="snapshot-edit-panel workflow-edit-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workflow-edit-title"
          >
            <header className="snapshot-edit-panel__header">
              <div>
                <span className="snapshot-edit-panel__eyebrow">Edit workflow</span>
                <h2 id="workflow-edit-title">{selected.name}</h2>
                <p>Reorder, edit or remove steps. Changes apply to the next replay.</p>
              </div>
              <button
                type="button"
                className="snapshot-edit-panel__close"
                aria-label="Close"
                onClick={closeEditor}
                disabled={editSaving}
              >
                ×
              </button>
            </header>

            <div className="workflow-edit-panel__steps">
              <RecordedSteps steps={editSteps} editable={true} onChange={setEditSteps} />
            </div>

            {editError && <p className="message message--error">{editError}</p>}

            <div className="snapshot-edit-panel__actions">
              <button type="button" className="button button--secondary" onClick={closeEditor} disabled={editSaving}>
                Cancel
              </button>
              <button
                type="button"
                className="button button--primary"
                onClick={handleSaveEdit}
                disabled={editSaving || editSteps.length === 0}
              >
                {editSaving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {build && (
        <div className={`build-card${build.status === 'failed' ? ' build-card--failed' : ''}${build.status === 'passed' ? ' build-card--success' : ''}`}>
          <div className="build-summary">
            <div className="build-summary__row">
              <span className="build-summary__count">{STATUS_LABEL[build.status]}</span>
              <span className="build-summary__text">
                {build.workflowName} · v{build.workflowVersion} · {passedSteps}/{build.steps.length} steps
                {!done && build.currentStepId ? ` · ${build.currentStepId}` : ''}
              </span>
            </div>
            <div className="build-bar">
              <div
                className={`build-bar__fill${!done ? ' build-bar__fill--live' : ''}${build.status === 'failed' ? ' build-bar__fill--failed' : ''}`}
                style={{ width: `${build.steps.length ? Math.round((passedSteps / build.steps.length) * 100) : 0}%` }}
              />
            </div>
          </div>

          <ul className="build-snapshots" aria-label="Steps">
            {build.steps.map((s) => (
              <li
                key={s.stepId}
                className={`build-snapshot build-snapshot--${s.status === 'passed' ? 'sent' : s.status === 'failed' ? 'failed' : s.status === 'running' ? 'sending' : 'pending'}`}
              >
                <span className="build-snapshot__badge" aria-hidden="true" />
                <span className="build-snapshot__main">
                  <span className="build-snapshot__name">
                    {STEP_ICON[s.status]} {s.stepId} · {s.type}
                  </span>
                  {s.error && <span className="build-snapshot__error">{s.error}</span>}
                </span>
                <span className="build-snapshot__state">{s.status}</span>
              </li>
            ))}
          </ul>

          {build.checkpoints.length > 0 && (
            <ul className="build-snapshots" aria-label="Checkpoints">
              {build.checkpoints.map((c) => (
                <li
                  key={c.checkpointId}
                  className={`build-snapshot build-snapshot--${c.status === 'uploaded' ? 'sent' : c.status === 'failed' ? 'failed' : 'sending'}`}
                >
                  <span className="build-snapshot__badge" aria-hidden="true" />
                  <span className="build-snapshot__main">
                    <span className="build-snapshot__name">{c.name}</span>
                    {c.error && <span className="build-snapshot__error">{c.error}</span>}
                  </span>
                  <span className="build-snapshot__state">{c.status}</span>
                </li>
              ))}
            </ul>
          )}

          {done && firstError && build.status !== 'passed' && (
            <div className="build-alert" role="alert">
              <strong>{firstError.stepId ? `${firstError.stepId}: ` : ''}Run did not complete cleanly</strong>
              <span>{firstError.message}</span>
            </div>
          )}

          <div className="workflow-runs__actions">
            {build.percyBuildUrl && (
              <a className="button button--link" href={build.percyBuildUrl} target="_blank" rel="noreferrer">
                Open Percy build →
              </a>
            )}
            {!done ? (
              <button type="button" className="button button--danger" onClick={run.cancel}>
                Cancel run
              </button>
            ) : (
              <button type="button" className="button button--secondary" onClick={run.dismiss}>
                Close
              </button>
            )}
          </div>
        </div>
      )}

      {builds.length > 0 && (
        <div className="table-wrap">
          <table className="snapshot-table">
            <thead>
              <tr>
                <th>Workflow</th>
                <th>Version</th>
                <th>Status</th>
                <th>Started</th>
                <th>Percy</th>
              </tr>
            </thead>
            <tbody>
              {builds.slice(0, 10).map((b) => (
                <tr key={b.buildId} className="snapshot-row">
                  <td className="snapshot-row__name">{b.workflowName}</td>
                  <td>v{b.workflowVersion}</td>
                  <td>{STATUS_LABEL[b.status]}</td>
                  <td className="snapshot-row__viewport">{when(b.createdAt)}</td>
                  <td>
                    {b.percyBuildUrl ? (
                      <a href={b.percyBuildUrl} target="_blank" rel="noreferrer">
                        Open
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
