import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { translate } from './format'
import en from './locales/en.json'
import ja from './locales/ja.json'

// Renderer i18n. The main process decides the language from the OS
// (see public/electron/localeManager.js) and the renderer only renders it.
//
// Rules (also in AGENTS.md):
// - Every user-visible string, including aria-label/alt/tooltips/alerts,
//   goes through t(). Add new keys to BOTH en.json and ja.json.
// - Internal identifiers (scan type labels such as 'Custom flow', viewport
//   and file type values, sentinel strings) must stay English; translate
//   only at display time.

export const MESSAGES = { en, ja }
export const DEFAULT_LANGUAGE = 'en'
export const TELEMETRY_OPT_OUT_ENABLED = false

const DEFAULT_LOCALE_INFO = {
  language: DEFAULT_LANGUAGE,
  region: '',
  telemetryOptOutAvailable: false,
}

const I18nContext = createContext(null)

const toNode = (result) =>
  Array.isArray(result)
    ? result.map((part, index) => <Fragment key={index}>{part}</Fragment>)
    : result

const normaliseLocaleInfo = (info) => {
  const merged = { ...DEFAULT_LOCALE_INFO, ...(info || {}) }
  if (!MESSAGES[merged.language]) merged.language = DEFAULT_LANGUAGE
  merged.telemetryOptOutAvailable = TELEMETRY_OPT_OUT_ENABLED && merged.telemetryOptOutAvailable === true
  return merged
}

const fetchLocaleInfo = async () => {
  try {
    if (window.services && typeof window.services.getLocaleInfo === 'function') {
      return normaliseLocaleInfo(await window.services.getLocaleInfo())
    }
  } catch (error) {
    console.error('Unable to get locale info, falling back to English:', error)
  }
  return normaliseLocaleInfo()
}

export const I18nProvider = ({ children }) => {
  const [localeInfo, setLocaleInfo] = useState(null)

  const refreshLocaleInfo = useCallback(async () => {
    const info = await fetchLocaleInfo()
    setLocaleInfo(info)
    return info
  }, [])

  useEffect(() => {
    refreshLocaleInfo()
  }, [refreshLocaleInfo])

  const language = localeInfo ? localeInfo.language : DEFAULT_LANGUAGE

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const value = useMemo(() => {
    const messages = MESSAGES[language] || MESSAGES[DEFAULT_LANGUAGE]
    const t = (key, vars) => toNode(translate(messages, MESSAGES[DEFAULT_LANGUAGE], key, vars))
    return {
      t,
      language,
      localeInfo: localeInfo || normaliseLocaleInfo(),
      refreshLocaleInfo,
    }
  }, [language, localeInfo, refreshLocaleInfo])

  // Render nothing until the language is known so the first paint is
  // already in the right language (avoids an English flash).
  if (!localeInfo) return null

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

const FALLBACK_CONTEXT = {
  t: (key, vars) => toNode(translate(MESSAGES[DEFAULT_LANGUAGE], MESSAGES[DEFAULT_LANGUAGE], key, vars)),
  language: DEFAULT_LANGUAGE,
  localeInfo: DEFAULT_LOCALE_INFO,
  refreshLocaleInfo: async () => DEFAULT_LOCALE_INFO,
}

export const useTranslation = () => useContext(I18nContext) || FALLBACK_CONTEXT
