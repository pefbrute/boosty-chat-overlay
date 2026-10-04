'use strict';

/**
 * Pure Layout & Positioning Utilities for Boosty Chat Overlay.
 *
 * Provides bidirectional translation between logical canvas coordinates
 * (1920x1080 default stream canvas) and production overlay configuration
 * (horizontalAnchor, verticalAnchor, offsetX, offsetY).
 *
 * Invariant: preview and OBS overlay share identical positioning semantics.
 */

const LOGICAL_WIDTH = 1920;
const LOGICAL_HEIGHT = 1080;
const DEFAULT_SCENE = Object.freeze({ width: LOGICAL_WIDTH, height: LOGICAL_HEIGHT });

const SNAP_CENTER_THRESHOLD = 12; // logical px for center line snap
const EDGE_SNAP_OFFSETS = Object.freeze([16, 20, 24, 32, 40]);
const EDGE_SNAP_THRESHOLD = 8; // logical px for edge offset snap

/**
 * Calculates top-left logical coordinates and bounding box from overlay config.
 *
 * @param {object} config - { horizontalAnchor, verticalAnchor, offsetX, offsetY }
 * @param {object} boxSize - { width, height } of the rendered chat stack
 * @param {object} [scene=DEFAULT_SCENE] - { width, height }
 * @returns {object} { x, y, left, top, right, bottom, width, height }
 */
function positionFromConfig(config, boxSize, scene = DEFAULT_SCENE) {
  const sceneWidth = Number(scene?.width) || LOGICAL_WIDTH;
  const sceneHeight = Number(scene?.height) || LOGICAL_HEIGHT;
  const boxWidth = Math.max(0, Number(boxSize?.width) || 0);
  const boxHeight = Math.max(0, Number(boxSize?.height) || 0);
  const offsetX = Math.max(0, Number(config?.offsetX) || 0);
  const offsetY = Math.max(0, Number(config?.offsetY) || 0);
  const hAnchor = config?.horizontalAnchor === 'right' ? 'right' : 'left';
  const vAnchor = config?.verticalAnchor === 'top' ? 'top' : 'bottom';

  let left = 0;
  if (hAnchor === 'right') {
    left = sceneWidth - (offsetX + boxWidth);
  } else {
    left = offsetX;
  }

  let top = 0;
  if (vAnchor === 'bottom') {
    top = sceneHeight - (offsetY + boxHeight);
  } else {
    top = offsetY;
  }

  return {
    x: left,
    y: top,
    left,
    top,
    width: boxWidth,
    height: boxHeight,
    right: left + boxWidth,
    bottom: top + boxHeight,
  };
}

/**
 * Clamps logical position box so the entire chat stack remains inside the scene.
 *
 * @param {object} pos - { left|x, top|y, width, height }
 * @param {object} [scene=DEFAULT_SCENE] - { width, height }
 * @returns {object} Clamped position object
 */
function clampPosition(pos, scene = DEFAULT_SCENE) {
  const sceneWidth = Number(scene?.width) || LOGICAL_WIDTH;
  const sceneHeight = Number(scene?.height) || LOGICAL_HEIGHT;
  const w = Math.max(0, Math.min(sceneWidth, Number(pos?.width) || 0));
  const h = Math.max(0, Math.min(sceneHeight, Number(pos?.height) || 0));

  const maxLeft = Math.max(0, sceneWidth - w);
  const maxTop = Math.max(0, sceneHeight - h);

  const rawLeft = Number(pos?.left ?? pos?.x) || 0;
  const rawTop = Number(pos?.top ?? pos?.y) || 0;

  const left = Math.max(0, Math.min(maxLeft, rawLeft));
  const top = Math.max(0, Math.min(maxTop, rawTop));

  return {
    x: left,
    y: top,
    left,
    top,
    width: w,
    height: h,
    right: left + w,
    bottom: top + h,
  };
}

