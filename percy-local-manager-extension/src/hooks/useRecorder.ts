import { useCallback, useEffect, useState } from 'react';
import type { RecordingState, RecorderMessage } from '../types/workflow';

const EMPTY: RecordingState = { active: false, steps: [] };

async function ask(msg: RecorderMessage): Promise<RecordingState> {
  const res = (await chrome.runtime.sendMessage(msg)) as RecordingState & { error?: string };
  if (res?.error) throw new Error(res.error);
  return res ?? EMPTY;
}

/**
 * Thin view over the background worker's recording state. The popup holds no
 * recording state of its own, so closing it never loses steps.
 */
export function useRecorder() {
  const [state, setState] = useState<RecordingState>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (msg: RecorderMessage) => {
    try {
      setError(null);
      setState(await ask(msg));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void run({ kind: 'rec:get' });
    // Keep the step list live while recording with the popup open.
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes.recordingState) {
        setState((changes.recordingState.newValue as RecordingState) ?? EMPTY);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [run]);

  return {
    state,
    error,
    start: async () => {
      await run({ kind: 'rec:start' });
    },
    stop: () => run({ kind: 'rec:stop' }),
    clear: () => run({ kind: 'rec:clear' }),
    addSnapshot: (name: string) => run({ kind: 'rec:snapshot', name }),
    setSteps: async (steps: RecordingState['steps']) => {
      await chrome.storage.session.set({ recordingState: { ...state, steps } });
    },
  };
}
