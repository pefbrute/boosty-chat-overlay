// tools/tutorial-video/src/config.js
'use strict';

export const VIDEO_CONFIG = {
  fps: 30,
  width: 1280,
  height: 720,
  sceneTimings: {
    scene1DurationFrames: 75,  // 2.5s: Click address bar, typewriter 'browser://extensions', Enter, open page
    scene2DurationFrames: 75,  // 2.5s: Accurate move to Dev Mode toggle, click on toggle, switch ON, show toolbar
    scene3DurationFrames: 210, // 7.0s: File manager window -> grab folder -> continuous drag -> drop zone -> ready
  },
  get totalDurationFrames() {
    return (
      this.sceneTimings.scene1DurationFrames +
      this.sceneTimings.scene2DurationFrames +
      this.sceneTimings.scene3DurationFrames
    );
  },
  // Precise visual coordinates for targets
  coordinates: {
    // Scene 1: Address bar input center
    addressBarClick: { x: 440, y: 130 },
    // Scene 2: Dev Mode toggle switch exact center
    // Bounding box of the toggle switch inside the composition
    toggleTarget: {
      x: 1086,
      y: 130,
      width: 44,
      height: 26,
    },
    // Scene 3: File manager folder source and drop target
    fileManager: {
      x: 70,
      y: 150,
      width: 380,
      height: 440,
    },
    folderSource: {
      x: 210,
      y: 310,
    },
    browserDropTarget: {
      x: 820,
      y: 370,
    },
  },
  theme: {
    bg: '#0f172a',
    cardBg: '#1e293b',
    accentBlue: '#0077ff',
    accentRed: '#fc3f1d',
    brandYellow: '#ffcc00',
    successGreen: '#22c55e',
    textMain: '#ffffff',
    textMuted: '#94a3b8',
  },
};

