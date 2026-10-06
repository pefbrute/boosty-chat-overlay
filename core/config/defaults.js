/**
 * Default Overlay Configuration values.
 */

const defaultConfig = {
  durationSeconds: 20,
  maxMessages: 6,
  fontSize: 21,
  authorFontSize: 16,
  cardWidth: 520,
  borderRadius: 10,
  cardPadding: 10,
  messageGap: 10,
  avatarSize: 42,
  backdropBlur: 0,
  backgroundOpacity: 88,
  accentColor: '#f15f2c',
  textColor: '#ffffff',
  backgroundColor: '#121216',
  showAvatars: true,
  shadow: true,
  horizontalAnchor: 'left',
  verticalAnchor: 'bottom',
  newMessagePosition: 'bottom',
  offsetX: 20,
  offsetY: 20,
  textAlign: 'left',
  maxStackHeight: 800,
  animationType: 'fade',
  animationDurationMs: 280,
  obsHost: '127.0.0.1',
  obsPort: 4455,
  obsPassword: '',
};

module.exports = {
  defaultConfig,
};
