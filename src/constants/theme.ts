
export const SereneColors = {
  surface: '#FCF9F1', // Warm sand foundation
  surfaceContainerLowest: '#FFFFFF', // Elevated cards & modals
  surfaceContainerLow: '#F6F3EB', // Micro container rows & input backgrounds
  surfaceContainer: '#F1EEE6', // Subdued panels
  surfaceContainerHigh: '#EBE8E0', // Segmented controls & pills
  surfaceContainerHighest: '#E5E2DA', // Inactive chips & borders

  primary: '#115086',
  primaryContainer: '#3368A0',
  onPrimary: '#FFFFFF',
  onPrimaryContainer: '#D5E5FF',
  primaryFixed: '#D2E4FF',
  primaryFixedDim: '#A0C9FF',
  onPrimaryFixed: '#001C37',

  secondary: '#22657F',
  secondaryContainer: '#A2E0FE',
  onSecondary: '#FFFFFF',
  onSecondaryContainer: '#20647E',
  secondaryFixed: '#BEE9FF',
  secondaryFixedDim: '#92CFEC',

  tertiary: '#3D524F',
  tertiaryContainer: '#556A67',
  tertiaryFixed: '#D0E7E3',
  tertiaryFixedDim: '#B4CBC7',
  onTertiaryFixed: '#0A1F1D',
  onTertiary: '#FFFFFF',

  onSurface: '#1C1C17', // High-contrast Deep Charcoal
  onSurfaceVariant: '#42474F', // Medium-contrast Slate Gray
  outline: '#727781',
  outlineVariant: '#C2C7D1',
  hairlineBorder: 'rgba(51, 104, 160, 0.08)',
  subtleBorder: '#E3DFD5',

  error: '#BA1A1A',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#93000A',
  onError: '#FFFFFF',

  success: '#10B981',
  successContainer: '#D1FAE5',
  warning: '#F59E0B',
  warningContainer: '#FEF3C7',
} as const;

export const SereneTypography = {
  fontFamily: {
    heading: 'PlusJakartaSans-SemiBold',
    headingBold: 'PlusJakartaSans-Bold',
    body: 'PlusJakartaSans-Regular',
    bodyMedium: 'PlusJakartaSans-Medium',
    mono: 'Courier',
  },
  fontSize: {
    displayLg: 36,
    headlineLg: 26,
    headlineMd: 22,
    headlineSm: 18,
    bodyLg: 16,
    bodyMd: 14,
    bodySm: 12,
    labelLg: 14,
    labelMd: 12,
    labelSm: 11,
  },
} as const;

export const SereneSpacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
} as const;

export const SereneRadius = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
  full: 9999,
} as const;
