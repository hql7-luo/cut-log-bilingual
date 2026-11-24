"use client";

import { useLanguage } from "./language";
import { useState } from "react";
import { ACTIVITIES, ACTIVITY_LABELS, ACTIVITY_LEVELS, dailyTarget, energyEstimate, MEAL_LABELS, type FoodLog, type Profile, type Row } from "../lib/model";
import { foodTotals, number, portionText, whole } from "../lib/nutrition";
import { CLOUD_ENABLED } from "../lib/public-config";
import type { useCloudAuth, useTracker } from "../lib/use-tracker";
import { Button, CardHead, ErrorText, Field, Icon } from "./ui";
import type { Providers } from "./food-modal";

export type Theme = "dark" | "light";

function AccountForm({ auth }: { auth: ReturnType<typeof useCloudAuth> }) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<"signin" | "signup" | "recover">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (auth.recovery) await auth.updatePassword(password);
      else await auth.submit(mode, email, password);
      setPassword("");
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  if (auth.session && !auth.recovery) return null;
  return <form className="form-stack" onSubmit={submit}>
    {!auth.recovery && <>
      <div className="segments compact" role="group" aria-label={t("账号操作")}>
        <button type="button" aria-pressed={mode === "signin"} onClick={() => { setMode("signin"); setError(""); }}>{t("登录")}</button>
        <button type="button" aria-pressed={mode === "signup"} onClick={() => { setMode("signup"); setError(""); }}>{t("注册")}</button>
        <button type="button" aria-pressed={mode === "recover"} onClick={() => { setMode("recover"); setError(""); }}>{t("重设密码")}</button>
      </div>
      <Field label={t("邮箱")}><input type="email" autoComplete="email" maxLength={255} required value={email}
        onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"/></Field>
    </>}
    {(mode !== "recover" || auth.recovery) && <Field label={auth.recovery ? t("新密码") : t("密码")}>
      <input type="password" required minLength={mode === "signin" && !auth.recovery ? 1 : 8} maxLength={128}
        autoComplete={mode === "signin" && !auth.recovery ? "current-password" : "new-password"}
        value={password} onChange={(e) => setPassword(e.target.value)}/></Field>}
    <ErrorText>{error}</ErrorText>
    <Button type="submit" variant="primary" disabled={busy}>{busy ? t("处理中…") :
      auth.recovery ? t("保存新密码") : { signin: t("登录并同步"), signup: t("创建账号"), recover: t("发送重设邮件") }[mode]}</Button>
  </form>;
}

