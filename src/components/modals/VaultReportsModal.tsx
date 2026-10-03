
import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SereneColors } from '../../constants/theme';
import { useItemStore } from '../../store/itemStore';
import { useAuthStore } from '../../store/authStore';
import {
  generateCSV,
  generatePDFBytes,
  writeAndShareFile,
  filterByDateRange,
  parseFlexibleDate,
} from '../../lib/reportGenerator';
import { Item } from '../../types';


type ExportScope = 'all' | 'range';
type GenerationState = 'idle' | 'generating' | 'ready' | 'error';
type ExportFormat = 'pdf' | 'csv' | null;

interface Props {
  visible: boolean;
  onClose: () => void;
}


/** Returns a date as a YYYY-MM-DD string. */
function toIsoDateString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Returns today's date as a YYYY-MM-DD string. */
function today(): string {
  return toIsoDateString(new Date());
}

/** Returns a date 1 year ago as YYYY-MM-DD. */
function oneYearAgo(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return toIsoDateString(d);
}

function isDateInputValid(dateStr: string): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const d = parseFlexibleDate(dateStr);
  return d !== null && !isNaN(d.getTime());
}

function getExportFilename(format: 'pdf' | 'csv', scope: ExportScope, fromStr?: string, toStr?: string): string {
  if (scope === 'all') {
    return `Keepr_Vault_Report_All.${format}`;
  }
  const fromDate = parseFlexibleDate(fromStr);
  const toDate = parseFlexibleDate(toStr);
  const fromIso = fromDate ? toIsoDateString(fromDate) : 'start';
  const toIso = toDate ? toIsoDateString(toDate) : 'end';
  return `Keepr_Vault_Report_${fromIso}_to_${toIso}.${format}`;
}


