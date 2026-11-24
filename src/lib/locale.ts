import { ENGLISH } from "./english.ts";

export type Language = "zh" | "en";
export type Translate = (message: string | TemplateStringsArray, ...values: unknown[]) => string;

// Keep canonical record labels stable and translate them only for presentation.
export function translate(language: Language, message: string | TemplateStringsArray, ...values: unknown[]) {
  const format = (key: string) => language === "en" && Object.hasOwn(ENGLISH, key) ? ENGLISH[key] : key;
  if (typeof message === "string") return format(message);
  const key = message.reduce((result, part, index) => `${result}${index ? `{${index - 1}}` : ""}${part}`, "");
  const template = format(key);
  return template.replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)] ?? ""));
}

export function asLanguage(value: string | null): Language | null {
  return value === "zh" || value === "en" ? value : null;
}
