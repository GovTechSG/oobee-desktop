import boxRightArrow from '../assets/box-arrow-up-right-purple.svg'

// Download from https://github.com/microsoft/playwright/blob/v1.50.1/packages/playwright-core/src/server/deviceDescriptorsSource.json
import deviceDescriptors from './deviceDescriptorsSource.json';

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
export const devices = Object.fromEntries(
  Object.entries(deviceDescriptors)
    .filter(([name]) =>
      !name.includes('Edge') && !name.includes('Firefox') && !name.includes('Safari')
    )
    .map(([name, _config]) => {
      let displayName = name;
      if (name.includes('Galaxy')) {
        displayName = `Samsung ${name}`;
      } else if (name.includes('Nexus') || name.includes('Pixel')) {
        displayName = `Google ${name}`;
      }
      return [displayName, name];
    })
);

export const getDefaultAdvancedOptions = () => {
  const deviceOptions = Object.keys(devices)
  return {
    scanType: Object.keys(scanTypes)[0],
    viewport: viewportTypes.desktop,
    fileTypes: Object.keys(fileTypes)[0],
    device: deviceOptions[0],
    viewportWidth: '320',
    maxConcurrency: false,
    includeScreenshots: true,
    includeSubdomains: false,
    followRobots: false,
    customChecks: true,
    wcagAaa: true,
  }
}

// exit codes returned by Oobee cli when there is an error with the URL provided
export const cliErrorCodes = new Set([11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
export const cliErrorTypes = {
  invalidUrl: 11,
  cannotBeResolved: 12,
  errorStatusReceived: 13,
  systemError: 14,
  notASitemap: 15,
  unauthorisedBasicAuth: 16,
  unauthorised: 16, // alias to match urlCheckStatuses naming
  browserError: 17,
  axiosTimeout: 18,
  notALocalFile: 19,
  notAPdf: 20,
  terminated: 145,
  terminationRequested: 15,
}

export const urlCheckStatuses = {
  success: { code: 0 },
  invalidUrl: { code: 11, message: 'Invalid URL. Please check and try again.' },
  cannotBeResolved: { code: 12, message: 'URL cannot be accessed. Please verify whether the website exists.' },
  errorStatusReceived: {
    // unused for now
    code: 13,
    message: 'Provided URL cannot be accessed. Server responded with code ', // append it with the response code received,
  },
  systemError: { code: 14, message: 'Something went wrong when verifying the URL. Please try again in a few minutes. If this issue persists, please contact the Oobee team.'},
  notASitemap: { code: 15, message: 'Invalid sitemap URL format. Please enter a valid sitemap URL ending with .XML or .TXT e.g. https://www.example.com/sitemap.xml.' },
  unauthorised: { code: 16, message: 'Login required. Please enter your credentials and try again.' },
  // browserError means engine could not find a browser to run the scan
  browserError: {
    code: 17,
    message:
      'Incompatible browser. Please ensure you are using Chrome or Edge browser.',
  },
  sslProtocolError: { code: 18, message: 'SSL certificate  error. Please check the SSL configuration of your website and try again.' },
  notALocalFile: { code: 19, message: 'Uploaded file format is incorrect. Please upload a HTML, PDF, XML or TXT file.' },
  notAPdf: { code: 20, message: 'URL/file format is incorrect. Please upload a PDF file.' },
  notASupportedDocument: { code: 21, message: 'Uploaded file format is incorrect. Please upload a HTML, PDF, XML or TXT file.' },
  connectionRefused: { code: 22, message: 'Connection refused. Please try again in a few minutes. If this issue persists, please contact the Oobee team.' },
  timedOut: { code: 23, message: 'Request timed out. Please try again in a few minutes. If this issue persists, please contact the Oobee team.' },
};

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
