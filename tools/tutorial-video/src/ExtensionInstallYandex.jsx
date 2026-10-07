// tools/tutorial-video/src/ExtensionInstallYandex.jsx
import React from 'react';
import { Series, useCurrentFrame } from 'remotion';
import { Scene1OpenExtensions } from './scenes/Scene1OpenExtensions';
import { Scene2DeveloperMode } from './scenes/Scene2DeveloperMode';
import { Scene3DragFolder } from './scenes/Scene3DragFolder';
import { StepProgressBar } from './components/StepBadge';
import { VIDEO_CONFIG } from './config';

export const ExtensionInstallYandex = () => {
  const frame = useCurrentFrame();
  const s1 = VIDEO_CONFIG.sceneTimings.scene1DurationFrames;
  const s2 = VIDEO_CONFIG.sceneTimings.scene2DurationFrames;

  let activeStep = 1;
  if (frame >= s1 + s2) {
    activeStep = 3;
  } else if (frame >= s1) {
    activeStep = 2;
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        backgroundColor: '#0f172a',
      }}
    >
      <Series>
        <Series.Sequence durationInFrames={s1}>
          <Scene1OpenExtensions />
        </Series.Sequence>
        <Series.Sequence durationInFrames={s2}>
          <Scene2DeveloperMode />
        </Series.Sequence>
        <Series.Sequence durationInFrames={VIDEO_CONFIG.sceneTimings.scene3DurationFrames}>
          <Scene3DragFolder />
        </Series.Sequence>
      </Series>

      <StepProgressBar activeStep={activeStep} />
    </div>
  );
};
