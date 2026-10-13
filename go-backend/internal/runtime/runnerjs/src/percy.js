// Posts a DOM snapshot to the Percy CLI local server started by the Go backend
// (percy exec:start). Same payload shape as go-backend/internal/percy/client.go.
export async function postSnapshot(percyUrl, { name, url, dom, widths, minHeight }) {
  const body = { name, url, domSnapshot: dom };
  if (widths) body.widths = widths;
  if (minHeight) body.minHeight = minHeight;
  const res = await fetch(`${percyUrl}/percy/snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`percy returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}
