import { Dimensions, PixelRatio, Platform } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Baseline guideline size (based on standard modern iPhone / Android 375 x 812)
const guidelineBaseWidth = 375;
const guidelineBaseHeight = 812;

export const scale = (size) => (SCREEN_WIDTH / guidelineBaseWidth) * size;
export const verticalScale = (size) => (SCREEN_HEIGHT / guidelineBaseHeight) * size;
export const moderateScale = (size, factor = 0.5) => size + (scale(size) - size) * factor;

export const isSmallDevice = SCREEN_WIDTH < 375;
export const isTablet = SCREEN_WIDTH >= 768;

export const colors = {
  // Brand Primary
  primary: '#2563EB',
  primaryDark: '#1D4ED8',
  primaryLight: '#EFF6FF',
  primaryBorder: '#BFDBFE',
  primaryMuted: '#93C5FD',
  accent: '#3B82F6',

  // Surfaces & Backgrounds
  background: '#F8FAFC',
  backgroundElevated: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceSubtle: '#F1F5F9',
  surfaceHighlight: '#F8FAFC',
  surfaceMuted: '#E2E8F0',

  // Borders & Dividers
  border: '#E2E8F0',
  borderDark: '#CBD5E1',
  borderLight: '#F1F5F9',
  borderFocus: '#2563EB',

  // Typography
  text: '#0F172A',
  textSecondary: '#334155',
  textMuted: '#64748B',
  textLight: '#94A3B8',
  textInverse: '#FFFFFF',

  // Semantic Status Colors
  success: '#10B981',
  successDark: '#059669',
  successLight: '#ECFDF5',
  successBorder: '#A7F3D0',
  successText: '#065F46',

  warning: '#F59E0B',
  warningDark: '#D97706',
  warningLight: '#FFFBEB',
  warningBorder: '#FDE68A',
  warningText: '#92400E',

  danger: '#EF4444',
  dangerDark: '#DC2626',
  dangerLight: '#FEF2F2',
  dangerBorder: '#FECACA',
  dangerText: '#991B1B',

  info: '#0EA5E9',
  infoDark: '#0284C7',
  infoLight: '#F0F9FF',
  infoBorder: '#BAE6FD',
  infoText: '#075985',

  purple: '#8B5CF6',
  purpleLight: '#F5F3FF',
  purpleText: '#6D28D9',

  // Dark Accents (Executive Card)
  navyDark: '#0B132B',
  navyCard: '#1C2541',
  navyCardBorder: '#3A506B',
};

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 20,
  xl: 28,
  xxl: 36,
};

export const borderRadius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};

export const typography = {
  xs: 11,
  sm: 13,
  base: 15,
  md: 16,
  lg: 18,
  xl: 20,
  xxl: 24,
  display: 28,
};

export const shadows = {
  none: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  sm: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
  },
  primaryGlow: {
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
};
