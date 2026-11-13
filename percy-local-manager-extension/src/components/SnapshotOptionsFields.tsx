import type { SnapshotStepOptions } from '../types/workflow';

export interface SnapshotOptionsDraft {
  waitSeconds: string;
  widths: string[];
  minHeight: string;
  scope: string;
  enableJavaScript: boolean;
  percyCSS: string;
}

export function draftFromStep(waitMs: number | undefined, o?: SnapshotStepOptions): SnapshotOptionsDraft {
  return {
    waitSeconds: String((waitMs ?? 4000) / 1000),
    widths: (o?.widths?.length ? o.widths : []).map(String),
    minHeight: o?.minHeight ? String(o.minHeight) : '',
    scope: o?.scope ?? '',
    enableJavaScript: o?.enableJavaScript ?? false,
    percyCSS: o?.percyCSS ?? '',
  };
}

/** Validates the draft; returns an error string or the values to store. */
export function parseDraft(
  d: SnapshotOptionsDraft,
): { error: string } | { waitMs: number; options: SnapshotStepOptions | undefined } {
  const sec = Number(d.waitSeconds);
  if (d.waitSeconds.trim() === '' || !Number.isFinite(sec) || sec < 0 || sec > 60) {
    return { error: 'Wait must be between 0 and 60 seconds.' };
  }
  const widths: number[] = [];
  for (const w of d.widths) {
    if (w.trim() === '') continue;
    const n = Number(w);
    if (!Number.isInteger(n) || n < 1 || n > 4000) return { error: 'Widths must be whole numbers from 1 to 4000.' };
    widths.push(n);
  }
  if (widths.length > 10) return { error: 'At most 10 widths.' };
  let minHeight: number | undefined;
  if (d.minHeight.trim() !== '') {
    minHeight = Number(d.minHeight);
    if (!Number.isInteger(minHeight) || minHeight < 0 || minHeight > 20000) {
      return { error: 'Minimum height must be 0 to 20000.' };
    }
  }
  if (d.scope.length > 500) return { error: 'Scope is too long.' };
  if (d.percyCSS.length > 10000) return { error: 'Percy CSS is too long.' };
  const options: SnapshotStepOptions = {};
  if (widths.length) options.widths = widths;
  if (minHeight) options.minHeight = minHeight;
  if (d.scope.trim()) options.scope = d.scope.trim();
  if (d.enableJavaScript) options.enableJavaScript = true;
  if (d.percyCSS.trim()) options.percyCSS = d.percyCSS.trim();
  return { waitMs: Math.round(sec * 1000), options: Object.keys(options).length ? options : undefined };
}

interface Props {
  idPrefix: string;
  value: SnapshotOptionsDraft;
  onChange: (next: SnapshotOptionsDraft) => void;
}

/** Wait-before-capture + advanced Percy options for one snapshot step. */
export function SnapshotOptionsFields({ idPrefix, value, onChange }: Props) {
  const set = <K extends keyof SnapshotOptionsDraft>(k: K, v: SnapshotOptionsDraft[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <>
      <label className="field-label" htmlFor={`${idPrefix}-wait`}>
        Wait before capture (seconds)
      </label>
      <input
        id={`${idPrefix}-wait`}
        className="text-input"
        type="number"
        min={0}
        max={60}
        step="0.5"
        value={value.waitSeconds}
        onChange={(e) => set('waitSeconds', e.target.value)}
      />

      <label className="field-label">Widths (blank = recorded viewport)</label>
      {value.widths.map((w, i) => (
        <div className="width-row" key={i}>
          <input
            className="text-input"
            type="number"
            min={1}
            aria-label={`Width ${i + 1}`}
            value={w}
            onChange={(e) => set('widths', value.widths.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button
            type="button"
            className="width-remove"
            aria-label={`Remove width ${i + 1}`}
            onClick={() => set('widths', value.widths.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="button button--link" onClick={() => set('widths', [...value.widths, '1280'])}>
        + Add width
      </button>

      <label className="field-label" htmlFor={`${idPrefix}-minh`}>
        Minimum height
      </label>
      <input
        id={`${idPrefix}-minh`}
        className="text-input"
        type="number"
        min={0}
        value={value.minHeight}
        onChange={(e) => set('minHeight', e.target.value)}
      />

      <label className="field-label" htmlFor={`${idPrefix}-scope`}>
        Scope
      </label>
      <input
        id={`${idPrefix}-scope`}
        className="text-input"
        placeholder=".main-content"
        value={value.scope}
        onChange={(e) => set('scope', e.target.value)}
      />

      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={value.enableJavaScript}
          onChange={(e) => set('enableJavaScript', e.target.checked)}
        />
        <span>Enable JavaScript</span>
      </label>

      <label className="field-label" htmlFor={`${idPrefix}-css`}>
        Percy CSS
      </label>
      <textarea
        id={`${idPrefix}-css`}
        className="text-input textarea-input"
        rows={3}
        placeholder=".modal { display: none; }"
        value={value.percyCSS}
        onChange={(e) => set('percyCSS', e.target.value)}
      />
    </>
  );
}
