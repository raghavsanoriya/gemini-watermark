'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { RepairQuality } from '@/types/media';

const KEY = 'gemclean:repair-quality';
const listeners = new Set<() => void>();
// Holds the choice when storage is blocked (private windows, previews), so the switch still works.
let memory: RepairQuality = 'standard';

function read(): RepairQuality {
  try {
    const stored = globalThis.localStorage?.getItem(KEY);
    if (stored === 'best' || stored === 'standard') return stored;
  } catch {
    // Fall through to the in-memory choice.
  }
  return memory;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The viewer's "Best quality" choice, remembered in this browser only. Defaults to standard. */
export function useRepairQuality(): [RepairQuality, (quality: RepairQuality) => void] {
  const quality = useSyncExternalStore(subscribe, read, () => 'standard' as RepairQuality);
  const setQuality = useCallback((next: RepairQuality) => {
    memory = next;
    try {
      globalThis.localStorage?.setItem(KEY, next);
    } catch {
      // Not remembered across visits, but applied on this page.
    }
    listeners.forEach((listener) => listener());
  }, []);
  return [quality, setQuality];
}