/**
 * Determines anchor quadrants from the geometric center of the chat block.
 *
 * @param {object} box - { left|x, top|y, width, height }
 * @param {object} [scene=DEFAULT_SCENE] - { width, height }
 * @returns {object} { horizontalAnchor, verticalAnchor, centerX, centerY }
 */
function getAnchorFromCenter(box, scene = DEFAULT_SCENE) {
  const sceneWidth = Number(scene?.width) || LOGICAL_WIDTH;
  const sceneHeight = Number(scene?.height) || LOGICAL_HEIGHT;
  const left = Number(box?.left ?? box?.x) || 0;
  const top = Number(box?.top ?? box?.y) || 0;
  const w = Number(box?.width) || 0;
  const h = Number(box?.height) || 0;

  const centerX = left + (w / 2);
  const centerY = top + (h / 2);

  const horizontalAnchor = centerX < (sceneWidth / 2) ? 'left' : 'right';
  const verticalAnchor = centerY < (sceneHeight / 2) ? 'top' : 'bottom';

  return {
    horizontalAnchor,
    verticalAnchor,
    centerX,
    centerY,
  };
}

/**
 * Evaluates soft snapping against scene center lines and standard corner edge offsets.
 *
 * @param {object} box - { left|x, top|y, width, height }
 * @param {object} [scene=DEFAULT_SCENE] - { width, height }
 * @param {object} [options] - Optional custom thresholds
 * @returns {object} { position, guides }
 */
function snapPosition(box, scene = DEFAULT_SCENE, options = {}) {
  const sceneWidth = Number(scene?.width) || LOGICAL_WIDTH;
  const sceneHeight = Number(scene?.height) || LOGICAL_HEIGHT;
  const centerThreshold = options.centerThreshold ?? SNAP_CENTER_THRESHOLD;
  const edgeThreshold = options.edgeThreshold ?? EDGE_SNAP_THRESHOLD;
  const edgeOffsets = options.edgeOffsets ?? EDGE_SNAP_OFFSETS;

  let left = Number(box?.left ?? box?.x) || 0;
  let top = Number(box?.top ?? box?.y) || 0;
  const w = Number(box?.width) || 0;
  const h = Number(box?.height) || 0;

  const guides = {
    snapCenterX: false,
    snapCenterY: false,
    snapLeft: false,
    snapRight: false,
    snapTop: false,
    snapBottom: false,
  };

  // Center X snap (vertical center guide)
  const centerX = left + (w / 2);
  if (Math.abs(centerX - (sceneWidth / 2)) <= centerThreshold) {
    left = (sceneWidth / 2) - (w / 2);
    guides.snapCenterX = true;
  }

  // Center Y snap (horizontal center guide)
  const centerY = top + (h / 2);
  if (Math.abs(centerY - (sceneHeight / 2)) <= centerThreshold) {
    top = (sceneHeight / 2) - (h / 2);
    guides.snapCenterY = true;
  }

  // Edge snaps when not snapped to center
  if (!guides.snapCenterX) {
    let closestOffset = null;
    let minDiff = edgeThreshold + 1;
    let isLeft = true;

    for (const offset of edgeOffsets) {
      const leftDiff = Math.abs(left - offset);
      if (leftDiff <= edgeThreshold && leftDiff < minDiff) {
        minDiff = leftDiff;
        closestOffset = offset;
        isLeft = true;
      }
      const rightDist = sceneWidth - (left + w);
      const rightDiff = Math.abs(rightDist - offset);
      if (rightDiff <= edgeThreshold && rightDiff < minDiff) {
        minDiff = rightDiff;
        closestOffset = offset;
        isLeft = false;
      }
    }

    if (closestOffset !== null) {
      if (isLeft) {
        left = closestOffset;
        guides.snapLeft = true;
      } else {
        left = sceneWidth - w - closestOffset;
        guides.snapRight = true;
      }
    }
  }

  if (!guides.snapCenterY) {
    let closestOffset = null;
    let minDiff = edgeThreshold + 1;
    let isTop = true;

    for (const offset of edgeOffsets) {
      const topDiff = Math.abs(top - offset);
      if (topDiff <= edgeThreshold && topDiff < minDiff) {
        minDiff = topDiff;
        closestOffset = offset;
        isTop = true;
      }
      const bottomDist = sceneHeight - (top + h);
      const bottomDiff = Math.abs(bottomDist - offset);
      if (bottomDiff <= edgeThreshold && bottomDiff < minDiff) {
        minDiff = bottomDiff;
        closestOffset = offset;
        isTop = false;
      }
    }

    if (closestOffset !== null) {
      if (isTop) {
        top = closestOffset;
        guides.snapTop = true;
      } else {
        top = sceneHeight - h - closestOffset;
        guides.snapBottom = true;
      }
    }
  }

  return {
    position: {
      x: left,
      y: top,
      left,
      top,
      width: w,
      height: h,
      right: left + w,
      bottom: top + h,
    },
    guides,
  };
}

