// Resolves the UI language and the user's region from the OS.
//
// - Language: Japanese when the user's first preferred system language, or
//   their regional format, is Japanese. Everything else falls back to English.
//     macOS:   System Settings → General → Language & Region
//              (Preferred Languages + Region / format)
//     Windows: Settings → Time & language → Language & region
//              (Preferred languages list + Regional format)
// - Region: app.getLocaleCountryCode(). Used to decide whether the telemetry
//   opt-out is offered (only outside Singapore).
//     macOS:   the "Region" setting (CFLocale kCFLocaleCountryCode).
//     Windows: the country of the *Regional format* (GetLocaleInfoEx
//              LOCALE_NAME_USER_DEFAULT / LOCALE_SISO3166CTRYNAME), e.g.
//              "English (Singapore)" → SG, "日本語 (日本)" → JP. It does NOT
//              read Windows' separate "Country or region" (GeoID) setting.
//
// The resolve* helpers are pure so they can be unit tested with plain
// `node --test`; anything that touches Electron is loaded lazily.

const SUPPORTED_LANGUAGES = ['en', 'ja']
const DEFAULT_LANGUAGE = 'en'
const SINGAPORE = 'SG'

const isJapaneseTag = (tag) =>
  typeof tag === 'string' && /^ja(?:[-_]|$)/i.test(tag.trim())

const resolveLanguage = ({ override, preferredLanguages, systemLocale } = {}) => {
  if (typeof override === 'string' && override.trim() !== '') {
    const normalised = override.trim().toLowerCase().split(/[-_]/)[0]
    if (SUPPORTED_LANGUAGES.includes(normalised)) return normalised
  }
  const firstPreferred = Array.isArray(preferredLanguages) ? preferredLanguages[0] : undefined
  if (isJapaneseTag(firstPreferred) || isJapaneseTag(systemLocale)) return 'ja'
  return DEFAULT_LANGUAGE
}

const normaliseRegion = (value) => {
  if (typeof value !== 'string') return ''
  const upper = value.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(upper) ? upper : ''
}

// Pull the region subtag out of a BCP 47 / POSIX locale ("en-SG", "ja_JP",
// "zh-Hant-TW"). Script subtags (4 letters) and UN M.49 codes are skipped.
const regionFromLocale = (locale) => {
  if (typeof locale !== 'string') return ''
  const subtags = locale.trim().split(/[-_.@]/).slice(1)
  for (const subtag of subtags) {
    const region = normaliseRegion(subtag)
    if (region) return region
  }
  return ''
}

const resolveRegion = ({ override, countryCode, systemLocale } = {}) =>
  normaliseRegion(override) ||
  normaliseRegion(countryCode) ||
  regionFromLocale(systemLocale)

// An unknown region keeps the existing (Singapore) behaviour: no opt-out.
const isOutsideSingaporeRegion = (region) => region !== '' && region !== SINGAPORE

// A saved opt-out is always respected and must stay visible so the user can
// review or undo it, even if their region later becomes Singapore.
const isTelemetryOptOutOffered = ({ region, savedOptOut }) =>
  savedOptOut === true || isOutsideSingaporeRegion(region)

const safeCall = (fn, fallback) => {
  try {
    const value = fn()
    return value === undefined || value === null ? fallback : value
  } catch {
    return fallback
  }
}

const readSystemLocale = () => {
  const { app } = require('electron')
  return {
    preferredLanguages: safeCall(() => app.getPreferredSystemLanguages(), []),
    systemLocale: safeCall(() => app.getSystemLocale(), ''),
    countryCode: safeCall(() => app.getLocaleCountryCode(), ''),
  }
}

const getRegion = () => {
  const { countryCode, systemLocale } = readSystemLocale()
  return resolveRegion({
    override: process.env.OOBEE_DESKTOP_REGION,
    countryCode,
    systemLocale,
  })
}

const isOutsideSingapore = () => isOutsideSingaporeRegion(getRegion())

const getLocaleInfo = ({ savedOptOut = false } = {}) => {
  const { preferredLanguages, systemLocale, countryCode } = readSystemLocale()
  const language = resolveLanguage({
    override: process.env.OOBEE_DESKTOP_LANGUAGE,
    preferredLanguages,
    systemLocale,
  })
  const region = resolveRegion({
    override: process.env.OOBEE_DESKTOP_REGION,
    countryCode,
    systemLocale,
  })
  return {
    language,
    region,
    telemetryOptOutAvailable: isTelemetryOptOutOffered({ region, savedOptOut }),
  }
}

module.exports = {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  SINGAPORE,
  resolveLanguage,
  resolveRegion,
  regionFromLocale,
  isOutsideSingaporeRegion,
  isTelemetryOptOutOffered,
  getRegion,
  isOutsideSingapore,
  getLocaleInfo,
}
