import { useId } from 'react';
import { useBranchSettings } from '../hooks/useBranchSettings';
import { DEFAULT_BRANCH } from '../utils/branchStorage';

interface BranchSettingsFieldsProps {
  /** Disable editing while a build is starting or running. */
  disabled?: boolean;
}

/**
 * Branch / target branch used for the next build. Shown wherever a build is
 * triggered (Finalize Build and workflow Replay). Values are saved once and
 * reused; an empty Branch falls back to the default.
 */
export function BranchSettingsFields({ disabled }: BranchSettingsFieldsProps) {
  const { settings, isDefault, update, reset } = useBranchSettings();
  const uid = useId();
  const branchId = `${uid}-branch`;
  const targetId = `${uid}-target`;

  return (
    <div className="branch-settings" aria-label="Percy branch settings">
      <div className="branch-settings__header">
        <span className="branch-settings__title">Build branches</span>
        <span
          className={`branch-settings__badge${
            isDefault ? '' : ' branch-settings__badge--changed'
          }`}
        >
          {isDefault ? 'Default' : 'Changed'}
        </span>
        {!isDefault && (
          <button
            type="button"
            className="button button--link"
            onClick={reset}
            disabled={disabled}
          >
            Reset to default
          </button>
        )}
      </div>

      <div className="branch-settings__field">
        <label htmlFor={branchId}>Branch</label>
        <input
          id={branchId}
          className="input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={DEFAULT_BRANCH}
          value={settings.branch}
          disabled={disabled}
          onChange={(e) => update({ ...settings, branch: e.target.value })}
        />
        <span className="snapshot-edit-help">
          Name of the branch this build is created on. Default:{' '}
          <code>{DEFAULT_BRANCH}</code>. Use e.g. <code>production</code> to
          create a baseline.
        </span>
      </div>

      <div className="branch-settings__field">
        <label htmlFor={targetId}>Target branch</label>
        <input
          id={targetId}
          className="input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="None (Percy's default)"
          value={settings.targetBranch}
          disabled={disabled}
          onChange={(e) =>
            update({ ...settings, targetBranch: e.target.value })
          }
        />
        <span className="snapshot-edit-help">
          Branch whose latest build is used as the baseline for comparison.
          Leave empty to use Percy's normal base-build selection. Example:
          build <code>production</code> first, then build <code>staging</code>{' '}
          with target <code>production</code> to compare two URLs.
        </span>
      </div>
    </div>
  );
}
