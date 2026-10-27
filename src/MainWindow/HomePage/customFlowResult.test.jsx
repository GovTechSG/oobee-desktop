// A successful Custom flow scan must go straight to the result page; the old
// post-scan "custom flow label" screen (/custom_flow) has been removed.
//   CI=true DISABLE_ESLINT_PLUGIN=true npx react-scripts test --watchAll=false src/MainWindow
import '@testing-library/jest-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nProvider } from '../../i18n'
import HomePage from './index'

// react-router v8 is ESM-only, which CRA's Jest cannot parse. HomePage only
// needs useNavigate / useLocation, so record navigations instead.
const mockNavigate = jest.fn()
jest.mock('react-router', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: null, pathname: '/' }),
}), { virtual: true })

// CRA's Jest SVG transform emits React-18 elements for `ReactComponent`
// imports, which React 19 refuses to render.
jest.mock('../../assets/chevron-up-purple.svg', () => ({ ReactComponent: () => null, default: 'up.svg' }))
jest.mock('../../assets/chevron-down-white.svg', () => ({ ReactComponent: () => null, default: 'down.svg' }))

const setupServices = () => {
  window.services = {
    getLocaleInfo: jest.fn().mockResolvedValue({ language: 'en', region: 'SG', telemetryOptOutAvailable: false }),
    getUserData: jest.fn().mockResolvedValue({ name: 'Ann', email: 'ann@example.com', browser: 'chrome', exportDir: '/tmp' }),
    editUserData: jest.fn(),
    killScan: jest.fn(),
    scanStarted: jest.fn(),
    checkChromeExistsOnMac: jest.fn().mockResolvedValue(true),
    startScan: jest.fn().mockResolvedValue({ success: true, scanId: 'scan-123' }),
  }
}

const renderHome = (setCompletedScanId) =>
  render(
    <I18nProvider>
      <HomePage appVersionInfo={{ appVersion: '0.11.22' }} setCompletedScanId={setCompletedScanId} />
    </I18nProvider>
  )

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  mockNavigate.mockReset()
  setupServices()
})

test('successful Custom flow scan navigates straight to /result', async () => {
  sessionStorage.setItem(
    'advancedOptions',
    JSON.stringify({
      scanType: 'Custom flow',
      viewport: 'Desktop',
      fileTypes: 'Webpages only',
      device: 'Desktop Chrome',
      viewportWidth: '320',
      maxConcurrency: false,
      includeScreenshots: true,
      includeSubdomains: false,
      followRobots: false,
      customChecks: true,
      wcagAaa: true,
    })
  )
  const setCompletedScanId = jest.fn()
  renderHome(setCompletedScanId)

  fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'https://example.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'Scan' }))

  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/result'))
  expect(mockNavigate).not.toHaveBeenCalledWith('/custom_flow', expect.anything())
  expect(mockNavigate.mock.calls.map((c) => c[0])).not.toContain('/custom_flow')
  expect(setCompletedScanId).toHaveBeenCalledWith('scan-123')
  expect(window.services.startScan).toHaveBeenCalledTimes(1)
  expect(window.services.startScan.mock.calls[0][0]).toEqual(expect.objectContaining({ scanType: 'custom' }))
})
