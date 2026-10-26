// One JSON object per line on stdout. Never include secret values.
export function emit(event) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
}
