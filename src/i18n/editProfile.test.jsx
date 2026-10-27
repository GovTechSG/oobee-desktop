// Render tests: edit-profile telemetry opt-out.
//   CI=true DISABLE_ESLINT_PLUGIN=true npx react-scripts test --watchAll=false src/i18n
import '@testing-library/jest-dom'
import { screen, fireEvent } from '@testing-library/react'
import EditUserDetailsModal from '../MainWindow/HomePage/EditUserDetailsModal'
import { setupServices, renderWithI18n } from './testUtils/helpers'

const renderModal = (props = {}) =>
  renderWithI18n(
    <EditUserDetailsModal
      id="edit-details-modal"
      formID="edit-details-form"
      showModal={true}
      initialName="Taro Yamada"
      initialEmail="taro@example.jp"
      setShowEditDataModal={() => {}}
      setUserData={() => {}}
      {...props}
    />
  )

test('is hidden in Singapore', async () => {
  setupServices({ language: 'en', region: 'SG', telemetryOptOutAvailable: false })
  renderModal()
  await screen.findByText('Edit your profile')
  expect(screen.queryByLabelText(/Opt out of accessibility scan telemetry/)).not.toBeInTheDocument()
})

test('outside Singapore (Japanese UI): opting out sends blank name/email', async () => {
  setupServices({ language: 'ja', region: 'US', telemetryOptOutAvailable: true })
  renderModal()
  fireEvent.click(await screen.findByLabelText('アクセシビリティスキャンのテレメトリーを無効にする'))
  expect(screen.getByLabelText('氏名')).toHaveValue('')
  expect(screen.getByText(/GovTech に送信されません/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '更新' }))
  expect(window.services.editUserData).toHaveBeenCalledWith({ name: '', email: '', telemetryOptOut: true })
})

test('opted-out user can opt back in and sees the restart note', async () => {
  setupServices({ language: 'en', region: 'SG', telemetryOptOutAvailable: true })
  renderModal({ initialName: '', initialEmail: '', initialTelemetryOptOut: true })
  const checkbox = await screen.findByLabelText(/Opt out of accessibility scan telemetry/)
  expect(checkbox).toBeChecked()
  fireEvent.click(checkbox)
  expect(screen.getByText(/Telemetry will resume after you restart Oobee/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Taro Yamada' } })
  fireEvent.change(screen.getByLabelText('Work Email'), { target: { value: 'taro@example.jp' } })
  fireEvent.click(screen.getByRole('button', { name: 'Update' }))
  expect(window.services.editUserData).toHaveBeenCalledWith({
    name: 'Taro Yamada',
    email: 'taro@example.jp',
    telemetryOptOut: false,
  })
})
