import { makeId, rowKey, type Change, type Row } from "./model.ts";
import { sampleRows } from "./sample.ts";
import type { Mutation } from "./supabase.ts";

export type Snapshot = {
  rows: Record<string, Row>;
  pending: Mutation[];
  conflicts: Record<string, Row | null>;
  cursor: number;
  pulled: boolean;
};

export const emptySnapshot = (): Snapshot => ({ rows: {}, pending: [], conflicts: {}, cursor: 0, pulled: false });

export function initialSnapshot(scope: string, today: string) {
  const snapshot = emptySnapshot();
  if (scope === "guest") for (const row of sampleRows(today)) snapshot.rows[rowKey(row)] = row;
  return snapshot;
}

export function visibleRows(snapshot: Snapshot) {
  const combined = { ...snapshot.rows };
  for (const change of snapshot.pending) {
    const key = rowKey(change);
    combined[key] = { kind: change.kind, id: change.id, payload: change.payload, revision: change.expected + 1, cursor: 0 };
  }
  return Object.values(combined);
}

export function applyChanges(snapshot: Snapshot, changes: Change[], isCloud: boolean): Snapshot {
  const rows = { ...snapshot.rows };
  const pending = [...snapshot.pending];
  for (const change of changes) {
    const key = rowKey(change);
    if (isCloud) {
      const previous = pending.findLast((mutation) => rowKey(mutation) === key);
      pending.push({ ...change, key: makeId(), expected: previous ? previous.expected + 1 : (rows[key]?.revision ?? 0) });
    } else {
      if (change.payload === null) delete rows[key];
      else rows[key] = { ...change, revision: 0, cursor: 0 };
    }
  }
  return { ...snapshot, rows, pending };
}

export function mergeRemote(snapshot: Snapshot, rows: Row[], advance: boolean) {
  const merged = { ...snapshot.rows };
  for (const row of rows) {
    const key = rowKey(row);
    if (row.revision >= (merged[key]?.revision ?? 0)) merged[key] = row;
  }
  const cursor = advance ? Math.max(snapshot.cursor, rows.at(-1)?.cursor ?? 0) : snapshot.cursor;
  return { ...snapshot, rows: merged, cursor };
}

// IndexedDB serializes updates across tabs. The fallback supports limited browser modes.
let database: Promise<IDBDatabase> | null = null;
function openDatabase() {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open("cut-log", 1);
    request.onupgradeneeded = () => { request.result.createObjectStore("snapshots"); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("浏览器储存被占用。"));
  });
  return database;
}

const memory = new Map<string, Snapshot>();
let volatileStorage = false;
export function usesVolatileStorage() { return volatileStorage; }

const storageKey = (scope: string) => `cut-log:records:v1:${scope}`;

export async function updateSnapshot(scope: string, today: string, change: (before: Snapshot) => Snapshot) {
  try {
    const db = await openDatabase();
    const saved = await new Promise<Snapshot>((resolve, reject) => {
      const tx = db.transaction("snapshots", "readwrite");
      const table = tx.objectStore("snapshots");
      const request = table.get(scope);
      let next: Snapshot;
      request.onsuccess = () => {
        try {
          next = change(request.result ?? initialSnapshot(scope, today));
          if (next !== request.result) table.put(next, scope);
        } catch (error) { tx.abort(); reject(error); }
      };
      tx.oncomplete = () => resolve(next);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
    memory.set(scope, saved);
    return saved;
  } catch {
    try {
      const key = storageKey(scope);
      const raw = localStorage.getItem(key);
      const next = change(raw ? JSON.parse(raw) : memory.get(scope) ?? initialSnapshot(scope, today));
      localStorage.setItem(key, JSON.stringify(next));
      memory.set(scope, next);
      return next;
    } catch {
      volatileStorage = true;
      const next = change(memory.get(scope) ?? initialSnapshot(scope, today));
      memory.set(scope, next);
      return next;
    }
  }
}