export function VaultReportsModal({ visible, onClose }: Props) {
  const items = useItemStore((s) => s.items);
  const user = useAuthStore((s) => s.user);

  const [scope, setScope] = useState<ExportScope>('all');
  const [dateFrom, setDateFrom] = useState<string>(oneYearAgo());
  const [dateTo, setDateTo] = useState<string>(today());
  const [genState, setGenState] = useState<GenerationState>('idle');
  const [currentFormat, setCurrentFormat] = useState<ExportFormat>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const canonicalUserItems = useMemo((): Item[] => {
    const currentUserId = user?.id;
    return (items || []).filter((item) => {
      if (!item || !item.id || (item.status as string) === 'deleted' || (item.status as string) === 'disposed') {
        return false;
      }
      if (currentUserId && item.userId && item.userId !== currentUserId) {
        return false;
      }
      return true;
    });
  }, [items, user?.id]);

  const rangeIsValid = useCallback((): boolean => {
    if (scope !== 'range') return true;
    if (!isDateInputValid(dateFrom) || !isDateInputValid(dateTo)) return false;
    const fromDate = parseFlexibleDate(dateFrom)!;
    const toDate = parseFlexibleDate(dateTo)!;
    return fromDate.getTime() <= toDate.getTime();
  }, [scope, dateFrom, dateTo]);

  const getExportItems = useCallback(() => {
    if (scope === 'all') return canonicalUserItems;
    return filterByDateRange(canonicalUserItems, dateFrom, dateTo);
  }, [scope, canonicalUserItems, dateFrom, dateTo]);

  const handleClose = useCallback(() => {
    if (genState === 'generating') return; // Prevent closing mid-export
    setGenState('idle');
    setCurrentFormat(null);
    setErrorMsg('');
    onClose();
  }, [genState, onClose]);

  const handleRetry = useCallback(() => {
    setGenState('idle');
    setCurrentFormat(null);
    setErrorMsg('');
  }, []);

  const handleExportPDF = useCallback(async () => {
    if (genState === 'generating') return;

    if (!rangeIsValid()) {
      setErrorMsg('Please enter a valid date range. "From" must be on or before "To".');
      setGenState('error');
      return;
    }

    const exportItems = getExportItems();
    if (exportItems.length === 0) {
      if (scope === 'range') {
        Alert.alert(
          'No Purchases Found',
          'No purchases found for this date range.',
          [
            { text: 'Change Date Range', style: 'default' },
            { text: 'Cancel', style: 'cancel', onPress: handleClose },
          ]
        );
      } else {
        Alert.alert('Nothing to Export', 'No purchases in your Vault yet.');
      }
      return;
    }

    setGenState('generating');
    setCurrentFormat('pdf');
    setErrorMsg('');

    try {
      const pdfBytes = generatePDFBytes(
        exportItems,
        scope === 'range' ? dateFrom : null,
        scope === 'range' ? dateTo : null
      );

      const filename = getExportFilename('pdf', scope, dateFrom, dateTo);
      await writeAndShareFile(pdfBytes, filename, 'application/pdf');
      setGenState('ready');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('Sharing is not available') || msg.includes('shared')) {
        setErrorMsg("Report created, but it couldn't be shared. You can try again.");
      } else {
        setErrorMsg("Couldn't create the PDF. Please try again.");
      }
      setGenState('error');
    }
  }, [genState, scope, dateFrom, dateTo, getExportItems, rangeIsValid, handleClose]);

  const handleExportCSV = useCallback(async () => {
    if (genState === 'generating') return;

    if (!rangeIsValid()) {
      setErrorMsg('Please enter a valid date range. "From" must be on or before "To".');
      setGenState('error');
      return;
    }

    const exportItems = getExportItems();
    if (exportItems.length === 0) {
      if (scope === 'range') {
        Alert.alert(
          'No Purchases Found',
          'No purchases found for this date range.',
          [
            { text: 'Change Date Range', style: 'default' },
            { text: 'Cancel', style: 'cancel', onPress: handleClose },
          ]
        );
      } else {
        Alert.alert('Nothing to Export', 'No purchases in your Vault yet.');
      }
      return;
    }

    setGenState('generating');
    setCurrentFormat('csv');
    setErrorMsg('');

    try {
      const csvContent = generateCSV(
        exportItems,
        scope === 'range' ? dateFrom : null,
        scope === 'range' ? dateTo : null
      );

      const filename = getExportFilename('csv', scope, dateFrom, dateTo);
      await writeAndShareFile(csvContent, filename, 'text/csv');
      setGenState('ready');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('Sharing is not available') || msg.includes('shared')) {
        setErrorMsg("Report created, but it couldn't be shared. You can try again.");
      } else {
        setErrorMsg("Couldn't create the CSV. Please try again.");
      }
      setGenState('error');
    }
  }, [genState, scope, dateFrom, dateTo, getExportItems, rangeIsValid, handleClose]);

  const previewCount = useMemo(() => {
    if (scope === 'all') return canonicalUserItems.length;
    if (!rangeIsValid()) return null;
    return getExportItems().length;
  }, [scope, canonicalUserItems, rangeIsValid, getExportItems]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View className="flex-1 bg-serene-surface">
        <View className="flex-row items-center justify-between px-4 pt-5 pb-3 border-b border-serene-subtle-border">
          <View>
            <Text className="text-lg font-bold text-serene-on-surface">Vault Reports</Text>
            <Text className="text-[11px] text-serene-on-surface-variant mt-0.5">
              Export your purchase history
            </Text>
          </View>
          <TouchableOpacity
            onPress={handleClose}
            className="w-9 h-9 items-center justify-center rounded-full bg-serene-surface-container-low"
            accessibilityLabel="Close"
          >
            <MaterialIcons name="close" size={20} color={SereneColors.onSurfaceVariant} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerClassName="px-4 py-5 gap-5"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View className="bg-serene-surface-container-lowest border border-serene-subtle-border rounded-serene-xl p-4 gap-3">
            <Text className="text-[13px] font-bold text-serene-on-surface">
              What would you like to export?
            </Text>

            <TouchableOpacity
              className={`flex-row items-center gap-3 p-3 rounded-serene-lg border ${
                scope === 'all'
                  ? 'border-serene-primary bg-serene-surface-container'
                  : 'border-serene-subtle-border'
              }`}
              onPress={() => {
                setScope('all');
                setErrorMsg('');
              }}
              activeOpacity={0.8}
            >
              <View
                className={`w-5 h-5 rounded-full border-2 items-center justify-center ${
                  scope === 'all' ? 'border-serene-primary' : 'border-serene-outline'
                }`}
              >
                {scope === 'all' && (
                  <View className="w-2.5 h-2.5 rounded-full bg-serene-primary" />
                )}
              </View>
              <View className="flex-1">
                <Text className="text-[13px] font-semibold text-serene-on-surface">
                  Entire Vault
                </Text>
                <Text className="text-[11px] text-serene-on-surface-variant mt-0.5">
                  All {canonicalUserItems.length} purchases in your Vault
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              className={`flex-row items-center gap-3 p-3 rounded-serene-lg border ${
                scope === 'range'
                  ? 'border-serene-primary bg-serene-surface-container'
                  : 'border-serene-subtle-border'
              }`}
              onPress={() => {
                setScope('range');
                setErrorMsg('');
              }}
              activeOpacity={0.8}
            >
              <View
                className={`w-5 h-5 rounded-full border-2 items-center justify-center ${
                  scope === 'range' ? 'border-serene-primary' : 'border-serene-outline'
                }`}
              >
                {scope === 'range' && (
                  <View className="w-2.5 h-2.5 rounded-full bg-serene-primary" />
                )}
              </View>
              <View className="flex-1">
                <Text className="text-[13px] font-semibold text-serene-on-surface">
                  Custom Date Range
                </Text>
                <Text className="text-[11px] text-serene-on-surface-variant mt-0.5">
                  Filter by purchase date (inclusive)
                </Text>
              </View>
            </TouchableOpacity>

            {scope === 'range' && (
              <View className="gap-3 pt-1">
                <View className="gap-1.5">
                  <Text className="text-[11px] font-semibold text-serene-on-surface-variant uppercase tracking-wide">
                    From
                  </Text>
                  <View className="flex-row items-center bg-serene-surface-container-low border border-serene-subtle-border rounded-serene-md h-11 px-3 gap-2">
                    <MaterialIcons name="event" size={16} color={SereneColors.primary} />
                    <TextInput
                      className="flex-1 text-[13px] text-serene-on-surface"
                      value={dateFrom}
                      onChangeText={(t) => {
                        setDateFrom(t);
                        setErrorMsg('');
                      }}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={SereneColors.outline}
                      maxLength={10}
                      autoCorrect={false}
                    />
                  </View>
                  {dateFrom && !isDateInputValid(dateFrom) && (
                    <Text className="text-[11px] text-serene-error">
                      Invalid date format. Use YYYY-MM-DD or DD/MM/YYYY.
                    </Text>
                  )}
                </View>

                <View className="gap-1.5">
                  <Text className="text-[11px] font-semibold text-serene-on-surface-variant uppercase tracking-wide">
                    To
                  </Text>
                  <View className="flex-row items-center bg-serene-surface-container-low border border-serene-subtle-border rounded-serene-md h-11 px-3 gap-2">
                    <MaterialIcons name="event" size={16} color={SereneColors.primary} />
                    <TextInput
                      className="flex-1 text-[13px] text-serene-on-surface"
                      value={dateTo}
                      onChangeText={(t) => {
                        setDateTo(t);
                        setErrorMsg('');
                      }}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={SereneColors.outline}
                      maxLength={10}
                      autoCorrect={false}
                    />
                  </View>
                  {dateTo && !isDateInputValid(dateTo) && (
                    <Text className="text-[11px] text-serene-error">
                      Invalid date format. Use YYYY-MM-DD or DD/MM/YYYY.
                    </Text>
                  )}
                  {isDateInputValid(dateFrom) &&
                    isDateInputValid(dateTo) &&
                    parseFlexibleDate(dateFrom)!.getTime() > parseFlexibleDate(dateTo)!.getTime() && (
                      <Text className="text-[11px] text-serene-error">
                        "From" date must be on or before "To" date.
                      </Text>
                    )}
                </View>

                {rangeIsValid() && (
                  <View className="flex-row items-center gap-1.5 bg-serene-tertiary-fixed px-3 py-2 rounded-serene-md">
                    <MaterialIcons name="filter-alt" size={14} color={SereneColors.primary} />
                    <Text className="text-[11px] font-semibold text-serene-primary">
                      {previewCount === 0
                        ? 'No purchases match this date range'
                        : `${previewCount} purchase${previewCount === 1 ? '' : 's'} will be exported`}
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>

          <View className="bg-serene-surface-container-lowest border border-serene-subtle-border rounded-serene-xl p-4 gap-3">
            <Text className="text-[13px] font-bold text-serene-on-surface">Export format</Text>

            {genState === 'generating' ? (
              <View className="items-center justify-center py-6 gap-3">
                <ActivityIndicator size="large" color={SereneColors.primary} />
                <Text className="text-[13px] font-medium text-serene-on-surface-variant">
                  {currentFormat === 'pdf' ? 'Preparing your PDF...' : 'Preparing your CSV...'}
                </Text>
              </View>
            ) : genState === 'error' ? (
              <View className="gap-3">
                <View className="flex-row items-start gap-2 bg-serene-error-container px-3 py-3 rounded-serene-md">
                  <MaterialIcons
                    name="error-outline"
                    size={18}
                    color={SereneColors.error}
                    style={{ marginTop: 1 }}
                  />
                  <Text className="text-[12px] text-serene-error flex-1">
                    {errorMsg || "Couldn't create the report. Please try again."}
                  </Text>
                </View>
                <TouchableOpacity
                  className="flex-row items-center justify-center gap-2 py-3 rounded-serene-lg bg-serene-surface-container"
                  onPress={handleRetry}
                >
                  <MaterialIcons name="refresh" size={16} color={SereneColors.primary} />
                  <Text className="text-[13px] font-semibold text-serene-primary">Try Again</Text>
                </TouchableOpacity>
              </View>
            ) : genState === 'ready' ? (
              <View className="gap-3">
                <View className="flex-row items-center gap-2 bg-serene-tertiary-fixed px-3 py-3 rounded-serene-md">
                  <MaterialIcons name="check-circle" size={18} color={SereneColors.tertiary} />
                  <Text className="text-[12px] font-semibold text-serene-tertiary">
                    Report ready — share sheet opened
                  </Text>
                </View>
                <Text className="text-[11px] text-serene-on-surface-variant text-center">
                  Generate another report below
                </Text>
                <View className="flex-row gap-3">
                  <TouchableOpacity
                    className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-serene-lg border border-serene-subtle-border bg-serene-surface-container-low"
                    onPress={handleExportPDF}
                    activeOpacity={0.85}
                  >
                    <MaterialIcons name="picture-as-pdf" size={18} color={SereneColors.error} />
                    <Text className="text-[13px] font-semibold text-serene-on-surface">PDF</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-serene-lg border border-serene-subtle-border bg-serene-surface-container-low"
                    onPress={handleExportCSV}
                    activeOpacity={0.85}
                  >
                    <MaterialIcons name="table-chart" size={18} color={SereneColors.primary} />
                    <Text className="text-[13px] font-semibold text-serene-on-surface">CSV</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View className="flex-row gap-3">
                <TouchableOpacity
                  className="flex-1 items-center gap-2 py-4 rounded-serene-xl border border-serene-subtle-border bg-serene-surface-container-low"
                  onPress={handleExportPDF}
                  activeOpacity={0.85}
                  disabled={genState !== 'idle'}
                >
                  <MaterialIcons name="picture-as-pdf" size={28} color={SereneColors.error} />
                  <Text className="text-[13px] font-bold text-serene-on-surface">Export as PDF</Text>
                  <Text className="text-[10px] text-serene-on-surface-variant">
                    Opens in any PDF viewer
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  className="flex-1 items-center gap-2 py-4 rounded-serene-xl border border-serene-subtle-border bg-serene-surface-container-low"
                  onPress={handleExportCSV}
                  activeOpacity={0.85}
                  disabled={genState !== 'idle'}
                >
                  <MaterialIcons name="table-chart" size={28} color={SereneColors.primary} />
                  <Text className="text-[13px] font-bold text-serene-on-surface">Export as CSV</Text>
                  <Text className="text-[10px] text-serene-on-surface-variant">
                    Opens in Excel / Sheets
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          <View className="flex-row items-start gap-2">
            <MaterialIcons
              name="info-outline"
              size={14}
              color={SereneColors.outline}
              style={{ marginTop: 1 }}
            />
            <Text className="text-[11px] text-serene-outline flex-1">
              Exports include only your personal Vault data. Receipt images and photos are not
              included in exports.
            </Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
