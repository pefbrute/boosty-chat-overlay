// tools/tutorial-video/src/scenes/Scene3DragFolder.jsx
import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';
import { BrowserFrame } from '../components/BrowserFrame';
import { FileManagerWindow } from '../components/FileManagerWindow';
import { FolderCard } from '../components/FolderCard';
import { StepBadge } from '../components/StepBadge';
import { Cursor } from '../components/Cursor';
import { RU_COPY } from '../copy/ru';

export const Scene3DragFolder = () => {
  const frame = useCurrentFrame();

  // Timing breakdown (210 frames = 7.0 seconds total at 30 fps):
  // 1. Frames 0-35 (0.0-1.16s): Windows are visible. Cursor moves to folder in file manager
  // 2. Frames 35-48 (1.16-1.6s): Cursor presses down, grabs folder. Folder lifts with shadow
  // 3. Frames 48-110 (1.6-3.66s): Continuous, smooth drag across to browser window
  // 4. Frames 75-115: Drop zone activates in browser
  // 5. Frames 110-125 (3.66-4.16s): Drop folder (mouse-up). Folder fades into drop zone
  // 6. Frames 122-150 (4.06-5.0s): Boosty extension card appears in browser
  // 7. Frames 145-210 (4.83-7.0s): Step badge turns into green "✓ Готово"

  // Fixed source and target coordinates
  // Folder center in file manager: x=240, y=395
  // Drop target center in browser: x=840, y=385
  const sourceX = 240;
  const sourceY = 395;
  const targetX = 840;
  const targetY = 385;

  // Phases
  const isHoveringFolder = frame >= 28 && frame < 35;
  const isMouseDown = frame >= 35 && frame < 112;
  const isDragging = frame >= 48 && frame < 112;
  const isDropped = frame >= 112;
  const showDropZone = frame >= 75 && frame < 118;
  const hasBoostyInstalled = frame >= 122;
  const isComplete = frame >= 145;

  // Cursor coordinates
  let cursorX = sourceX;
  let cursorY = sourceY;

  if (frame < 35) {
    // Moving towards folder in file manager
    const p = interpolate(frame, [0, 32], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    // Cubic ease-out
    const eased = 1 - Math.pow(1 - p, 3);
    cursorX = interpolate(eased, [0, 1], [520, sourceX]);
    cursorY = interpolate(eased, [0, 1], [220, sourceY]);
  } else if (frame < 48) {
    // Holding / pressing down on folder before dragging
    cursorX = sourceX;
    cursorY = sourceY;
  } else if (frame < 112) {
    // Continuous drag across windows: frames 48 to 110 (~2 seconds)
    const p = interpolate(frame, [48, 110], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    // Smooth S-curve (cubic ease-in-out)
    const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    cursorX = interpolate(eased, [0, 1], [sourceX, targetX]);
    cursorY = interpolate(eased, [0, 1], [sourceY, targetY]);
  } else {
    // Post-drop cursor moves slightly away to reveal the newly installed card
    cursorX = interpolate(frame, [112, 135], [targetX, targetX + 110], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    cursorY = interpolate(frame, [112, 135], [targetY, targetY + 60], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  }

  // Draggable folder card position (anchored to cursor when dragged)
  const folderX = cursorX - 55;
  const folderY = cursorY - 45;

  // Folder appearance transitions
  const folderScale = isMouseDown ? (isDragging ? 1.08 : 1.04) : 1.0;
  const folderOpacity = interpolate(frame, [110, 120], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

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
        stepNumber={3}
        title={isComplete ? RU_COPY.step3.complete : RU_COPY.step3.title}
        subtitle={
          isComplete
            ? '✓ Расширение установлено — Boosty Chat Overlay'
            : 'boosty-chat-overlay/ → папка extension'
        }
        isComplete={isComplete}
      />

      {/* Main Workspace: File Manager (Left) + Browser (Right) */}
      <div
        style={{
          width: 1180,
          display: 'flex',
          gap: 20,
          marginTop: 44,
          alignItems: 'flex-start',
        }}
      >
        {/* 1. Neutral File Manager Window (Source) */}
        <div style={{ flex: '0 0 380px' }}>
          <FileManagerWindow
            width={380}
            height={490}
            showOriginalFolder={!isMouseDown}
            isFolderSelected={isMouseDown}
            folderScale={isHoveringFolder ? 1.04 : 1.0}
            onFolderHover={isHoveringFolder}
          />
        </div>

        {/* 2. Browser Window with Extensions Page & Dev Mode ON (Destination) */}
        <div style={{ flex: '1 1 auto', overflow: 'hidden', borderRadius: 14 }}>
          <div style={{ transform: 'scale(0.88)', transformOrigin: 'top left', width: 900, height: 556 }}>
            <BrowserFrame
              devModeChecked={true}
              showDropZone={showDropZone}
              hasBoostyInstalled={hasBoostyInstalled}
              pageLoaded={true}
              addressText="browser://extensions"
              scale={1}
            />
          </div>
        </div>
      </div>

      {/* Floating draggable FolderCard during MouseDown & Drag */}
      {isMouseDown && !isDropped && (
        <FolderCard
          x={folderX}
          y={folderY}
          isDragging={isDragging}
          scale={folderScale}
          opacity={folderOpacity}
        />
      )}

      {/* Cursor */}
      <Cursor
        x={cursorX}
        y={cursorY}
        clicking={isMouseDown && !isDragging}
        grabbing={isMouseDown}
      />
    </div>
  );
};
