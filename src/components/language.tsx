"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { asLanguage, translate, type Language, type Translate } from "../lib/locale";

const storageKey = "cut-log:language";
const LanguageContext = createContext<{ language: Language; t: Translate; setLanguage: (language: Language) => void }>({
  language: "zh", t: (message, ...values) => translate("zh", message, ...values), setLanguage: () => {},
});

// A shared link can select a version. The visible switch remembers a device's choice.
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, update] = useState<Language>("zh");
  useEffect(() => {
    function read() {
      const openLanguage = asLanguage(new URLSearchParams(window.location.search).get("lang"));
      if (openLanguage) { update(openLanguage); return; }
      try { update(asLanguage(localStorage.getItem(storageKey)) ?? "zh"); }
      catch { update("zh"); }
    }
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
    const title = translate(language, "减脂日志");
    document.title = title;
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", title);
    document.querySelector('link[rel="manifest"]')?.setAttribute("href", language === "en" ? "/manifest.en.webmanifest" : "/manifest.webmanifest");
  }, [language]);

  const value = useMemo(() => ({
    language,
    t: (message: string | TemplateStringsArray, ...values: unknown[]) => translate(language, message, ...values),
    setLanguage(next: Language) {
      update(next);
      try { localStorage.setItem(storageKey, next); } catch { /* The switch still works in this tab. */ }
      const url = new URL(window.location.href);
      if (url.protocol !== "file:") {
        url.searchParams.set("lang", next);
        window.history.replaceState(window.history.state, "", url);
      }
    },
  }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}
