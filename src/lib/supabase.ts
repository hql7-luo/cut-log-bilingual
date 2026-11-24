import { CLOUD_ENABLED, SUPABASE_KEY, SUPABASE_URL } from "./public-config.ts";
import type { Change, Row } from "./model.ts";

// Supabase Auth and PostgREST use their documented HTTPS endpoints.
export type Person = { id: string; email?: string; email_confirmed_at?: string };
export type Session = { token: string; refresh: string; expires: number; user: Person };
const SESSION_KEY = "cut-log:auth:v1";
let memory: Session | null = null;
let refreshInFlight: Promise<Session | null> | null = null;
type Json = Record<string, unknown>;

class CloudError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    const messages: Record<string, string> = {
      invalid_credentials: "邮箱或密码有误。",
      email_not_confirmed: "请先打开邮箱确认链接。",
      user_already_exists: "这个邮箱已注册，请登录或重设密码。",
      weak_password: "请换一个更长的密码。",
      signup_disabled: "此项目已关闭注册。",
      over_email_send_rate_limit: "邮件发送过于频繁，请稍后再试。",
      PGRST202: "云端数据表或函数尚未安装。请运行项目内的 Supabase SQL。",
    };
    super(messages[code] ?? (status === 429 ? "请求过于频繁，请稍后再试。" :
      status === 401 ? "账号会话已过期，请重新登录。" : "云端请求失败，请稍后重试。"));
    this.status = status;
    this.code = code;
  }
}

async function request(path: string, method: string, body?: unknown, token?: string) {
  if (!CLOUD_ENABLED) throw new Error("尚未配置 Supabase。");
  const response = await fetch(SUPABASE_URL + path, {
    method,
    headers: { apikey: SUPABASE_KEY, ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new CloudError(response.status, json.error_code ?? json.code ?? "");
  return json;
}

function validUser(value: unknown): value is Person {
  return typeof value === "object" && value !== null && "id" in value &&
    typeof value.id === "string" && /^[0-9a-f-]{36}$/i.test(value.id);
}

function sessionFrom(json: Json): Session {
  if (typeof json.access_token !== "string" || typeof json.refresh_token !== "string" || !validUser(json.user)) {
    throw new Error("账号服务没有返回可用会话。");
  }
  const expires = Number(json.expires_at) || Math.floor(Date.now() / 1000) + (Number(json.expires_in) || 3600);
  return { token: json.access_token, refresh: json.refresh_token, expires, user: json.user };
}

export function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return memory;
    const value = JSON.parse(raw) as Session;
    if (validUser(value.user) && typeof value.token === "string" &&
      typeof value.refresh === "string" && Number.isFinite(value.expires)) return value;
    return null;
  } catch { return memory; }
}

export function saveSession(value: Session | null) {
  memory = value;
  try {
    if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* This tab can still use its in-memory session. */ }
}

export function isSessionStorageKey(key: string | null) { return key === SESSION_KEY; }

export async function freshSession(current: Session): Promise<Session | null> {
  if (current.expires > Date.now() / 1000 + 45) return current;
  if (refreshInFlight) return refreshInFlight;

  const refresh = async () => {
    const saved = readSession();
    if (!saved || saved.user.id !== current.user.id) return null;
    if (saved.expires > Date.now() / 1000 + 45) return saved;
    try {
      const data = await request("/auth/v1/token?grant_type=refresh_token", "POST", { refresh_token: saved.refresh });
      const renewed = sessionFrom(data);
      if (readSession()?.user.id !== current.user.id || renewed.user.id !== current.user.id) return null;
      saveSession(renewed);
      return renewed;
    } catch (error) {
      if (!(error instanceof CloudError) || ![400, 401, 403].includes(error.status)) throw error;
      if (readSession()?.refresh === saved.refresh) saveSession(null);
      return null;
    }
  };

  const renewal = async () => navigator.locks ? await navigator.locks.request("cut-log-refresh", refresh) : await refresh();
  refreshInFlight = renewal().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

const redirect = () => encodeURIComponent(new URL("/", window.location.origin).href);

export async function authAction(action: "signin" | "signup" | "recover", email: string, password: string) {
  if (action === "recover") {
    await request(`/auth/v1/recover?redirect_to=${redirect()}`, "POST", { email });
    return null;
  }
  const path = action === "signin" ? "/auth/v1/token?grant_type=password" : `/auth/v1/signup?redirect_to=${redirect()}`;
  const data = await request(path, "POST", { email, password });
  return data.access_token ? sessionFrom(data) : null;
}

export async function authCallback(hash: string) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const token = params.get("access_token");
  const refresh = params.get("refresh_token");
  if (!token || !refresh) {
    if (params.has("error")) throw new Error("邮件链接已过期或无法验证。请重新登录或发送邮件。");
    return null;
  }
  const user = await request("/auth/v1/user", "GET", undefined, token);
  const session = sessionFrom({ access_token: token, refresh_token: refresh,
    expires_in: params.get("expires_in"), expires_at: params.get("expires_at"), user });
  return { session, recovery: params.get("type") === "recovery" };
}

export async function setPassword(token: string, password: string) {
  await request("/auth/v1/user", "PUT", { password }, token);
}

export async function endSession(current: Session) {
  await request("/auth/v1/logout?scope=local", "POST", undefined, current.token);
}

type DatabaseRow = Pick<Row, "kind" | "id" | "payload" | "revision"> & { change_id: number };
const rowFrom = ({ change_id, ...row }: DatabaseRow): Row => ({
  kind: row.kind, id: row.id, revision: Number(row.revision), cursor: Number(change_id), payload: row.payload,
});

export async function pullRows(token: string, after: number) {
  const query = new URLSearchParams({
    select: "kind,id,payload,revision,change_id", change_id: `gt.${after}`, order: "change_id.asc", limit: "300",
  });
  const rows = await request(`/rest/v1/fitness_rows?${query}`, "GET", undefined, token) as DatabaseRow[];
  return rows.map(rowFrom);
}

export type Mutation = Change & { key: string; expected: number };
export async function pushRow(token: string, change: Mutation) {
  const data = await request("/rest/v1/rpc/write_fitness_row", "POST", {
    p_kind: change.kind, p_id: change.id, p_payload: change.payload, p_expected: change.expected, p_mutation: change.key,
  }, token);
  return { applied: data.applied === true, row: data.row ? rowFrom(data.row) : null };
}
