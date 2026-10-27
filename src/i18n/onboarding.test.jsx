// Render tests: language selection + onboarding telemetry opt-out.
//   CI=true DISABLE_ESLINT_PLUGIN=true npx react-scripts test --watchAll=false src/i18n
import '@testing-library/jest-dom'
import { screen, fireEvent } from '@testing-library/react'
import OnboardingComponent from '../MainWindow/Onboarding/OnboardingComponent'
import AdvancedScanOptions from '../MainWindow/HomePage/AdvancedScanOptions'
import { getDefaultAdvancedOptions, scanTypes, viewportTypes, fileTypes } from '../common/constants'
import { setupServices, renderWithI18n, goToLastOnboardingStep } from './testUtils/helpers'

// CRA's Jest SVG transform emits React-18 elements for `ReactComponent`
// imports, which React 19 refuses to render. Stub the icons used here.
jest.mock('../assets/chevron-up-purple.svg', () => ({ ReactComponent: () => null, default: 'chevron-up.svg' }))
jest.mock('../assets/chevron-down-white.svg', () => ({ ReactComponent: () => null, default: 'chevron-down.svg' }))

describe('language', () => {
  test('renders Japanese and sets <html lang="ja"> when the OS language is Japanese', async () => {
    setupServices({ language: 'ja', region: 'JP', telemetryOptOutAvailable: true })
    renderWithI18n(<OnboardingComponent setDataExistStatus={() => {}} />)
    expect(await screen.findByText('こんにちは！')).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('ja')
  })

  test('renders English by default', async () => {
    setupServices({ language: 'en', region: 'SG', telemetryOptOutAvailable: false })
    renderWithI18n(<OnboardingComponent setDataExistStatus={() => {}} />)
    expect(await screen.findByText('Hi there!')).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en')
  })

  test('falls back to English if locale info is unavailable', async () => {
    window.services = { getUserData: jest.fn().mockResolvedValue({}) }
    renderWithI18n(<OnboardingComponent setDataExistStatus={() => {}} />)
    expect(await screen.findByText('Hi there!')).toBeInTheDocument()
  })

  test('dropdown values stay English internally while labels are Japanese', async () => {
    setupServices({ language: 'ja', region: 'JP', telemetryOptOutAvailable: true })
    const setAdvancedOptions = jest.fn()
    renderWithI18n(
      <AdvancedScanOptions
        scanTypeOptions={Object.keys(scanTypes).filter((s) => s !== 'Local file')}
        fileTypesOptions={Object.keys(fileTypes)}
        viewportOptions={viewportTypes}
        deviceOptions={[]}
        advancedOptions={getDefaultAdvancedOptions()}
        setAdvancedOptions={setAdvancedOptions}
        scanButtonIsClicked={false}
        isFileOptionChecked={false}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: /詳細スキャンオプション/ }))
    expect(screen.getByRole('option', { name: 'カスタムフロー' })).toHaveValue('Custom flow')
    fireEvent.change(screen.getByLabelText('スキャンタイプ:'), { target: { value: 'Custom flow' } })
    expect(setAdvancedOptions).toHaveBeenCalledWith(expect.objectContaining({ scanType: 'Custom flow' }))
  })
})

describe('onboarding telemetry opt-out', () => {
  test('is hidden in Singapore', async () => {
    setupServices({ language: 'en', region: 'SG', telemetryOptOutAvailable: false })
    renderWithI18n(<OnboardingComponent setDataExistStatus={() => {}} />)
    await goToLastOnboardingStep()
    expect(screen.queryByLabelText(/Opt out of accessibility scan telemetry/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'I consent' })).toBeDisabled()
  })

  test('outside Singapore: opting out blanks name/email and submits without them', async () => {
    setupServices({ language: 'en', region: 'JP', telemetryOptOutAvailable: true })
    const setDataExistStatus = jest.fn()
    renderWithI18n(<OnboardingComponent setDataExistStatus={setDataExistStatus} />)
    await goToLastOnboardingStep()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Taro Yamada' } })
    fireEvent.change(screen.getByLabelText('Work Email'), { target: { value: 'taro@example.jp' } })
    fireEvent.click(screen.getByLabelText(/Opt out of accessibility scan telemetry/))

    expect(screen.getByLabelText('Name')).toHaveValue('')
    expect(screen.getByLabelText('Name')).toBeDisabled()
    expect(screen.getByLabelText('Work Email')).toHaveValue('')
    expect(screen.getByLabelText('Work Email')).toBeDisabled()

    const submit = screen.getByRole('button', { name: 'Continue' })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)

    expect(window.services.setUserData).toHaveBeenCalledWith({ name: '', email: '', telemetryOptOut: true })
    expect(setDataExistStatus).toHaveBeenCalledWith('exists')
  })

  test('outside Singapore without opting out still requires name/email', async () => {
    setupServices({ language: 'en', region: 'JP', telemetryOptOutAvailable: true })
    renderWithI18n(<OnboardingComponent setDataExistStatus={() => {}} />)
    await goToLastOnboardingStep()
    expect(screen.getByRole('button', { name: 'I consent' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Taro Yamada' } })
    fireEvent.change(screen.getByLabelText('Work Email'), { target: { value: 'taro@example.jp' } })
    fireEvent.click(screen.getByRole('button', { name: 'I consent' }))
    expect(window.services.setUserData).toHaveBeenCalledWith({
      name: 'Taro Yamada',
      email: 'taro@example.jp',
      telemetryOptOut: false,
    })
  })
})
