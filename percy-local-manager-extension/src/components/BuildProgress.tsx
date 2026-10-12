import { useEffect, useRef, useState } from 'react';
import type { BuildPhase, BuildStatus } from '../types';

const PHASES: { key: BuildPhase; label: string }[] = [
  { key: 'installing', label: 'Install' },
  { key: 'starting', label: 'Start' },
  { key: 'uploading', label: 'Upload' },
  { key: 'processing', label: 'Process' },
  { key: 'done', label: 'Done' },
];

const STATE_LABEL = {
  pending: 'Waiting',
  sending: 'Uploading',
  sent: 'Sent',
  failed: 'Failed',
} as const;

const STATE_ICON = {
  pending: '',
  sending: '',
  sent: '✓',
  failed: '✕',
} as const;

interface BuildProgressProps {
  build: BuildStatus;
}

export function BuildProgress({ build }: BuildProgressProps) {
  const [logsOpen, setLogsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const phaseIndex = PHASES.findIndex((p) => p.key === build.phase);
  const failed = build.status === 'failed';
  const succeeded = build.status === 'success';
  const percent =
    build.total > 0 ? Math.round((build.sent / build.total) * 100) : 0;
  const errorCount = build.logs.filter((l) => l.level === 'error').length;

  useEffect(() => {
    if (logsOpen) {
      logEndRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [build.logs.length, logsOpen]);

  async function handleCopy() {
    const text = build.logs
      .map((l) => `${l.ts} [${l.level}] ${l.line}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section
      className={`build-card${failed ? ' build-card--failed' : ''}${
        succeeded ? ' build-card--success' : ''
      }`}
      aria-label="Build progress"
    >
      <ol className="build-stepper">
        {PHASES.map((p, i) => {
          let state = 'todo';
          if (succeeded || i < phaseIndex) state = 'done';
          else if (i === phaseIndex) state = failed ? 'failed' : 'active';
          return (
            <li key={p.key} className={`build-step build-step--${state}`}>
              <span className="build-step__dot">
                {state === 'done' ? '✓' : state === 'failed' ? '✕' : i + 1}
              </span>
              <span className="build-step__label">{p.label}</span>
            </li>
          );
        })}
      </ol>

      <div className="build-summary">
        <div className="build-summary__row">
          <span className="build-summary__count">
            {build.sent}
            <span className="build-summary__total">/{build.total}</span>
          </span>
          <span className="build-summary__text">snapshots sent</span>
          <span className="build-summary__percent">{percent}%</span>
        </div>
        <div
          className="build-bar"
          role="progressbar"
          aria-label="Upload progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div
            className={`build-bar__fill${
              failed ? ' build-bar__fill--failed' : ''
            }${!failed && !succeeded ? ' build-bar__fill--live' : ''}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {failed && build.error && (
        <div className="build-alert" role="alert">
          <strong>Build failed</strong>
          <span>{build.error}</span>
        </div>
      )}

      <ul className="build-snapshots">
        {build.snapshots.map((s) => (
          <li key={s.id} className={`build-snapshot build-snapshot--${s.state}`}>
            <span className="build-snapshot__badge" aria-hidden="true">
              {STATE_ICON[s.state]}
            </span>
            <div className="build-snapshot__main">
              <span className="build-snapshot__name" title={s.name}>
                {s.name}
              </span>
              {s.error && (
                <span className="build-snapshot__error">{s.error}</span>
              )}
            </div>
            <span className="build-snapshot__state">{STATE_LABEL[s.state]}</span>
          </li>
        ))}
      </ul>

      <div className="build-logs">
        <div className="build-logs__bar">
          <button
            type="button"
            className="build-logs__toggle"
            aria-expanded={logsOpen}
            onClick={() => setLogsOpen((o) => !o)}
          >
            <span className="build-logs__chevron">{logsOpen ? '▾' : '▸'}</span>
            Logs
            <span className="build-logs__count">{build.logs.length}</span>
            {errorCount > 0 && (
              <span className="build-logs__count build-logs__count--error">
                {errorCount} error{errorCount > 1 ? 's' : ''}
              </span>
            )}
          </button>
          <button
            type="button"
            className="build-logs__copy"
            onClick={handleCopy}
            disabled={build.logs.length === 0}
          >
            {copied ? 'Copied ✓' : 'Copy logs'}
          </button>
        </div>
        {logsOpen && (
          <div className="build-logs__body" role="log">
            {build.logs.length === 0 && (
              <div className="build-log build-log--empty">No output yet…</div>
            )}
            {build.logs.map((l, i) => (
              <div key={i} className={`build-log build-log--${l.level}`}>
                <span className="build-log__tag">
                  {l.level === 'error' ? 'ERR' : l.level === 'warn' ? 'WRN' : 'INF'}
                </span>
                <span className="build-log__text">{l.line}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>
    </section>
  );
}
