import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable, ScrollView, StyleSheet, Platform, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { SereneColors } from '../../constants/theme';
import { CANONICAL_DOCUMENT_CATEGORIES, getDocumentTypesForCategory } from '../../constants/documentCategories';

export interface DocFilterState {
  category: string;
  documentType: string;
  expiryStatus: 'all' | 'expiring_soon' | 'expired' | 'has_expiry' | 'no_expiry';
  docDateRange: 'all' | '30d' | '3m' | '6m' | '12m' | 'older_1y';
  hasAmount: 'all' | 'yes' | 'no';
}

export const DEFAULT_DOC_FILTERS: DocFilterState = {
  category: 'all',
  documentType: 'all',
  expiryStatus: 'all',
  docDateRange: 'all',
  hasAmount: 'all',
};

export function countActiveDocFilters(f: DocFilterState): number {
  let n = 0;
  if (f.category !== 'all') n++;
  if (f.documentType && f.documentType !== 'all') n++;
  if (f.expiryStatus !== 'all') n++;
  if (f.docDateRange !== 'all') n++;
  if (f.hasAmount !== 'all') n++;
  return n;
}

export interface DocFilterModalProps {
  visible: boolean;
  filters: DocFilterState;
  onApplyFilters: (newFilters: DocFilterState) => void;
  onClose: () => void;
}

