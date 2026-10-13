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

async function serializeRaw(page) {
  return page.evaluate(() => {
    const clone = document.documentElement.cloneNode(true);
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
