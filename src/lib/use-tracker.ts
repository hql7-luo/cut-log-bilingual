"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { todayLA } from "./dates.ts";
import { rowKey, type Change } from "./model.ts";
import { applyChanges, emptySnapshot, mergeRemote, updateSnapshot, usesVolatileStorage, visibleRows } from "./persistence.ts";
import { CLOUD_ENABLED } from "./public-config.ts";
import { authAction, authCallback, endSession, freshSession, isSessionStorageKey, pullRows, pushRow,
  readSession, saveSession, setPassword, type Session } from "./supabase.ts";

export function useToday() {
  const [today, setToday] = useState(todayLA);
  useEffect(() => {
    const update = () => setToday(todayLA());
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => { clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  return today;
}

export function useCloudAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [message, setMessage] = useState("");
  const live = useRef<Session | null>(null);

  const establish = useCallback((next: Session | null) => {
    live.current = next;
    setSession(next);
  }, []);

  useEffect(() => {
    let active = true;
    const setup = async () => {
      if (CLOUD_ENABLED) {
        establish(readSession());
        const hash = window.location.hash;
        if (/^#(?:access_token|error)=/.test(hash)) {
          window.history.replaceState(null, "", window.location.pathname + "#settings");
          try {
            const result = await authCallback(hash);
            if (result && active) {
              saveSession(result.session);
              establish(result.session);
              setRecovery(result.recovery);
              setMessage(result.recovery ? "请输入新的密码。" : "邮箱验证成功，已登录。");
            }
          } catch (error) { if (active) setMessage((error as Error).message); }
        }
      }
      if (active) setReady(true);
    };
    void setup();
    const changed = (event: StorageEvent) => {
      if (!isSessionStorageKey(event.key)) return;
      if (!event.newValue) saveSession(null);
      establish(readSession());
    };
    window.addEventListener("storage", changed);
    return () => { active = false; window.removeEventListener("storage", changed); };
  }, [establish]);

  const token = useCallback(async () => {
    const current = live.current;
    if (!current) throw new Error("请先登录账号。");
    const fresh = await freshSession(current);
    if (live.current?.user.id !== current.user.id) throw new Error("账号已切换。");
    if (!fresh) {
      setMessage("会话已过期。重新登录同一账号后将继续同步。");
      establish(null);
      throw new Error("会话已过期。");
    }
    if (fresh !== current) establish(fresh);
    return fresh.token;
  }, [establish]);

  async function submit(action: "signin" | "signup" | "recover", email: string, password: string) {
    const next = await authAction(action, email.trim(), password);
    if (next) { saveSession(next); establish(next); setMessage("已登录。"); }
    else setMessage(action === "recover" ? "如邮箱可用，请查看重设密码邮件。" : "请在邮箱中确认账号，再回来登录。");
  }

  async function signOut() {
    const current = live.current;
    saveSession(null);
    establish(null);
    setRecovery(false);
    setMessage("已退出账号。");
    if (current) await endSession(current).catch(() => {});
  }

  async function updatePassword(password: string) {
    await setPassword(await token(), password);
    setRecovery(false);
    setMessage("密码已更新。");
  }

  return { session, ready, recovery, message, submit, signOut, updatePassword, token };
}

export function useTracker(today: string, auth: ReturnType<typeof useCloudAuth>) {
  const scope = auth.session?.user.id ?? "guest";
  const isCloud = scope !== "guest";
  const [state, setState] = useState(() => ({ scope: "", data: emptySnapshot() }));
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState("");
  const scopeRef = useRef(scope);
  const channel = useRef<BroadcastChannel | null>(null);
  const syncing = useRef(new Set<string>());
  const todayRef = useRef(today);
  todayRef.current = today;
  scopeRef.current = scope;
  const ready = auth.ready && state.scope === scope;

  const commit = useCallback(async (fn: Parameters<typeof updateSnapshot>[2], broadcast = true) => {
    const next = await updateSnapshot(scope, todayRef.current, fn);
    if (scopeRef.current === scope) setState({ scope, data: next });
    if (broadcast) channel.current?.postMessage(scope);
    return next;
  }, [scope]);

  useEffect(() => {
    if (!auth.ready) return;
    let active = true;
    setProblem("");
    setRunning(false);
    const load = () => void commit((before) => before, false).catch(() => {
      if (active && scopeRef.current === scope) setProblem("浏览器储存无法使用。请检查隐私模式或可用空间。");
    });
    load();
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("cut-log:records");
      channel.current.onmessage = (event) => { if (event.data === scope) load(); };
    }
    return () => { active = false; channel.current?.close(); channel.current = null; };
  }, [auth.ready, scope, commit]);

  const getToken = auth.token;
  const sync = useCallback(async () => {
    if (!isCloud || !ready || syncing.current.has(scope)) return;
    if (navigator.onLine === false) { setProblem("离线中，记录已保存在此设备。"); return; }
    syncing.current.add(scope);
    setRunning(true);
    try {
      const token = await getToken();
      let snapshot = await commit((before) => before, false);
      let page = await pullRows(token, snapshot.cursor);
      while (page.length > 0 && scopeRef.current === scope) {
        snapshot = await commit((before) => mergeRemote(before, page, true));
        if (page.length < 300) break;
        page = await pullRows(token, snapshot.cursor);
      }
      if (scopeRef.current !== scope) return;
      snapshot = await commit((before) => before.pulled ? before : { ...before, pulled: true }, false);
      for (const mutation of snapshot.pending) {
        if (scopeRef.current !== scope) return;
        const key = rowKey(mutation);
        if (Object.hasOwn(snapshot.conflicts, key)) continue;
        const response = await pushRow(token, mutation);
        snapshot = await commit((before) => {
          const merged = response.row ? mergeRemote(before, [response.row], false) : before;
          if (!before.pending.some((item) => item.key === mutation.key)) return merged;
          if (response.applied) return { ...merged, pending: merged.pending.filter((item) => item.key !== mutation.key) };
          return { ...merged, conflicts: { ...merged.conflicts, [key]: merged.rows[key] ?? response.row } };
        });
      }
      if (scopeRef.current === scope) setProblem("");
    } catch (error) {
      if (scopeRef.current === scope) setProblem(error instanceof Error && error.name === "Error"
        ? error.message : "云端连接暂停。记录已保存在此设备，联网后重试。");
    } finally {
      syncing.current.delete(scope);
      if (scopeRef.current === scope) setRunning(false);
    }
  }, [isCloud, ready, scope, commit, getToken]);

  useEffect(() => {
    if (!isCloud || !ready) return;
    const update = () => { if (document.visibilityState === "visible") void sync(); };
    void sync();
    const timer = window.setInterval(update, 15_000);
    window.addEventListener("focus", update);
    window.addEventListener("online", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
      window.removeEventListener("online", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [isCloud, ready, sync]);

  const snapshot = ready ? state.data : emptySnapshot();
  const rows = useMemo(() => visibleRows(snapshot), [snapshot]);

  async function save(changes: Change[]) {
    if (!ready) throw new Error("正在载入记录，请再试一次。");
    await commit((before) => applyChanges(before, changes, isCloud));
    if (isCloud) void sync();
  }

  async function discardExamples() {
    const next = await commit((before) => ({
      ...before, rows: Object.fromEntries(Object.entries(before.rows).filter(([, row]) => !row.sample)),
    }));
    return next;
  }

  async function importGuest() {
    if (!isCloud || !snapshot.pulled) throw new Error("请先同步已有的云端记录。");
    const guest = await updateSnapshot("guest", todayRef.current, (before) => before);
    const candidates = visibleRows(guest).filter((row) => !row.sample && row.payload !== null);
    let count = 0;
    await commit((before) => {
      const keys = new Set(visibleRows(before).map(rowKey));
      const fresh = candidates.filter((row) => !keys.has(rowKey(row)));
      count = fresh.length;
      return applyChanges(before, fresh.map(({ kind, id, payload }) => ({ kind, id, payload })), true);
    });
    void sync();
    return count;
  }

  async function resolveConflict(key: string, keepLocal: boolean) {
    await commit((before) => {
      if (!Object.hasOwn(before.conflicts, key)) return before;
      const local = before.pending.findLast((mutation) => rowKey(mutation) === key);
      const conflicts = { ...before.conflicts };
      delete conflicts[key];
      const clean = { ...before, pending: before.pending.filter((mutation) => rowKey(mutation) !== key), conflicts };
      return keepLocal && local ? applyChanges(clean, [local], true) : clean;
    });
    void sync();
  }

  return { ready, isCloud, rows, snapshot, running, problem, volatile: usesVolatileStorage(),
    sync, save, discardExamples, importGuest, resolveConflict };
}
