import { fireEvent, render, screen } from '@testing-library/react'
import { CalibrationPage } from '@/components/calibration-page'
import { SHIRT_CALIBRATION, SLEEVE_CALIBRATION } from '@/lib/mirror/constants'
import type { ModelCalibrationStageProps } from '@/components/model-calibration-stage'

describe('CalibrationPage', () => {
  it('renders the default hardcoded values into the calibration stage and snippet', () => {
    function FakeStage({
      shirtCalibration,
      torsoOpacity,
      sleeveOpacity,
    }: ModelCalibrationStageProps) {
      return (
        <div
          data-testid="calibration-stage"
          data-shirt-scale-x={String(shirtCalibration.scaleX)}
          data-torso-opacity={String(torsoOpacity)}
          data-sleeve-opacity={String(sleeveOpacity)}
        />
      )
    }

    render(<CalibrationPage StageComponent={FakeStage} />)

    expect(screen.getByTestId('calibration-stage')).toHaveAttribute(
      'data-shirt-scale-x',
      String(SHIRT_CALIBRATION.scaleX),
    )
    expect(screen.getByTestId('calibration-stage')).toHaveAttribute('data-torso-opacity', '1')
    expect(screen.getByTestId('calibration-stage')).toHaveAttribute('data-sleeve-opacity', '1')
    expect(screen.getByTestId('calibration-snippet')).toHaveTextContent(
      `lineOffset: ${SLEEVE_CALIBRATION.lineOffset}`,
    )
  })

  it('copies the generated snippet to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: {
        writeText,
      },
    })

    function FakeStage(_props: ModelCalibrationStageProps) {
      return <div data-testid="calibration-stage" />
    }

    render(<CalibrationPage StageComponent={FakeStage} />)

    fireEvent.click(screen.getByRole('button', { name: /copy values/i }))

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('SHIRT_CALIBRATION'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('SLEEVE_CALIBRATION'))
  })
})
