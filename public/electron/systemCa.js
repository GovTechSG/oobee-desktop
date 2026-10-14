// Node's TLS (axios, fetch/undici, https) trusts only its bundled Mozilla
// roots, so behind a TLS-inspecting proxy (Cloudflare WARP / Zero Trust,
// Zscaler, corporate MITM) every request fails with "self signed certificate
// in certificate chain". Chromium already trusts the OS store; this extends
// the same trust to the main process by adding the OS store (macOS Keychain
// / Windows cert store) to Node's defaults. Verification stays fully on —
// only CAs the user or their IT admin installed in the OS are added.
const tls = require('tls')

function trustSystemCertificates() {
  if (typeof tls.getCACertificates !== 'function' || typeof tls.setDefaultCACertificates !== 'function') {
    return 0
  }
  try {
    const defaults = tls.getCACertificates('default')
    const system = tls.getCACertificates('system')
    const merged = [...new Set([...defaults, ...system])]
    tls.setDefaultCACertificates(merged)
    return merged.length - defaults.length
  } catch (e) {
    console.warn(`[systemCa] could not load OS trust store: ${e.message}`)
    return 0
  }
}

module.exports = { trustSystemCertificates }
