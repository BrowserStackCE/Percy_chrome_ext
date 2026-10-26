import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SAFE = /^[A-Za-z0-9_-]+$/;

const MIN_SECRET_LEN = 4; // shorter values would corrupt ordinary markup if replaced
const REDACTED = '[REDACTED]';

// Removes every resolved secret value from serialized HTML, wherever the page
// echoed it (attributes, text, scripts). Longest first so a secret that
// contains another is replaced whole.
export function redactSecrets(html, secrets) {
  const values = Object.values(secrets ?? {})
    .filter((v) => typeof v === 'string' && v.length >= MIN_SECRET_LEN)
    .sort((a, b) => b.length - a.length);
  let out = html;
  for (const v of values) out = out.split(v).join(REDACTED);
  return out;
}

// Serializes the live main document (iframes / shadow DOM are not captured).
// Password-like input values are stripped, then every secret the runner typed
// is scrubbed by value, before anything is written to disk or sent to Percy.
export async function serializeDom(page, secrets) {
  const html = await serializeRaw(page);
  return redactSecrets(html, secrets);
}

// Describes the live form controls (never their values) for the run log, so a
// "form is empty" report can be told apart from "never filled".
export async function describeFormState(page) {
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll('input, textarea, select').forEach((el) => {
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || (tag === 'input' ? 'text' : tag)).toLowerCase();
      const id = el.id || el.getAttribute('name') || '(no id)';
      if (type === 'checkbox' || type === 'radio') out.push(`${id}[${type}] checked=${el.checked}`);
      else if (tag === 'select') out.push(`${id}[select] selectedIndex=${el.selectedIndex}`);
      else out.push(`${id}[${type}] filled=${el.value !== ''} length=${el.value.length}`);
    });
    return out;
  });
}

async function serializeRaw(page) {
  return page.evaluate(() => {
    const clone = document.documentElement.cloneNode(true);

    // Playwright fill/check/select change live properties, which outerHTML does
    // not serialize. Mirror the live state onto the clone (matched by index)
    // so the snapshot shows what the workflow entered.
    const liveInputs = document.documentElement.querySelectorAll('input');
    clone.querySelectorAll('input').forEach((el, i) => {
      const live = liveInputs[i];
      if (!live) return;
      const t = (live.getAttribute('type') || 'text').toLowerCase();
      if (t === 'checkbox' || t === 'radio') {
        if (live.checked) el.setAttribute('checked', '');
        else el.removeAttribute('checked');
      } else if (!['button', 'submit', 'reset', 'file', 'image', 'hidden'].includes(t)) {
        el.setAttribute('value', live.value);
      }
    });
    const liveAreas = document.documentElement.querySelectorAll('textarea');
    clone.querySelectorAll('textarea').forEach((el, i) => {
      if (liveAreas[i]) el.textContent = liveAreas[i].value;
    });
    const liveOptions = document.documentElement.querySelectorAll('option');
    clone.querySelectorAll('option').forEach((el, i) => {
      if (!liveOptions[i]) return;
      if (liveOptions[i].selected) el.setAttribute('selected', '');
      else el.removeAttribute('selected');
    });

    // Sensitive values are stripped AFTER the mirror so they stay blank.
    clone
      .querySelectorAll('input[type="password"], input[autocomplete*="password"], input[autocomplete*="cc-"]')
      .forEach((el) => {
        el.removeAttribute('value');
      });
    return '<!DOCTYPE html>' + clone.outerHTML;
  });
}

// Best-effort DOM dump for a failed step (kept for debugging). Same redaction
// as checkpoint DOM; the step id is validated before it becomes a file name.
export async function saveFailureDom(page, artifactDir, stepId, secrets) {
  if (!SAFE.test(stepId)) return;
  const dir = path.join(artifactDir, 'dom');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `failure_${stepId}.html`), await serializeDom(page, secrets));
}

// Writes dom/<checkpoint>.html and metadata/<checkpoint>.json inside artifactDir.
export async function saveCheckpoint(page, { artifactDir, checkpointId, buildId, workflowVersion, viewport }, dom) {
  if (!SAFE.test(checkpointId)) throw new Error(`unsafe checkpointId: ${checkpointId}`);
  const domDir = path.join(artifactDir, 'dom');
  const metaDir = path.join(artifactDir, 'metadata');
  await mkdir(domDir, { recursive: true });
  await mkdir(metaDir, { recursive: true });
  const domPath = path.join(domDir, `${checkpointId}.html`);
  const metadataPath = path.join(metaDir, `${checkpointId}.json`);
  await writeFile(domPath, dom);
  await writeFile(
    metadataPath,
    JSON.stringify(
      {
        checkpointId,
        buildId,
        workflowVersion,
        url: page.url(),
        title: await page.title(),
        viewport,
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  return { domPath, metadataPath };
}
