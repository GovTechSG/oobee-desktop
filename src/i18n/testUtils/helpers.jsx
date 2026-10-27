// Shared helpers for the i18n / telemetry render tests (not a test file).
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider } from '../index'

export const setupServices = (localeInfo) => {
  window.services = {
    getLocaleInfo: jest.fn().mockResolvedValue(localeInfo),
    getUserData: jest.fn().mockResolvedValue({ exportDir: '/tmp/out' }),
    setUserData: jest.fn(),
    editUserData: jest.fn(),
  }
}

export const renderWithI18n = (ui) => render(<I18nProvider>{ui}</I18nProvider>)

export const goToLastOnboardingStep = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Let's go|はじめる/ }))
  for (let i = 0; i < 3; i++) {
    fireEvent.click(screen.getByRole('button', { name: /^(Next|次へ)$/ }))
  }
}
