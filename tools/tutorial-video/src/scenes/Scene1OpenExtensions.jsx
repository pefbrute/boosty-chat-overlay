// tools/tutorial-video/src/scenes/Scene1OpenExtensions.jsx
import React from 'react';
import { useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';
import { BrowserFrame } from '../components/BrowserFrame';
import { StepBadge } from '../components/StepBadge';
import { Cursor } from '../components/Cursor';
import { RU_COPY } from '../copy/ru';

export const Scene1OpenExtensions = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Entrance spring for the browser window
  const scale = spring({
    frame,
    fps,
    config: { damping: 14, mass: 0.8 },
  });

  const opacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' });

  // 1. Cursor moves smoothly towards the address bar: frames 0 to 18
  const cursorX = interpolate(
    frame,
    [0, 18, 55, 75],
    [760, 260, 520, 680],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const cursorY = interpolate(
    frame,
    [0, 18, 55, 75],
    [480, 150, 150, 130],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Click animation inside address bar: frames 16 to 22
  const isClicking = frame >= 16 && frame <= 22;
  const isAddressFocused = frame >= 18;

  // Typewriter effect: 'browser://extensions' (20 chars) across frames 22 to 50 (~0.93 sec)
  const fullUrl = 'browser://extensions';
  const charsTyped = Math.floor(
    interpolate(frame, [22, 50], [0, fullUrl.length], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })
  );
  const currentAddressText = isAddressFocused ? fullUrl.slice(0, charsTyped) : '';
  const showCaret = isAddressFocused && frame < 60 && (Math.floor(frame / 6) % 2 === 0 || frame >= 22);

  // Enter key hint badge: frames 50 to 60
  const showEnterHint = frame >= 50 && frame < 62;

  // Page loads after Enter: frame >= 60
  const pageLoaded = frame >= 60;

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
        stepNumber={1}
        title={RU_COPY.step1.title}
        subtitle={RU_COPY.step1.url}
      />

      <div
        style={{
          marginTop: 40,
          transform: `scale(${scale * 0.95})`,
          opacity,
        }}
      >
        <BrowserFrame
          devModeChecked={false}
          highlightAddressBar={isAddressFocused && frame < 62}
          addressText={currentAddressText}
          showCaret={showCaret}
          showEnterHint={showEnterHint}
          pageLoaded={pageLoaded}
          scale={1}
        />
      </div>

      <Cursor x={cursorX} y={cursorY} clicking={isClicking} />
    </div>
  );
};
