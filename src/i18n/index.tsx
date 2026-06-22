import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

export type Lang = "zh" | "en";

export type Params = Record<string, string | number>;
export type Entry = { zh: string; en: string };
export type Dict = Record<string, Entry>;

function interpolate(tpl: string, params?: Params): string {
  if (!params) {
    return tpl;
  }
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? String(params[k]) : `{${k}}`));
}

// 翻译注册表：由 locales/* 合并而来。在模块加载时填充。
export const REGISTRY: Dict = {};

export function registerDict(dict: Dict): void {
  for (const key of Object.keys(dict)) {
    REGISTRY[key] = dict[key];
  }
}

export function makeT(lang: Lang) {
  return (key: string, params?: Params): string => {
    const entry = REGISTRY[key];
    // 缺 en 回落 zh；缺 key 回落 key（开发期可定位漏翻）
    const raw = entry ? entry[lang] || entry.zh : key;
    return interpolate(raw, params);
  };
}

export type TFunc = ReturnType<typeof makeT>;

// 模块级当前语言镜像：供非组件代码（映射表函数/resolve/engine 渲染）读取。
// 组件层即时刷新靠 Context 重渲；重渲时这些函数读到的 currentLang 已同步更新。
export let currentLang: Lang = "zh";
export function syncCurrentLang(l: Lang): void {
  currentLang = l;
}

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
  t: TFunc;
}

const I18nContext = createContext<I18nValue | null>(null);

function readInitialLang(): Lang {
  try {
    const saved = localStorage.getItem("rift.lang");
    if (saved === "zh" || saved === "en") {
      return saved;
    }
    return navigator.language.startsWith("zh") ? "zh" : "en";
  } catch {
    return "zh";
  }
}

export function LangProvider({ children }: PropsWithChildren) {
  const [lang, setLangState] = useState<Lang>(readInitialLang);
  syncCurrentLang(lang);

  const setLang = useCallback((l: Lang) => {
    try {
      localStorage.setItem("rift.lang", l);
    } catch {
      /* ignore */
    }
    syncCurrentLang(l);
    setLangState(l);
  }, []);

  const t = useMemo(() => makeT(lang), [lang]);

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      setLang,
      toggle: () => setLang(lang === "zh" ? "en" : "zh"),
      t,
    }),
    [lang, setLang, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within LangProvider");
  }
  return ctx;
}

export function useLang(): Lang {
  return useI18n().lang;
}

export function useT(): TFunc {
  return useI18n().t;
}
