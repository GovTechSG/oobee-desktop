// Render tests: edit-profile telemetry opt-out.
//   CI=true DISABLE_ESLINT_PLUGIN=true npx react-scripts test --watchAll=false src/i18n
import '@testing-library/jest-dom'
import { screen, fireEvent, act } from '@testing-library/react'
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

test('outside Singapore (Japanese UI): opt-out is hidden and profile editing still works', async () => {
  setupServices({ language: 'ja', region: 'US', telemetryOptOutAvailable: true })
  renderModal()
  await screen.findByLabelText('氏名')
  expect(screen.queryByLabelText('アクセシビリティスキャンのテレメトリーを無効にする')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('氏名'), { target: { value: 'Updated Name' } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '更新' }))
  })
  expect(window.services.editUserData).toHaveBeenCalledWith({ name: 'Updated Name', email: 'taro@example.jp' })
})

test.each(['SG', 'JP', ''])('saved opt-out stays hidden in region %s without being overwritten', async (region) => {
  setupServices({ language: 'en', region, telemetryOptOutAvailable: true })
  renderModal({ initialName: '', initialEmail: '', initialTelemetryOptOut: true })
  await screen.findByText('Edit your profile')
  expect(screen.queryByLabelText(/Opt out of accessibility scan telemetry/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Telemetry will resume after you restart Oobee/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Taro Yamada' } })
  fireEvent.change(screen.getByLabelText('Work Email'), { target: { value: 'taro@example.jp' } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
  })
  expect(window.services.editUserData).toHaveBeenCalledWith({
    name: 'Taro Yamada',
    email: 'taro@example.jp',
  })
})