function ProfileForm({ profile, latest, save }: { profile: Profile; latest?: number; save: (profile: Profile) => Promise<void> }) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(profile);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const update = (change: Partial<Profile>) => setDraft((before) => ({ ...before, ...change }));
  const energy = energyEstimate({ ...draft, weight: latest ?? draft.weight });
  const weeklyGoal = draft.paceMin > 0 && draft.paceMin <= draft.paceMax ? (draft.paceMin + draft.paceMax) / 2 : null;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (draft.paceMin > draft.paceMax) { setError("每周目标的下限应小于或等于上限。"); return; }
    if (Object.values(draft.calories).some((kcal) => kcal < draft.protein * 4 + draft.fat * 9)) {
      setError("各活动日的热量需要覆盖你设定的蛋白质和脂肪。"); return;
    }
    setBusy(true);
    try { await save(draft); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <form className="dashboard-column" onSubmit={submit}>
    <section className="card padded form-stack">
      <CardHead title={t("个人资料")} icon="settings"/>
      <div className="form-grid">
        <Field label={t("年龄（岁）")}><input type="number" inputMode="numeric" min="18" max="120" value={draft.age ?? ""}
          placeholder={t("待填写")} onChange={(e) => update({ age: e.target.value ? Number(e.target.value) : null })}/></Field>
        <Field label={t("性别")}><select value={draft.sex} onChange={(e) => update({ sex: e.target.value as Profile["sex"] })}>
          <option value="male">{t("男")}</option><option value="female">{t("女")}</option>
        </select></Field>
        <Field label={t("身高（cm）")}><input type="number" inputMode="decimal" step="any" min="100" max="250" required value={draft.height || ""}
          onChange={(e) => update({ height: Number(e.target.value) })}/></Field>
        <Field label={t("体重（kg）")}><input type="number" inputMode="decimal" step="any" min="25" max="500" required value={draft.weight || ""}
          onChange={(e) => update({ weight: Number(e.target.value) })}/></Field>
        <Field label={t("目标体重（kg）")}><input type="number" inputMode="decimal" step="any" min="25" max="500" required value={draft.goalWeight || ""}
          onChange={(e) => update({ goalWeight: Number(e.target.value) })}/></Field>
        <Field label={t("目标日期")}><input type="date" required value={draft.goalDay} onChange={(e) => update({ goalDay: e.target.value })}/></Field>
      </div>
      <Field label={t("日常活动水平")}><select value={draft.level} onChange={(e) => update({ level: e.target.value as Profile["level"] })}>
        {Object.entries(ACTIVITY_LEVELS).map(([value, level]) => <option key={value} value={value}>{t(level.label)}</option>)}
      </select></Field>
      <div className="source-box">
        {energy ? <>
          <p>{t("基础代谢")} <strong>{whole.format(energy.bmr)}</strong> {t("kcal/日 · 日均消耗参考")} <strong>{whole.format(energy.tdee)}</strong> {t("kcal/日")}</p>
          <p>{t("Mifflin–St Jeor 初始估算")}{latest !== undefined ? t` · 使用最新实测 ${number.format(latest)} kg` : ""}{t("。长期调整参考体重趋势。")}</p>
        </> : <p>{t("填入年龄后，显示 Mifflin–St Jeor 的 BMR 和 TDEE 初始估算。")}</p>}
        <p>{t("日均参考随所选活动水平变化。每日消耗按低活动日加训练估算。当天可手选活动预估，历史日期使用实记训练时长。")}</p>
      </div>
    </section>
    <section className="card padded form-stack">
      <CardHead title={t("营养与减脂目标")} icon="bolt"/>
      <div className="goal-fields" role="group" aria-labelledby="intake-goal-heading">
        <h3 id="intake-goal-heading">{t("每日摄入预算")}</h3>
        <p className="fine">{t("按当天活动选用摄入预算。碳水由总热量扣除蛋白质和脂肪的热量后计算。")}</p>
        <div className="form-grid">
          {ACTIVITIES.map((choice) => <Field key={choice} label={t`${t(ACTIVITY_LABELS[choice])}日（kcal）`}>
            <input type="number" inputMode="numeric" min="1000" max="8000" required value={draft.calories[choice] || ""}
              onChange={(e) => update({ calories: { ...draft.calories, [choice]: Number(e.target.value) } })}/>
            <small>{t("对应碳水")} {number.format(dailyTarget(draft, choice).carbs)} g</small>
          </Field>)}
          <Field label={t("蛋白质目标（g/天）")}><input type="number" inputMode="decimal" min="0" max="500" step="any" required value={draft.protein}
            onChange={(e) => update({ protein: Number(e.target.value) })}/></Field>
          <Field label={t("脂肪目标（g/天）")}><input type="number" inputMode="decimal" min="0" max="500" step="any" required value={draft.fat}
            onChange={(e) => update({ fat: Number(e.target.value) })}/></Field>
        </div>
      </div>
      <div className="goal-fields" role="group" aria-labelledby="weekly-goal-heading">
        <h3 id="weekly-goal-heading">{t("每周体重趋势目标")}</h3>
        {weeklyGoal !== null && <p className="fine">{t`参考速度约 ${Number(weeklyGoal.toFixed(2))} kg/周（${Number((weeklyGoal * 2).toFixed(2))} 斤/周）`}</p>}
        <div className="form-grid">
          <Field label={t("每周减重下限（kg）")}><input type="number" inputMode="decimal" min="0.05" max="3" step=".01" required
            value={draft.paceMin || ""} onChange={(e) => update({ paceMin: Number(e.target.value) })}/></Field>
          <Field label={t("每周减重上限（kg）")}><input type="number" inputMode="decimal" min="0.05" max="3" step=".01" required
            value={draft.paceMax || ""} onChange={(e) => update({ paceMax: Number(e.target.value) })}/></Field>
        </div>
        <p className="fine">{t("进度页比较连续两周的平均体重。体重也会随水分变化。")}</p>
      </div>
      <ErrorText>{error}</ErrorText>
      <Button variant="primary" type="submit" icon="check" disabled={busy}>{busy ? t("正在保存…") : t("保存设置")}</Button>
    </section>
  </form>;
}

