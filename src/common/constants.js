import boxRightArrow from '../assets/box-arrow-up-right-purple.svg'

export const scanTypes = {
  'Website crawl': 'website',
  'Sitemap crawl': 'sitemap',
  'Custom flow': 'custom',
  'Local file': 'localfile',
}

export const viewportTypes = {
  desktop: 'Desktop',
  mobile: 'Mobile',
  specific: 'Specific device...',
  custom: 'Custom width...',
}

export const fileTypes = {
  'Webpages only': 'html-only',
  'PDF files only': 'pdf-only',
  'Both webpages and PDF files': 'all',
}

// key is what will be displayed on the GUI, value is the internal value that Playwright recognises
export const devices = {
  'Blackberry PlayBook': 'Blackberry PlayBook',
  'BlackBerry Z30': 'BlackBerry Z30',
  'Samsung Galaxy Note 3': 'Galaxy Note 3',
  'Samsung Galaxy Note II': 'Galaxy Note II',
  'Samsung Galaxy S III': 'Galaxy S III',
  'Samsung Galaxy S5': 'Galaxy S5',
  'Samsung Galaxy S8': 'Galaxy S8',
  'Samsung Galaxy S9+': 'Galaxy S9+',
  'Samsung Galaxy Tab S4': 'Galaxy Tab S4',
  'iPad (gen 6)': 'iPad (gen 6)',
  'iPad (gen 7)': 'iPad (gen 7)',
  'iPad Mini': 'iPad Mini',
  'iPad Pro 11': 'iPad Pro 11',
  'iPhone 6': 'iPhone 6',
  'iPhone 6 Plus': 'iPhone 6 Plus',
  'iPhone 7': 'iPhone 7',
  'iPhone 7 Plus': 'iPhone 7 Plus',
  'iPhone 8': 'iPhone 8',
  'iPhone 8 Plus': 'iPhone 8 Plus',
  'iPhone SE': 'iPhone SE',
  'iPhone X': 'iPhone X',
  'iPhone XR': 'iPhone XR',
  'iPhone 11': 'iPhone 11',
  'iPhone 11 Pro': 'iPhone 11 Pro',
  'iPhone 11 Pro Max': 'iPhone 11 Pro Max',
  'iPhone 12': 'iPhone 12',
  'iPhone 12 Pro': 'iPhone 12 Pro',
  'iPhone 12 Pro Max': 'iPhone 12 Pro Max',
  'iPhone 12 Mini': 'iPhone 12 Mini',
  'iPhone 13': 'iPhone 13',
  'iPhone 13 Pro': 'iPhone 13 Pro',
  'iPhone 13 Pro Max': 'iPhone 13 Pro Max',
  'iPhone 13 Mini': 'iPhone 13 Mini',
  'Kindle Fire HDX': 'Kindle Fire HDX',
  'LG Optimus L70': 'LG Optimus L70',
  'Microsoft Lumia 550': 'Microsoft Lumia 550',
  'Microsoft Lumia 950': 'Microsoft Lumia 950',
  'Google Nexus 4': 'Nexus 4',
  'Google Nexus 5': 'Nexus 5',
  'Google Nexus 5X': 'Nexus 5X',
  'Google Nexus 6': 'Nexus 6',
  'Google Nexus 6P': 'Nexus 6P',
  'Google Nexus 7': 'Nexus 7',
  'Google Nexus 10': 'Nexus 10',
  'Nokia Lumia 520': 'Nokia Lumia 520',
  'Nokia N9': 'Nokia N9',
  'Google Pixel 2': 'Pixel 2',
  'Google Pixel 2 XL': 'Pixel 2 XL',
  'Google Pixel 3': 'Pixel 3',
  'Google Pixel 4': 'Pixel 4',
  'Google Pixel 4a (5G)': 'Pixel 4a (5G)',
  'Google Pixel 5': 'Pixel 5',
  'Motorola Moto G4': 'Moto G4',
}

export const getDefaultAdvancedOptions = (isProxy) => {
  const deviceOptions = isProxy ? [] : Object.keys(devices)
  return {
    scanType: Object.keys(scanTypes)[0],
    viewport: viewportTypes.desktop,
    fileTypes: Object.keys(fileTypes)[0],
    device: deviceOptions[0],
    viewportWidth: '320',
    maxConcurrency: false,
    includeScreenshots: true,
    includeSubdomains: true,
    followRobots: false,
    customChecks: true,
    wcagAaa: false,
  }
}

// exit codes returned by Oobee cli when there is an error with the URL provided
export const cliErrorCodes = new Set([11, 12, 13, 14, 15, 16, 17, 19])
export const cliErrorTypes = {
  invalidUrl: 11,
  cannotBeResolved: 12,
  errorStatusReceived: 13,
  systemError: 14,
  notASitemap: 15,
  unauthorisedBasicAuth: 16,
  browserError: 17,
  notALocalFile: 19,
}

export const errorStates = {
  browserError: 'browserError',
  noPagesScannedError: 'noPagesScannedError',
}

export const policyUrlElem = (
  <a
    role="link"
    className="link"
    href="#"
    onClick={(e) => {
      handleClickLink(e, 'https://www.tech.gov.sg/privacy/')
    }}
  >
    GovTech's Privacy Policy
    <img className="external-link" src={boxRightArrow}></img>
  </a>
)

export const installChromeUrl = `https://www.google.com/chrome/?brand=CHBD&brand=CHBD&gclid=CjwKCAjwivemBhBhEiwAJxNWNw4XXX3fa_mPCTmN68msYCUU6zovJt0g4ZCSB5sdYm1icRv-qs2v9RoCmPsQAvD_BwE&gclsrc=aw.ds`

export const handleClickLink = (e, url) => {
  e.preventDefault()
  window.services.openLink(url)
}

export const forbiddenCharactersInDirPath = [
  '<',
  '>',
  ':',
  '"',
  '/',
  '\\',
  '|',
  '?',
  '*',
]
export const reserveFileNameKeywords = [
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]

export const versionComparator = (ver1, ver2) => {
  // return 1 if ver1 >= ver2, else return -1
  console.log(ver1, ver2)
  const splitVer1 = ver1.split('.')
  const splitVer2 = ver2.split('.')
  let idx = 0
  while (splitVer1[idx] && splitVer2[idx]) {
    const int1 = parseInt(splitVer1[idx])
    const int2 = parseInt(splitVer2[idx])
    if (int1 > int2) {
      return 1
    } else if (int1 < int2) {
      return -1
    }
    idx++
  }

  if (!splitVer1[idx] && splitVer2[idx]) return -1

  return 1
}

export const urlWithoutAuth = (url) => {
  const parsedUrl = new URL(url)
  parsedUrl.username = ''
  parsedUrl.password = ''
  return parsedUrl
}
