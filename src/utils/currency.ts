
/**
 * Formats a numerical amount into an Indian Rupee string (e.g. ₹1,14,900 or ₹89,990)
 * adhering to the Serene vault visual specifications.
 */
export function formatCurrency(
  amount: number | string,
  currencySymbol: string = '₹'
): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return `${currencySymbol}0`;

  const formatted = num.toLocaleString('en-IN', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });

  return `${currencySymbol}${formatted}`;
}

/**
 * Formats large figures compactly (e.g. ₹3.42L) for summary badges and chips.
 */
export function formatCompactCurrency(
  amount: number | string,
  currencySymbol: string = '₹'
): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return `${currencySymbol}0`;

  if (num >= 10000000) {
    const crores = (num / 10000000).toFixed(2).replace(/\.00$/, '');
    return `${currencySymbol}${crores}Cr`;
  }
  if (num >= 100000) {
    const lakhs = (num / 100000).toFixed(2).replace(/\.00$/, '');
    return `${currencySymbol}${lakhs}L`;
  }
  if (num >= 1000) {
    const thousands = (num / 1000).toFixed(1).replace(/\.0$/, '');
    return `${currencySymbol}${thousands}K`;
  }

  return formatCurrency(num, currencySymbol);
}

/**
 * Safely parses multiple date string representations:
 * - DD/MM/YYYY or DD-MM-YYYY (standard Indian formats)
 * - YYYY-MM-DD or YYYY/MM/DD (ISO date formats)
 * - Full ISO timestamps (e.g. 2026-09-20T10:00:00.000Z)
 */
export function parseFlexibleDate(dateStr?: string | null): Date | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  // 1. Match DD/MM/YYYY or DD-MM-YYYY
  const ddmmyyyy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/;
  const matchDmy = trimmed.match(ddmmyyyy);
  if (matchDmy) {
    const day = parseInt(matchDmy[1], 10);
    const month = parseInt(matchDmy[2], 10) - 1;
    const year = parseInt(matchDmy[3], 10);
    const d = new Date(year, month, day, 0, 0, 0, 0);
    if (!isNaN(d.getTime())) return d;
  }

  const yyyymmdd = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/;
  const matchYmd = trimmed.match(yyyymmdd);
  if (matchYmd) {
    const year = parseInt(matchYmd[1], 10);
    const month = parseInt(matchYmd[2], 10) - 1;
    const day = parseInt(matchYmd[3], 10);
    const d = new Date(year, month, day, 0, 0, 0, 0);
    if (!isNaN(d.getTime())) return d;
  }

  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) return parsed;

  return null;
}

/**
 * Formats a date string (ISO YYYY-MM-DD or DD/MM/YYYY) into human-readable Serene style.
 * Always includes the 4-digit YEAR across all styles (e.g. "14 Apr 2026", "15 Sep 2026").
 */
export function formatDate(
  dateStr?: string | Date | null,
  style: 'short' | 'medium' | 'full' = 'medium'
): string {
  if (!dateStr) return '';
  const date = dateStr instanceof Date ? dateStr : parseFlexibleDate(dateStr);
  if (!date || isNaN(date.getTime())) {
    return typeof dateStr === 'string' ? dateStr : '';
  }

  const day = date.getDate();
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const fullMonths = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const year = date.getFullYear();

  if (style === 'full') {
    return `${day} ${fullMonths[date.getMonth()]} ${year}`;
  }

  return `${day} ${months[date.getMonth()]} ${year}`;
}

