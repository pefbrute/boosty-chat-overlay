// tools/tutorial-video/src/scenes/Scene2DeveloperMode.jsx
import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';
import { BrowserFrame } from '../components/BrowserFrame';
import { StepBadge } from '../components/StepBadge';
import { Cursor } from '../components/Cursor';
import { RU_COPY } from '../copy/ru';
import { VIDEO_CONFIG } from '../config';

export const Scene2DeveloperMode = () => {
  const frame = useCurrentFrame();

  // Exact target center for Dev Mode toggle switch
  const targetX = VIDEO_CONFIG.coordinates.toggleTarget.x || 1140;
  const targetY = VIDEO_CONFIG.coordinates.toggleTarget.y || 138;

  // 1. Smooth, realistic cursor motion with ease-in-out slowing down before target
  // Frames 0 to 35: moves from previous position (680, 130) to exact toggle center (targetX, targetY)
  const cursorProgress = interpolate(frame, [0, 35], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // Cubic ease-in-out curve
  const eased = cursorProgress < 0.5
    ? 4 * cursorProgress * cursorProgress * cursorProgress
    : 1 - Math.pow(-2 * cursorProgress + 2, 3) / 2;

  const cursorX = interpolate(eased, [0, 1], [680, targetX]);
  const cursorY = interpolate(eased, [0, 1], [130, targetY]);

  // 2. Click sequence per ТЗ sections 3 & 4:
  // - cursor down: frame 36 to 43 (scale down 7%, click ripple)
  // - cursor up: frame 44
  // - toggle switch state change: frame >= 48 (150ms natural delay after click completion)
  const isClicking = frame >= 36 && frame <= 43;
  const isToggleSwitched = frame >= 48;
  const isHighlighted = frame >= 28 && frame < 48;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <StepBadge
        stepNumber={2}
        title={RU_COPY.step2.title}
        subtitle={RU_COPY.step2.toggleLabel}
      />

      <div
        style={{
          marginTop: 40,
          transform: 'scale(0.95)',
        }}
      >
        <BrowserFrame
          devModeChecked={isToggleSwitched}
          devModeHighlighted={isHighlighted}
          pageLoaded={true}
          addressText="browser://extensions"
          scale={1}
        />
      </div>

      <Cursor x={cursorX} y={cursorY} clicking={isClicking} />
    </div>
  );
};
