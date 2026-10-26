import { chromium } from 'playwright';
import { emit } from './events.js';
import { serializeDom, saveCheckpoint, saveFailureDom, describeFormState } from './capture.js';
import { postSnapshot } from './percy.js';
import { executors, navigate, stepLabel } from './steps.js';

// Exit codes (read by the Go backend): 0 passed, 1 failed, 2 partial, 3 invalid input.
export const EXIT = { PASSED: 0, FAILED: 1, PARTIAL: 2, INVALID: 3 };

function validate(req) {
  const wf = req?.workflow;
  if (!req?.buildId || !req?.artifactDir) return 'request needs buildId and artifactDir';
  if (!wf || !Array.isArray(wf.steps) || wf.steps.length === 0) return 'workflow has no steps';
  try {
    const u = new URL(wf.startUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'startUrl must be http(s)';
  } catch {
    return 'startUrl is invalid';
  }
  for (const s of wf.steps) {
    if (s.type !== 'snapshot' && !executors[s.type]) return `unsupported step type: ${s.type}`;
  }
  return null;
}

async function doSnapshot(page, step, req, state) {
  const { buildId, artifactDir, percyUrl, workflow } = req;
  // Intentional wait so late content settles before the DOM is captured.
  if (step.waitMs > 0) await page.waitForTimeout(step.waitMs);
  const dom = await serializeDom(page, req.secrets);
  // Value-free summary of the form at capture time, for the run log.
  const form = await describeFormState(page).catch(() => []);
  emit({
    type: 'log',
    message: `snapshot "${step.name}" at ${page.url()}: ${form.length} form control(s)${form.length ? ' - ' + form.join('; ') : ''}`,
  });
  const paths = await saveCheckpoint(
    page,
    {
      artifactDir,
      checkpointId: step.checkpointId,
      buildId,
      workflowVersion: workflow.version,
      viewport: workflow.settings?.viewport,
    },
    dom,
  );
  emit({ type: 'checkpointCaptured', checkpointId: step.checkpointId, ...paths });

  if (!percyUrl) return;
  // DOM capture and Percy upload are separate: a failed upload keeps the DOM
  // artifact and downgrades the build to "partial".
  try {
    await postSnapshot(percyUrl, {
      name: step.name,
      url: page.url(),
      dom,
      widths: step.options?.widths?.length
        ? step.options.widths
        : workflow.settings?.viewport
          ? [workflow.settings.viewport.width]
          : undefined,
      minHeight: step.options?.minHeight || workflow.settings?.viewport?.height,
      scope: step.options?.scope,
      enableJavaScript: step.options?.enableJavaScript,
      percyCSS: step.options?.percyCSS,
    });
    emit({ type: 'checkpointUploaded', checkpointId: step.checkpointId });
  } catch (e) {
    state.uploadFailed++;
    emit({ type: 'checkpointUploadFailed', checkpointId: step.checkpointId, message: e.message });
  }
}

export async function runWorkflow(req) {
  const problem = validate(req);
  if (problem) {
    emit({ type: 'error', message: problem });
    return EXIT.INVALID;
  }
  const { workflow, secrets } = req;
  const settings = workflow.settings ?? {};
  const viewport = settings.viewport ?? { width: 1280, height: 800 };
  const state = { uploadFailed: 0 };

  const browser = await chromium.launch();
  let failed = false;
  try {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.setDefaultTimeout(settings.defaultTimeoutMs || 10000);

    try {
      await navigate(page, workflow.startUrl, settings.defaultTimeoutMs);
    } catch (e) {
      emit({ type: 'error', message: `could not open startUrl: ${e.message}` });
      return EXIT.FAILED;
    }

    const ctx = { settings, secrets };
    for (const step of workflow.steps) {
      emit({ type: 'stepStarted', stepId: step.id });
      emit({ type: 'log', message: `step ${step.id}: ${stepLabel(step)}` });
      const t0 = Date.now();
      try {
        if (step.type === 'snapshot') {
          await doSnapshot(page, step, req, state);
        } else {
          await executors[step.type](page, step, ctx);
        }
        emit({ type: 'stepFinished', stepId: step.id, status: 'passed', durationMs: Date.now() - t0 });
      } catch (e) {
        failed = true;
        // keep debugging evidence for failed runs
        await saveFailureDom(page, req.artifactDir, step.id, secrets).catch(() => {});
        emit({
          type: 'stepFinished',
          stepId: step.id,
          status: 'failed',
          durationMs: Date.now() - t0,
          message: String(e.message || e).split('\n')[0].slice(0, 500),
        });
        break; // stop on critical failure
      }
    }
  } finally {
    await browser.close();
  }
  if (failed) return EXIT.FAILED;
  return state.uploadFailed ? EXIT.PARTIAL : EXIT.PASSED;
}
