
export const ROUTES = {
  home: '/(tabs)',
  items: '/(tabs)/items',
  documents: '/(tabs)/documents',
  addItem: '/(tabs)/add',
  more: '/(tabs)/more',

  itemDetail: (id: string) => `/item/${id}`,
  documentDetail: (id: string) => `/document/${id}`,
  addDocument: '/document/add',
  scanReceipt: '/scan-receipt',

  login: '/auth/login',
  signup: '/auth/signup',
  forgotPassword: '/auth/forgot-password',
  resetPassword: '/auth/reset-password',
} as const;