export function SettingsPage({ profile, latest, theme, setTheme, auth, store, providers, save, exportData, clearSamples, hasSamples,
  message }: {
  profile: Profile; latest?: number; theme: Theme; setTheme: (theme: Theme) => void; auth: ReturnType<typeof useCloudAuth>;
  store: ReturnType<typeof useTracker>; providers: Providers; save: (profile: Profile) => Promise<void>;
  exportData: () => void; clearSamples: () => Promise<void>; hasSamples: boolean; message: (text: string) => void;
}) {
  const { language, t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  async function act(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setFailure("");
    try { await action(); } catch (error) { setFailure((error as Error).message); }
    finally { setBusy(false); }
  }
  const describe = (row: Row | null | undefined) => {
    if (!row || !row.payload) return "已移除";
    if (row.kind === "food") {
      const food = row.payload as FoodLog;
      const total = foodTotals(food)?.total;
      return [t(food.name), portionText(food, language), food.day, t(MEAL_LABELS[food.meal]),
        total && `${whole.format(total.kcal)} kcal`,
        total && `${t("蛋白质")} ${number.format(total.protein)} g / ${t("碳水")} ${number.format(total.carbs)} g / ${t("脂肪")} ${number.format(total.fat)} g`]
        .filter(Boolean).join(" · ");
    }
    const data = row.payload as { name?: string; day?: string; kg?: number };
    return data.name ?? (data.kg ? `${data.day} · ${data.kg} kg` : data.day ?? "个人设置或模板");
  };
  return <div className="subpage-grid">
    <ProfileForm key={JSON.stringify(profile)} profile={profile} latest={latest} save={save}/>
    <div className="dashboard-column">
      <section className="card padded form-stack">
        <CardHead title={t("账号与同步")} icon="cloud"/>
        {CLOUD_ENABLED ? <>
          {auth.session && !auth.recovery && <>
            <p className="user-email">{auth.session.user.email}</p>
            <p className="fine">{store.running ? t("正在同步…") : store.snapshot.pending.length ? t`${store.snapshot.pending.length} 条待同步` :
              store.snapshot.pulled ? t("已同步") : t("等待首次同步")}</p>
            <div className="inline-actions wrap">
              <Button onClick={() => store.sync()} disabled={store.running}>{t("立即同步")}</Button>
              <Button variant="quiet" onClick={() => act(auth.signOut)} disabled={busy}>{t("退出登录")}</Button>
            </div>
            <Button variant="quiet" disabled={busy || !store.snapshot.pulled} onClick={() => act(async () => {
              const count = await store.importGuest();
              message(count ? t`已导入 ${count} 条本机记录。` : "没有新的本机记录可导入。");
            })}>{t("导入此设备上的记录")}</Button>
          </>}
          {auth.message && <p className="notice" role="status">{t(auth.message)}</p>}
          <AccountForm auth={auth}/>
        </> : <p className="muted">{t("当前记录保存在此设备。配置 Supabase 后可登录，在手机和电脑之间同步。")}</p>}
        <ErrorText>{store.problem || failure}</ErrorText>
        {Object.entries(store.snapshot.conflicts).map(([key, remote]) =>
          <div className="source-box" key={key}>
            <p>{t("两个设备修改了同一条记录")}</p>
            <p><strong>{t("此设备")}</strong> · {t(describe(store.rows.find((row) => `${row.kind}:${row.id}` === key)))}</p>
            <p><strong>{t("云端")}</strong> · {t(describe(remote))}</p>
            <div className="inline-actions wrap">
              <Button onClick={() => act(() => store.resolveConflict(key, true))}>{t("保留此设备版本")}</Button>
              <Button variant="quiet" onClick={() => act(() => store.resolveConflict(key, false))}>{t("采用云端版本")}</Button>
            </div>
          </div>)}
      </section>
      <section className="card padded form-stack">
        <CardHead title={t("显示与数据")} icon="device"/>
        <div className="segments compact" role="group" aria-label={t("网页主题")}>
          <button type="button" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}><Icon name="moon" size={16}/> {t("深色")}</button>
          <button type="button" aria-pressed={theme === "light"} onClick={() => setTheme("light")}><Icon name="sun" size={16}/> {t("浅色")}</button>
        </div>
        <Button icon="download" onClick={exportData}>{t("导出 CSV")}</Button>
        {hasSamples && <>
          <p className="fine">{t("示例仅用于体验。开始空白记录会移除示例，保留你已填写的数据。")}</p>
          <Button icon="check" disabled={busy} onClick={() => act(clearSamples)}>{t("移除示例，开始记录")}</Button>
        </>}
        <p className="fine">{t("记录日期以洛杉矶时间为准。")}</p>
      </section>
      <section className="card padded form-stack">
        <CardHead title={t("在线识别与安装")} icon="sparkle"/>
        <div className="capability-line"><span>{t("AI 文字解析")}</span><span>{providers.ai ? t("已启用") : t("本地解析可用")}</span></div>
        <div className="capability-line"><span>{t("AI 照片识别")}</span><span>{providers.vision ? t("已启用") : t("待配置")}</span></div>
        <div className="capability-line"><span>{t("在线 USDA")}</span><span>{providers.usda ? t("已启用") : t("本地食物库可用")}</span></div>
        <p className="fine">{t("iPhone 用 Safari 打开，点「分享」，再选择「添加到主屏幕」。")}</p>
      </section>
    </div>
  </div>;
}
