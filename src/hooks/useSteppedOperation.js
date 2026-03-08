import { useState, useCallback, useRef } from 'react';

/**
 * Generic hook for multi-step async operations with live progress tracking.
 *
 * Step definitions: { label, run?, onDone?, onFail?, fallback? }
 *   - label: initial display text
 *   - run: async () => result (optional — omit for callback-driven steps)
 *   - onDone(result): returns new label on success
 *   - onFail(err): returns new label on failure
 *   - fallback: value if step throws (default: null)
 *
 * Two usage modes:
 *
 * 1. Automatic — call run(), hook executes each step's run() sequentially:
 *      const { steps, running, run } = useSteppedOperation(defs);
 *      const results = await run();
 *
 * 2. Imperative — for callback-driven operations (e.g. hardware progress):
 *      const { steps, start, markStep, finish } = useSteppedOperation(defs);
 *      start();                    // init all steps, mark first active
 *      markStep(1, 'done');        // advance step 0→done, step 1→active
 *      markStep(2, 'done');        // etc.
 *      finish();                   // mark all remaining done, set running=false
 */
export default function useSteppedOperation(stepDefs) {
  const [steps, setSteps] = useState([]);
  const [running, setRunning] = useState(false);
  const defsRef = useRef(stepDefs);
  defsRef.current = stepDefs;
  const stateRef = useRef([]);

  // --- Automatic mode ---
  const run = useCallback(async () => {
    const defs = defsRef.current;
    const state = defs.map((d, i) => ({
      label: d.label,
      status: i === 0 ? 'active' : 'pending',
    }));
    stateRef.current = state;
    setSteps([...state]);
    setRunning(true);

    const results = [];

    for (let i = 0; i < defs.length; i++) {
      const def = defs[i];
      state[i] = { ...state[i], status: 'active' };
      setSteps([...state]);

      try {
        const result = await def.run();
        results.push(result);
        // onDone can return string (label) or { label, failed } for soft failures
        const doneResult = def.onDone ? def.onDone(result) : null;
        if (doneResult && typeof doneResult === 'object') {
          state[i] = { label: doneResult.label, status: doneResult.failed ? 'failed' : 'done' };
        } else {
          state[i] = { label: doneResult || state[i].label, status: 'done' };
        }
      } catch (err) {
        results.push(def.fallback !== undefined ? def.fallback : null);
        state[i] = {
          label: def.onFail ? def.onFail(err) : `${state[i].label.replace('...', '')} — failed`,
          status: 'failed',
        };
      }

      if (i + 1 < defs.length) {
        state[i + 1] = { ...state[i + 1], status: 'active' };
      }
      setSteps([...state]);
    }

    setRunning(false);
    return results;
  }, []);

  // --- Imperative mode ---
  const start = useCallback(() => {
    const defs = defsRef.current;
    const state = defs.map((d, i) => ({
      label: d.label,
      status: i === 0 ? 'active' : 'pending',
    }));
    stateRef.current = state;
    setSteps([...state]);
    setRunning(true);
  }, []);

  const markStep = useCallback((activeIndex, prevStatus = 'done') => {
    const state = stateRef.current;
    for (let i = 0; i < state.length; i++) {
      if (i < activeIndex) {
        if (state[i].status === 'active') state[i] = { ...state[i], status: prevStatus };
      } else if (i === activeIndex) {
        state[i] = { ...state[i], status: 'active' };
      }
    }
    stateRef.current = state;
    setSteps([...state]);
  }, []);

  const failCurrent = useCallback(() => {
    const state = stateRef.current;
    const idx = state.findIndex(s => s.status === 'active');
    if (idx >= 0) state[idx] = { ...state[idx], status: 'failed' };
    stateRef.current = state;
    setSteps([...state]);
  }, []);

  const finish = useCallback(() => {
    const state = stateRef.current;
    for (let i = 0; i < state.length; i++) {
      if (state[i].status === 'active' || state[i].status === 'pending') {
        state[i] = { ...state[i], status: 'done' };
      }
    }
    stateRef.current = state;
    setSteps([...state]);
    setRunning(false);
  }, []);

  const reset = useCallback(() => {
    stateRef.current = [];
    setSteps([]);
    setRunning(false);
  }, []);

  return { steps, running, run, start, markStep, failCurrent, finish, reset };
}
