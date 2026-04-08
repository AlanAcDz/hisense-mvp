import { fireEvent, render, screen } from '@testing-library/react'
import { CalibrationPage } from '@/components/calibration-page'
import { SHIRT_CALIBRATION, SLEEVE_ANCHOR_RATIO } from '@/lib/mirror/constants'
import type { ModelCalibrationStageProps } from '@/components/model-calibration-stage'

describe('CalibrationPage', () => {
  it('renders the default hardcoded values into the calibration stage and snippet', () => {
    function FakeStage({
      shirtCalibration,
      sleeveAnchorRatio,
      torsoOpacity,
      sleeveOpacity,
    }: ModelCalibrationStageProps) {
      return (
        <div
          data-testid="calibration-stage"
          data-shirt-scale-x={String(shirtCalibration.scaleX)}
          data-sleeve-anchor={String(sleeveAnchorRatio)}
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
    expect(screen.getByTestId('calibration-stage')).toHaveAttribute(
      'data-sleeve-anchor',
      String(SLEEVE_ANCHOR_RATIO),
    )
    expect(screen.getByTestId('calibration-stage')).toHaveAttribute('data-torso-opacity', '1')
    expect(screen.getByTestId('calibration-stage')).toHaveAttribute('data-sleeve-opacity', '1')
    expect(screen.getByTestId('calibration-snippet')).toHaveTextContent(
      `export const SLEEVE_ANCHOR_RATIO = ${SLEEVE_ANCHOR_RATIO}`,
    )
  })

  it('updates values live and copies the generated snippet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: {
        writeText,
      },
    })

    function FakeStage({ sleeveAnchorRatio }: ModelCalibrationStageProps) {
      return <div data-testid="calibration-stage" data-sleeve-anchor={String(sleeveAnchorRatio)} />
    }

    render(<CalibrationPage StageComponent={FakeStage} />)

    fireEvent.change(screen.getByRole('slider', { name: /sleeve anchor/i }), {
      target: { value: '0.31' },
    })

    expect(screen.getByTestId('calibration-stage')).toHaveAttribute('data-sleeve-anchor', '0.31')
    expect(screen.getByTestId('calibration-snippet')).toHaveTextContent('export const SLEEVE_ANCHOR_RATIO = 0.31')

    fireEvent.click(screen.getByRole('button', { name: /copy values/i }))

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('export const SLEEVE_ANCHOR_RATIO = 0.31'))
  })
})