/**
 * Translates a logical box position into overlay config { horizontalAnchor, verticalAnchor, offsetX, offsetY }.
 * Ensures continuous, jump-free coordinates when crossing anchor thresholds.
 *
 * @param {object} box - { left|x, top|y, width, height }
 * @param {object} [scene=DEFAULT_SCENE] - { width, height }
 * @param {object} [options] - { clamp: boolean }
 * @returns {object} { horizontalAnchor, verticalAnchor, offsetX, offsetY }
 */
function configFromPosition(box, scene = DEFAULT_SCENE, options = {}) {
  const sceneWidth = Number(scene?.width) || LOGICAL_WIDTH;
  const sceneHeight = Number(scene?.height) || LOGICAL_HEIGHT;

  const pos = options.clamp === false ? box : clampPosition(box, scene);
  const { horizontalAnchor, verticalAnchor } = getAnchorFromCenter(pos, scene);

  let offsetX = 0;
  if (horizontalAnchor === 'left') {
    offsetX = Math.round(pos.left);
  } else {
    offsetX = Math.round(sceneWidth - pos.right);
  }

  let offsetY = 0;
  if (verticalAnchor === 'top') {
    offsetY = Math.round(pos.top);
  } else {
    offsetY = Math.round(sceneHeight - pos.bottom);
  }

  return {
    horizontalAnchor,
    verticalAnchor,
    offsetX: Math.max(0, offsetX),
    offsetY: Math.max(0, offsetY),
  };
}

/**
 * Converts screen/pointer event coordinates relative to a scaled preview element
 * into logical 1920x1080 scene coordinates. Scale-invariant.
 *
 * @param {number} screenX - event.clientX
 * @param {number} screenY - event.clientY
 * @param {object} previewRect - getBoundingClientRect() of scaled preview canvas
 * @param {object} [scene=DEFAULT_SCENE] - { width, height }
 * @returns {object} { logicalX, logicalY, scale }
 */
function scalePreviewCoordinates(screenX, screenY, previewRect, scene = DEFAULT_SCENE) {
  const sceneWidth = Number(scene?.width) || LOGICAL_WIDTH;
  const sceneHeight = Number(scene?.height) || LOGICAL_HEIGHT;
  const scale = Math.min(previewRect.width / sceneWidth, previewRect.height / sceneHeight) || 1;

  const logicalX = (screenX - previewRect.left) / scale;
  const logicalY = (screenY - previewRect.top) / scale;

  return {
    logicalX,
    logicalY,
    scale,
  };
}

const BoostyPositioning = {
  LOGICAL_WIDTH,
  LOGICAL_HEIGHT,
  DEFAULT_SCENE,
  SNAP_CENTER_THRESHOLD,
  EDGE_SNAP_OFFSETS,
  EDGE_SNAP_THRESHOLD,
  positionFromConfig,
  clampPosition,
  getAnchorFromCenter,
  snapPosition,
  configFromPosition,
  scalePreviewCoordinates,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BoostyPositioning;
}

if (typeof globalThis !== 'undefined') {
  globalThis.BoostyPositioning = BoostyPositioning;
}
