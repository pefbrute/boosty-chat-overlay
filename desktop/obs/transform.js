/**
 * OBS Overlay Transform & Canvas Normalization Module.
 *
 * Provides pure functions to construct and validate canonical 1:1 transforms
 * ensuring the Browser Source internal viewport matches the OBS base canvas
 * and scene items render without distorting hardware scaling.
 */

/**
 * Builds the canonical OBS SceneItem transform for the Boosty Chat Overlay.
 *
 * @param {object} [options]
 * @param {number} [options.baseWidth=1920] Base canvas width
 * @param {number} [options.baseHeight=1080] Base canvas height
 * @returns {object} Canonical SceneItem transform parameters for SetSceneItemTransform
 */
function buildCanonicalOverlayTransform({ baseWidth = 1920, baseHeight = 1080 } = {}) {
  return {
    positionX: 0,
    positionY: 0,
    scaleX: 1.0,
    scaleY: 1.0,
    rotation: 0,
    alignment: 5, // Top-Left (OBS bitmask: 1 (top) | 4 (left) = 5)
    boundsType: 'OBS_BOUNDS_NONE',
    boundsWidth: 0,
    boundsHeight: 0,
    boundsAlignment: 0,
    cropTop: 0,
    cropBottom: 0,
    cropLeft: 0,
    cropRight: 0,
    cropToBounds: false,
  };
}

/**
 * Validates whether an OBS Browser Source and its scene item transform
 * match the canonical full-canvas 1:1 model.
 *
 * @param {object} transform OBS SceneItemTransform object
 * @param {object} inputSettings OBS Browser Source InputSettings object
 * @param {object} videoSettings OBS VideoSettings object (with baseWidth, baseHeight)
 * @returns {{ canonical: boolean, reason?: string, details: object }}
 */
function isObsOverlayTransformCanonical(transform, inputSettings, videoSettings) {
  if (!videoSettings || !videoSettings.baseWidth || !videoSettings.baseHeight) {
    return {
      canonical: false,
      reason: 'missing_video_settings',
      details: { transform, inputSettings, videoSettings },
    };
  }

  const baseW = Number(videoSettings.baseWidth);
  const baseH = Number(videoSettings.baseHeight);

  if (!inputSettings) {
    return {
      canonical: false,
      reason: 'missing_input_settings',
      details: { baseW, baseH },
    };
  }

  const inputW = Number(inputSettings.width);
  const inputH = Number(inputSettings.height);

  const hasViewportMismatch = inputW !== baseW || inputH !== baseH;

  if (!transform) {
    return {
      canonical: !hasViewportMismatch,
      reason: hasViewportMismatch ? 'viewport_mismatch' : undefined,
      details: { baseW, baseH, inputW, inputH },
    };
  }

  const scaleX = Number(transform.scaleX ?? 1.0);
  const scaleY = Number(transform.scaleY ?? 1.0);
  const posX = Number(transform.positionX ?? 0);
  const posY = Number(transform.positionY ?? 0);
  const rotation = Number(transform.rotation ?? 0);

  const cropTop = Number(transform.cropTop ?? 0);
  const cropBottom = Number(transform.cropBottom ?? 0);
  const cropLeft = Number(transform.cropLeft ?? 0);
  const cropRight = Number(transform.cropRight ?? 0);

  const boundsType = transform.boundsType;

  const details = {
    baseW,
    baseH,
    inputW,
    inputH,
    scaleX,
    scaleY,
    posX,
    posY,
    rotation,
    hasCrop: cropTop > 0 || cropBottom > 0 || cropLeft > 0 || cropRight > 0,
    boundsType,
  };

  if (hasViewportMismatch) {
    return {
      canonical: false,
      reason: 'viewport_mismatch',
      details,
    };
  }

  // Float tolerance for OBS transform scaling
  if (Math.abs(scaleX - 1.0) > 0.005 || Math.abs(scaleY - 1.0) > 0.005) {
    return {
      canonical: false,
      reason: 'scale_mismatch',
      details,
    };
  }

  if (Math.abs(posX) > 1.0 || Math.abs(posY) > 1.0) {
    return {
      canonical: false,
      reason: 'position_offset',
      details,
    };
  }

  if (Math.abs(rotation) > 0.01) {
    return {
      canonical: false,
      reason: 'rotation_detected',
      details,
    };
  }

  if (details.hasCrop) {
    return {
      canonical: false,
      reason: 'crop_detected',
      details,
    };
  }

  if (boundsType && boundsType !== 'OBS_BOUNDS_NONE') {
    return {
      canonical: false,
      reason: 'bounds_type_mismatch',
      details,
    };
  }

  return {
    canonical: true,
    details,
  };
}

module.exports = {
  buildCanonicalOverlayTransform,
  isObsOverlayTransformCanonical,
};
