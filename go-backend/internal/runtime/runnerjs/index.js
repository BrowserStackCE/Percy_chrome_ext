// Workflow runner entry. Invoked by the Go backend:
//   node index.js --request <request.json>
// Emits newline-delimited JSON events on stdout.
// Exit codes: 0 passed, 1 failed, 2 partial, 3 invalid input.
import { readFile } from 'node:fs/promises';
import { emit } from './src/events.js';
import { runWorkflow } from './src/run.js';

async function main() {
  const i = process.argv.indexOf('--request');
  if (i === -1 || !process.argv[i + 1]) {
    emit({ type: 'error', message: 'missing --request <file>' });
    return 3;
  }
  let request;
  try {
    request = JSON.parse(await readFile(process.argv[i + 1], 'utf8'));
  } catch (e) {
    emit({ type: 'error', message: `invalid request file: ${e.message}` });
    return 3;
  }
  return runWorkflow(request);
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    emit({ type: 'error', message: `runner crashed: ${e.message}` });
    process.exit(1);
  });