function PillRow<T extends string>({ label, options, selected, onSelect }: { label: string; options: Array<{ id: T; label: string }>; selected: T; onSelect: (id: T) => void }) {
  return (
    <View style={ps.section}>
      <Text style={ps.sectionLabel}>{label}</Text>
      <View style={ps.pillWrap}>
        {options.map((opt) => {
          const isSel = opt.id === selected;
          return (
            <TouchableOpacity key={opt.id} onPress={() => onSelect(opt.id)} activeOpacity={0.7} style={[ps.pill, isSel ? ps.pillSelected : ps.pillDefault]}>
              <Text style={[ps.pillText, isSel ? ps.pillTextSel : ps.pillTextDef]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const ps = StyleSheet.create({
  section: { gap: 8 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#1E293B', letterSpacing: 0.8, textTransform: 'uppercase' },
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  pillSelected: { backgroundColor: SereneColors.primary, borderColor: SereneColors.primary },
  pillDefault: { backgroundColor: '#F1F5F9', borderColor: '#E2E8F0' },
  pillText: { fontSize: 12, fontWeight: '600' },
  pillTextSel: { color: '#FFFFFF' },
  pillTextDef: { color: '#475569' },
});

export const DocFilterModal: React.FC<DocFilterModalProps> = ({ visible, filters, onApplyFilters, onClose }) => {
  const insets = useSafeAreaInsets();
  const SHEET_MAX_HEIGHT = Math.round(Dimensions.get('window').height * 0.88);
  const [draft, setDraft] = useState<DocFilterState>(filters);
  const prevVisRef = useRef(visible);

  useEffect(() => {
    if (visible && !prevVisRef.current) setDraft(filters);
    prevVisRef.current = visible;
  }, [visible, filters]);

  const activeCount = useMemo(() => countActiveDocFilters(draft), [draft]);
  const handleClear = useCallback(() => setDraft(DEFAULT_DOC_FILTERS), []);
  const handleApply = useCallback(() => { onApplyFilters(draft); onClose(); }, [draft, onApplyFilters, onClose]);

  const handleCategorySelect = useCallback((category: string) => {
    setDraft((prev) => {
      const types = category !== 'all' ? getDocumentTypesForCategory(category) : [];
      const typeOk = types.some((t) => t === prev.documentType);
      return { ...prev, category, documentType: typeOk ? prev.documentType : 'all' };
    });
  }, []);

  const docTypeOptions = useMemo(() => {
    const list: Array<{ id: string; label: string }> = [{ id: 'all', label: 'All Types' }];
    if (draft.category !== 'all') {
      for (const t of getDocumentTypesForCategory(draft.category)) list.push({ id: t, label: t });
    }
    return list;
  }, [draft.category]);

  const catOptions = [{ id: 'all', label: 'All Categories' }, ...CANONICAL_DOCUMENT_CATEGORIES.map((c) => ({ id: c.name, label: c.name }))];
  const expiryOptions: Array<{ id: DocFilterState['expiryStatus']; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'expiring_soon', label: 'Expiring in 60d' },
    { id: 'expired', label: 'Expired' },
    { id: 'has_expiry', label: 'Has Expiry' },
    { id: 'no_expiry', label: 'No Expiry' },
  ];
  const docDateOptions: Array<{ id: DocFilterState['docDateRange']; label: string }> = [
    { id: 'all', label: 'Any time' },
    { id: '30d', label: 'Last 30 days' },
    { id: '3m', label: 'Last 3 months' },
    { id: '6m', label: 'Last 6 months' },
    { id: '12m', label: 'Last 12 months' },
    { id: 'older_1y', label: 'Over 1 year ago' },
  ];
  const amountOptions: Array<{ id: DocFilterState['hasAmount']; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'yes', label: 'Has Amount' },
    { id: 'no', label: 'No Amount' },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={sh.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[sh.card, { maxHeight: SHEET_MAX_HEIGHT, paddingBottom: Math.max(insets.bottom, 14) }]}>
          <View style={sh.handle} />
          <View style={sh.header}>
            <View style={sh.headerLeft}>
              <Text style={sh.headerTitle}>Filter Documents</Text>
              {activeCount > 0 && (<View style={sh.badge}><Text style={sh.badgeText}>{activeCount}</Text></View>)}
            </View>
            <TouchableOpacity onPress={onClose} style={sh.closeBtn}>
              <MaterialIcons name="close" size={18} color={SereneColors.onSurfaceVariant} />
            </TouchableOpacity>
          </View>

          <ScrollView style={sh.scroll} contentContainerStyle={sh.scrollContent} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled" nestedScrollEnabled bounces={Platform.OS === 'ios'}>
            <View style={ps.section}>
              <Text style={ps.sectionLabel}>Category</Text>
              <View style={ps.pillWrap}>
                {catOptions.map((opt) => {
                  const isSel = draft.category === opt.id;
                  return (
                    <TouchableOpacity key={opt.id} onPress={() => handleCategorySelect(opt.id)} activeOpacity={0.7} style={[ps.pill, isSel ? ps.pillSelected : ps.pillDefault]}>
                      <Text style={[ps.pillText, isSel ? ps.pillTextSel : ps.pillTextDef]}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {docTypeOptions.length > 1 && (
              <PillRow label="Document Type" options={docTypeOptions} selected={draft.documentType} onSelect={(v) => setDraft((p) => ({ ...p, documentType: v }))} />
            )}

            <PillRow label="Expiry / Due Date" options={expiryOptions} selected={draft.expiryStatus} onSelect={(v) => setDraft((p) => ({ ...p, expiryStatus: v }))} />
            <PillRow label="Document Date" options={docDateOptions} selected={draft.docDateRange} onSelect={(v) => setDraft((p) => ({ ...p, docDateRange: v }))} />
            <PillRow label="Amount" options={amountOptions} selected={draft.hasAmount} onSelect={(v) => setDraft((p) => ({ ...p, hasAmount: v }))} />
          </ScrollView>

          <View style={sh.footer}>
            <TouchableOpacity style={sh.clearBtn} onPress={handleClear} activeOpacity={0.7}>
              <Text style={sh.clearText}>Clear All</Text>
            </TouchableOpacity>
            <TouchableOpacity style={sh.applyBtn} onPress={handleApply} activeOpacity={0.85}>
              <Text style={sh.applyText}>{activeCount > 0 ? 'Apply (' + activeCount + ')' : 'Apply'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const sh = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.55)', justifyContent: 'flex-end' },
  card: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, flexDirection: 'column', ...Platform.select({ ios: { shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.15, shadowRadius: 8 }, android: { elevation: 16 } }) },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#CBD5E1', alignSelf: 'center', marginTop: 12, marginBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(17,80,134,0.08)' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#1E293B' },
  badge: { backgroundColor: SereneColors.primary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 1, flexShrink: 1, minHeight: 180 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 20 },
  footer: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(17,80,134,0.08)', backgroundColor: '#FFFFFF' },
  clearBtn: { flex: 1, paddingVertical: 13, borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#F8FAFC', alignItems: 'center', justifyContent: 'center' },
  clearText: { fontSize: 14, fontWeight: '600', color: '#475569' },
  applyBtn: { flex: 2, paddingVertical: 13, borderRadius: 10, backgroundColor: SereneColors.primary, alignItems: 'center', justifyContent: 'center', ...Platform.select({ ios: { shadowColor: SereneColors.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4 }, android: { elevation: 3 } }) },
  applyText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
});
