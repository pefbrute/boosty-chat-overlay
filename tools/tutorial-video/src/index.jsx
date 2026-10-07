// tools/tutorial-video/src/index.jsx
import React from 'react';
import { Composition, Still, registerRoot } from 'remotion';
import { ExtensionInstallYandex } from './ExtensionInstallYandex';
import { ExtensionInstallPoster } from './ExtensionInstallPoster';
import { VIDEO_CONFIG } from './config';

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="ExtensionInstallYandex"
        component={ExtensionInstallYandex}
        durationInFrames={VIDEO_CONFIG.totalDurationFrames}
        fps={VIDEO_CONFIG.fps}
        width={VIDEO_CONFIG.width}
        height={VIDEO_CONFIG.height}
      />
      <Still
        id="ExtensionInstallPoster"
        component={ExtensionInstallPoster}
        width={VIDEO_CONFIG.width}
        height={VIDEO_CONFIG.height}
      />
    </>
  );
};

registerRoot(RemotionRoot);
