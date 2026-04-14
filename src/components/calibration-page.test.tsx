import { fireEvent, render, screen } from '@testing-library/react'
import { CalibrationPage } from '@/components/calibration-page'
import { RIG_CALIBRATION, SHIRT_CALIBRATION } from '@/lib/mirror/constants'
import type { ModelCalibrationStageProps } from '@/components/model-calibration-stage'

describe('CalibrationPage', () => {
  it('renders the default hardcoded values into the calibration stage and snippet', () => {
    function FakeStage({
      shirtCalibration,
      garmentOpacity,
    }: ModelCalibrationStageProps) {
      return (
        <div
          data-testid="calibration-stage"
          data-shirt-scale-x={String(shirtCalibration.scaleX)}
          data-garment-opacity={String(garmentOpacity)}
        />
      )
    }

    render(<CalibrationPage StageComponent={FakeStage} />)

    expect(screen.getByTestId('calibration-stage')).toHaveAttribute(
      'data-shirt-scale-x',
      String(SHIRT_CALIBRATION.scaleX),
    )
    expect(screen.getByTestId('calibration-stage')).toHaveAttribute('data-garment-opacity', '1')
    expect(screen.getByTestId('calibration-snippet')).toHaveTextContent(
      `leftArmZRotationOffset: ${RIG_CALIBRATION.leftArmZRotationOffset}`,
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
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('RIG_CALIBRATION'))
  })

  it('updates rig calibration from the quick sleeve offset controls', () => {
    function FakeStage(_props: ModelCalibrationStageProps) {
      return <div data-testid="calibration-stage" />
    }

    render(<CalibrationPage StageComponent={FakeStage} />)

    const leftSleeveOffsetInput = screen.getByRole('spinbutton', {
      name: /left sleeve offset/i,
    })
    fireEvent.change(leftSleeveOffsetInput, {
      target: { value: '-0.33' },
    })

    expect(screen.getByTestId('calibration-snippet')).toHaveTextContent(
      'leftArmZRotationOffset: -0.33',
    )
  })
})
