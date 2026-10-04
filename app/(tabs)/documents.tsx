// ==============================================================================
// KEEPR DIGITAL OWNERSHIP VAULT: Documents Vault Screen
// Full Search + Sort + Filter implementation for VaultDocument entities.
// Strict entity separation: only Documents shown here, never Purchased Items.
// Pipeline: userDocuments → search → filter → sort → render
// ==============================================================================

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  FlatList,
  StyleSheet,
  Platform,
  Alert,
  Share,
  BackHandler,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { Header } from '../../src/components/ui/Header';
import { SereneColors } from '../../src/constants/theme';
import { useItemStore } from '../../src/store/itemStore';
import { useAuthStore } from '../../src/store/authStore';
import { VaultDocument } from '../../src/types';
import { formatCurrency, formatDate } from '../../src/utils/currency';
import { getCanonicalDocumentUri } from '../../src/services/receiptFileService';
import { getDocumentCategoryMeta } from '../../src/constants/documentCategories';
import {
  DocSortModal,
  DocSortOption,
  DOC_SORT_LABELS,
} from '../../src/components/documents/DocSortModal';
import {
  DocFilterModal,
  DocFilterState,
  DEFAULT_DOC_FILTERS,
  countActiveDocFilters,
} from '../../src/components/documents/DocFilterModal';

// ─── Expiry badge helper (preserves semantic distinction: dueDate ≠ expiryDate) ──
function getExpiryBadge(expiryDate?: string | null, category?: string) {
  if (!expiryDate) return null;
  const exp = new Date(expiryDate);
  if (isNaN(exp.getTime())) return null;
  const diffDays = Math.ceil((exp.getTime() - Date.now()) / 86400000);
  const isBill = category === 'Bills & Utilities';
  if (diffDays < 0) return { label: isBill ? 'Overdue' : 'Expired', bg: '#FFF1F2', text: '#BE123C', border: '#FECDD3' };
  if (diffDays === 0) return { label: isBill ? 'Due Today' : 'Expires Today', bg: '#FFFBEB', text: '#92400E', border: '#FDE68A' };
  if (diffDays <= 30) return { label: isBill ? 'Due in ' + diffDays + 'd' : 'Expires in ' + diffDays + 'd', bg: '#FFFBEB', text: '#92400E', border: '#FDE68A' };
  return { label: isBill ? 'Due ' + formatDate(expiryDate) : 'Expires ' + formatDate(expiryDate), bg: '#F0FDF4', text: '#166534', border: '#BBF7D0' };
}

interface SelectableDocumentCardProps {
  item: VaultDocument;
  linkedItem?: { name: string } | null;
  isSelected: boolean;
  isSelectionMode: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

const SelectableDocumentCard = React.memo(function SelectableDocumentCard({
  item,
  linkedItem,
  isSelected,
  isSelectionMode,
  onPress,
  onLongPress,
}: SelectableDocumentCardProps) {
  const meta = getDocumentCategoryMeta(item.category);
  const canonicalUri = getCanonicalDocumentUri(item.fileUrl || item.filePath);
  const isPdf =
    (item.mimeType && item.mimeType.includes('pdf')) ||
    (canonicalUri && canonicalUri.toLowerCase().endsWith('.pdf')) ||
    (item.title && item.title.toLowerCase().endsWith('.pdf'));

  // Use expiryDate for expiry badge; dueDate is semantically different (bill due)
  const expiryBadge = getExpiryBadge(item.expiryDate, item.category);
  const dueBadge = item.dueDate && item.category === 'Bills & Utilities'
    ? getExpiryBadge(item.dueDate, item.category)
    : null;
  const activeBadge = dueBadge || expiryBadge;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        isSelected && {
          backgroundColor: 'rgba(17, 80, 134, 0.07)',
          borderColor: 'rgba(17, 80, 134, 0.35)',
          borderWidth: 1.5,
        },
      ]}
      activeOpacity={0.75}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={380}
      accessible
      accessibilityLabel={`${item.title || item.name || 'Untitled Document'}${isSelected ? ', selected' : ''}`}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
    >
      {isSelectionMode && (
        <View
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            zIndex: 10,
            width: 22,
            height: 22,
            borderRadius: 11,
            borderWidth: 2,
            borderColor: isSelected ? SereneColors.primary : 'rgba(17, 80, 134, 0.3)',
            backgroundColor: isSelected ? SereneColors.primary : 'rgba(255,255,255,0.9)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isSelected && (
            <MaterialIcons name="check" size={14} color="#fff" />
          )}
        </View>
      )}

      <View style={styles.cardRow}>
        <View style={styles.thumb}>
          {isPdf ? (
            <View style={styles.thumbInner}>
              <MaterialIcons name="picture-as-pdf" size={24} color={SereneColors.error} />
              <Text style={styles.thumbPdfLabel}>PDF</Text>
            </View>
          ) : canonicalUri && !canonicalUri.startsWith('http') ? (
            <Image source={{ uri: canonicalUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <MaterialIcons name={(meta.icon as any) || 'description'} size={24} color={SereneColors.primary} />
          )}
        </View>

        <View style={styles.cardContent}>
          <View style={styles.cardTopRow}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.title || item.name || 'Untitled Document'}
            </Text>
            {item.amount != null && item.amount > 0 && (
              <Text style={styles.cardAmount}>{formatCurrency(item.amount)}</Text>
            )}
          </View>

          {(item.issuerName || item.referenceNumber) && (
            <View style={styles.cardMeta}>
              {item.issuerName ? <Text style={styles.cardIssuer} numberOfLines={1}>{item.issuerName}</Text> : null}
              {item.issuerName && item.referenceNumber ? <Text style={styles.cardDot}>·</Text> : null}
              {item.referenceNumber ? <Text style={styles.cardRef} numberOfLines={1}>#{item.referenceNumber}</Text> : null}
            </View>
          )}

          <View style={styles.cardTags}>
            <View style={styles.typePill}>
              <Text style={styles.typePillText} numberOfLines={1}>{item.documentType || item.category}</Text>
            </View>

            {linkedItem && (
              <View style={styles.linkedPill}>
                <MaterialIcons name="link" size={10} color="#0284C7" />
                <Text style={styles.linkedPillText} numberOfLines={1}>{linkedItem.name}</Text>
              </View>
            )}

            {activeBadge && (
              <View style={[styles.expiryPill, { backgroundColor: activeBadge.bg, borderColor: activeBadge.border }]}>
                <Text style={[styles.expiryPillText, { color: activeBadge.text }]}>{activeBadge.label}</Text>
              </View>
            )}

            {item.documentDate && (
              <Text style={styles.docDate}>{formatDate(item.documentDate)}</Text>
            )}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
});

export default function DocumentsVaultScreen() {
  const user = useAuthStore((s) => s.user);
  const documents = useItemStore((s) => s.documents);
  const items = useItemStore((s) => s.items);
  const deleteDocument = useItemStore((s) => s.deleteDocument);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSort, setSelectedSort] = useState<DocSortOption>('recent_added');
  const [filters, setFilters] = useState<DocFilterState>(DEFAULT_DOC_FILTERS);
  const [showSortModal, setShowSortModal] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);

  // ── Multi-Select State (ID-based, never index-based) ─────────────────────
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());

  const exitSelectionMode = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedDocIds(new Set());
  }, []);

  const enterSelectionMode = useCallback((firstDocId: string) => {
    setIsSelectionMode(true);
    setSelectedDocIds(new Set([firstDocId]));
  }, []);

  const toggleDocSelection = useCallback((docId: string) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  }, []);

  const itemsMap = useMemo(() => {
    const map = new Map<string, { name: string; registrationNumber?: string; brand?: string; model?: string }>();
    for (const item of items) {
      if (item && item.id) map.set(item.id, { name: item.name, registrationNumber: item.registrationNumber, brand: item.brand, model: item.model });
    }
    return map;
  }, [items]);

  // ── 1. User-scoped Documents (no Items ever) ───────────────────────────────
  const userDocuments = useMemo(() => {
    const uid = user?.id;
    return (documents || []).filter((doc) => {
      if (!doc || !doc.id) return false;
      if (uid && doc.userId && doc.userId !== uid) return false;
      return true;
    });
  }, [documents, user?.id]);

  useEffect(() => {
    if (isSelectionMode && selectedDocIds.size > 0) {
      const validIds = new Set(userDocuments.map((d) => d.id));
      const pruned = new Set([...selectedDocIds].filter((id) => validIds.has(id)));
      if (pruned.size !== selectedDocIds.size) {
        setSelectedDocIds(pruned);
        if (pruned.size === 0) exitSelectionMode();
      }
    }
  }, [userDocuments]);

  // ── Android Back Button: exit selection first ──────────────────────────────
  useFocusEffect(
    useCallback(() => {
      const handler = BackHandler.addEventListener('hardwareBackPress', () => {
        if (isSelectionMode) {
          exitSelectionMode();
          return true; // consume the event
        }
        return false; // let default navigation happen
      });
      return () => handler.remove();
    }, [isSelectionMode, exitSelectionMode])
  );

  const filteredDocuments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const now = Date.now();

    const searched = query
      ? userDocuments.filter((doc) => {
          const linkedData = doc.itemId ? itemsMap.get(doc.itemId) : null;
          const fields = [
            doc.title, doc.name, doc.documentType, doc.category,
            doc.issuerName, doc.referenceNumber, doc.notes,
            linkedData?.name, linkedData?.registrationNumber, linkedData?.brand, linkedData?.model,
          ].filter(Boolean).join(' ').toLowerCase();
          return fields.includes(query);
        })
      : userDocuments;

    const filtered = searched.filter((doc) => {
      if (filters.category !== 'all' && doc.category !== filters.category) return false;

      if (filters.documentType && filters.documentType !== 'all' && doc.documentType !== filters.documentType) return false;

      // Expiry status — uses expiryDate ONLY, never confuses with dueDate or documentDate
      if (filters.expiryStatus !== 'all') {
        const expDate = doc.expiryDate;
        const hasExpiry = Boolean(expDate && !isNaN(new Date(expDate).getTime()));
        if (filters.expiryStatus === 'no_expiry' && hasExpiry) return false;
        if (filters.expiryStatus === 'has_expiry' && !hasExpiry) return false;
        if (filters.expiryStatus === 'expired') {
          if (!hasExpiry) return false;
          const diffDays = Math.ceil((new Date(expDate!).getTime() - now) / 86400000);
          if (diffDays >= 0) return false;
        }
        if (filters.expiryStatus === 'expiring_soon') {
          if (!hasExpiry) return false;
          const diffDays = Math.ceil((new Date(expDate!).getTime() - now) / 86400000);
          if (diffDays < 0 || diffDays > 60) return false;
        }
      }

      if (filters.docDateRange !== 'all') {
        if (!doc.documentDate) return false;
        const docTime = new Date(doc.documentDate).getTime();
        if (isNaN(docTime)) return false;
        const diffDays = (now - docTime) / 86400000;
        if (filters.docDateRange === '30d' && (diffDays < 0 || diffDays > 30)) return false;
        if (filters.docDateRange === '3m' && (diffDays < 0 || diffDays > 90)) return false;
        if (filters.docDateRange === '6m' && (diffDays < 0 || diffDays > 180)) return false;
        if (filters.docDateRange === '12m' && (diffDays < 0 || diffDays > 365)) return false;
        if (filters.docDateRange === 'older_1y' && diffDays <= 365) return false;
      }

      if (filters.hasAmount === 'yes' && (doc.amount == null || doc.amount === 0)) return false;
      if (filters.hasAmount === 'no' && doc.amount != null && doc.amount > 0) return false;

      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (selectedSort === 'recent_added') {
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      }
      if (selectedSort === 'oldest_added') {
        return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      }
      if (selectedSort === 'doc_date_desc') {
        const ta = a.documentDate ? new Date(a.documentDate).getTime() : -Infinity;
        const tb = b.documentDate ? new Date(b.documentDate).getTime() : -Infinity;
        return tb - ta;
      }
      if (selectedSort === 'doc_date_asc') {
        const ta = a.documentDate ? new Date(a.documentDate).getTime() : Infinity;
        const tb = b.documentDate ? new Date(b.documentDate).getTime() : Infinity;
        return ta - tb;
      }
      if (selectedSort === 'expiry_asc') {
        const ea = a.expiryDate && !isNaN(new Date(a.expiryDate).getTime()) ? new Date(a.expiryDate).getTime() : Infinity;
        const eb = b.expiryDate && !isNaN(new Date(b.expiryDate).getTime()) ? new Date(b.expiryDate).getTime() : Infinity;
        return ea - eb;
      }
      if (selectedSort === 'expiry_desc') {
        const ea = a.expiryDate && !isNaN(new Date(a.expiryDate).getTime()) ? new Date(a.expiryDate).getTime() : -Infinity;
        const eb = b.expiryDate && !isNaN(new Date(b.expiryDate).getTime()) ? new Date(b.expiryDate).getTime() : -Infinity;
        return eb - ea;
      }
      if (selectedSort === 'name_asc') return (a.title || a.name || '').localeCompare(b.title || b.name || '', undefined, { sensitivity: 'base' });
      if (selectedSort === 'name_desc') return (b.title || b.name || '').localeCompare(a.title || a.name || '', undefined, { sensitivity: 'base' });
      return 0;
    });

    return sorted;
  }, [userDocuments, searchQuery, filters, selectedSort, itemsMap]);

  const activeFilterCount = useMemo(() => countActiveDocFilters(filters), [filters]);
  const hasActiveSearch = searchQuery.trim().length > 0;
  const hasAnyFilter = activeFilterCount > 0 || hasActiveSearch;

  const handleApplyFilters = useCallback((newFilters: DocFilterState) => setFilters(newFilters), []);
  const handleClearAllSearchAndFilters = useCallback(() => {
    setSearchQuery('');
    setFilters(DEFAULT_DOC_FILTERS);
  }, []);

  const handleDocPress = useCallback((doc: VaultDocument) => {
    if (isSelectionMode) {
      toggleDocSelection(doc.id);
    } else {
      router.push(`/document/${doc.id}` as any);
    }
  }, [isSelectionMode, toggleDocSelection]);

  const handleDocLongPress = useCallback((doc: VaultDocument) => {
    if (!isSelectionMode) {
      enterSelectionMode(doc.id);
    } else {
      toggleDocSelection(doc.id);
    }
  }, [isSelectionMode, enterSelectionMode, toggleDocSelection]);

  const displayedDocIds = useMemo(() => new Set(filteredDocuments.map((d) => d.id)), [filteredDocuments]);
  const allDisplayedSelected = filteredDocuments.length > 0 && filteredDocuments.every((d) => selectedDocIds.has(d.id));

  const handleSelectAllToggle = useCallback(() => {
    if (allDisplayedSelected) {
      setSelectedDocIds((prev) => {
        const next = new Set(prev);
        for (const id of displayedDocIds) next.delete(id);
        return next;
      });
    } else {
      setSelectedDocIds((prev) => new Set([...prev, ...displayedDocIds]));
    }
  }, [allDisplayedSelected, displayedDocIds]);

  const buildShareDocsText = useCallback((ids: Set<string>): string => {
    const selectedDocs = userDocuments.filter((d) => ids.has(d.id));
    if (selectedDocs.length === 0) return '';

    const lines: string[] = ['📄 Keepr Document Details\n'];

    selectedDocs.forEach((doc, index) => {
      lines.push(`${index + 1}. ${doc.title || doc.name || 'Untitled Document'}`);
      if (doc.documentType) lines.push(`   Type: ${doc.documentType}`);
      if (doc.category) lines.push(`   Category: ${doc.category}`);
      if (doc.issuerName) lines.push(`   Issuer: ${doc.issuerName}`);
      if (doc.referenceNumber) lines.push(`   Ref / Policy #: ${doc.referenceNumber}`);
      if (doc.amount != null && doc.amount > 0) lines.push(`   Amount: ${formatCurrency(doc.amount, doc.currency || 'INR')}`);
      if (doc.documentDate) lines.push(`   Date: ${formatDate(doc.documentDate)}`);
      if (doc.expiryDate) lines.push(`   Expires: ${formatDate(doc.expiryDate)}`);
      if (doc.notes) lines.push(`   Notes: ${doc.notes}`);
      lines.push('');
    });

    return lines.join('\n');
  }, [userDocuments]);

  const handleShareDocs = useCallback(async () => {
    if (selectedDocIds.size === 0) return;
    const shareText = buildShareDocsText(selectedDocIds);
    if (!shareText) return;

    try {
      await Share.share({
        message: shareText,
        title: selectedDocIds.size === 1 ? 'Document Details' : `${selectedDocIds.size} Document Records`,
      });
    } catch (err: any) {
      if (err?.message !== 'User did not share') {
        Alert.alert("Couldn't Share", "Couldn't share the selected documents. Please try again.");
      }
    }
  }, [selectedDocIds, buildShareDocsText]);

  const handleDeleteDocs = useCallback(() => {
    if (selectedDocIds.size === 0) return;

    const count = selectedDocIds.size;
    const title = 'Delete permanently?';
    const message = count === 1
      ? 'This document will be permanently deleted and cannot be recovered.'
      : 'These documents will be permanently deleted and cannot be recovered.';

    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Permanently',
          style: 'destructive',
          onPress: async () => {
            const idsToDelete = [...selectedDocIds];
            for (const docId of idsToDelete) {
              try {
                await deleteDocument(docId);
              } catch (err: any) {
                console.warn('[DocumentsVault] Failed to delete document:', docId, err?.message);
              }
            }
            setSelectedDocIds((prev) => {
              const next = new Set(prev);
              for (const id of idsToDelete) next.delete(id);
              return next;
            });
            exitSelectionMode();
          },
        },
      ]
    );
  }, [selectedDocIds, deleteDocument, exitSelectionMode]);

  const renderItem = useCallback(({ item }: { item: VaultDocument }) => {
    const linkedItem = item.itemId ? itemsMap.get(item.itemId) : null;
    return (
      <SelectableDocumentCard
        item={item}
        linkedItem={linkedItem}
        isSelected={selectedDocIds.has(item.id)}
        isSelectionMode={isSelectionMode}
        onPress={() => handleDocPress(item)}
        onLongPress={() => handleDocLongPress(item)}
      />
    );
  }, [itemsMap, selectedDocIds, isSelectionMode, handleDocPress, handleDocLongPress]);

  const emptyNode = useMemo(() => {
    if (userDocuments.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIcon}>
            <MaterialIcons name="folder-open" size={28} color={SereneColors.primary} />
          </View>
          <Text style={styles.emptyTitle}>No documents in vault</Text>
          <Text style={styles.emptySubtitle}>
            Store invoices, RC, insurance policies, college receipts, and utility bills safely.
          </Text>
          <TouchableOpacity style={styles.emptyAction} onPress={() => router.push('/document/add' as any)} activeOpacity={0.85}>
            <MaterialIcons name="add" size={16} color="#FFFFFF" />
            <Text style={styles.emptyActionText}>Add First Document</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (hasActiveSearch && filteredDocuments.length === 0 && activeFilterCount === 0) {
      return (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIcon}>
            <MaterialIcons name="search-off" size={28} color={SereneColors.primary} />
          </View>
          <Text style={styles.emptyTitle}>No documents found</Text>
          <Text style={styles.emptySubtitle}>
            No documents match "{searchQuery}". Try a different search term.
          </Text>
          <TouchableOpacity style={styles.clearBtn} onPress={() => setSearchQuery('')} activeOpacity={0.85}>
            <Text style={styles.clearBtnText}>Clear Search</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (filteredDocuments.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIcon}>
            <MaterialIcons name="filter-alt-off" size={28} color={SereneColors.primary} />
          </View>
          <Text style={styles.emptyTitle}>No documents match your filters</Text>
          <Text style={styles.emptySubtitle}>
            Try adjusting your active filters or clearing them.
          </Text>
          <TouchableOpacity style={styles.clearBtn} onPress={handleClearAllSearchAndFilters} activeOpacity={0.85}>
            <Text style={styles.clearBtnText}>Clear All Filters</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return null;
  }, [userDocuments.length, filteredDocuments.length, hasActiveSearch, activeFilterCount, searchQuery, handleClearAllSearchAndFilters]);

  return (
    <View style={styles.root}>
      {isSelectionMode ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingTop: 52,
            paddingBottom: 12,
            backgroundColor: '#fff',
            borderBottomWidth: 1,
            borderBottomColor: 'rgba(17,80,134,0.08)',
          }}
        >
          <TouchableOpacity
            onPress={exitSelectionMode}
            style={{ padding: 4, marginRight: 10 }}
            accessibilityLabel="Exit selection mode"
          >
            <MaterialIcons name="close" size={22} color={SereneColors.primary} />
          </TouchableOpacity>

          <Text style={{ flex: 1, fontSize: 16, fontWeight: '700', color: SereneColors.onSurface }}>
            {selectedDocIds.size} selected
          </Text>

          <TouchableOpacity
            onPress={handleSelectAllToggle}
            style={{ marginRight: 6, paddingVertical: 4, paddingHorizontal: 8 }}
            accessibilityLabel={allDisplayedSelected ? 'Deselect all' : 'Select all'}
          >
            <Text style={{ fontSize: 13, fontWeight: '600', color: SereneColors.primary }}>
              {allDisplayedSelected ? 'Deselect All' : 'Select All'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Header
          title="Documents"
          rightAction={
            <TouchableOpacity
              style={styles.addBtn}
              activeOpacity={0.88}
              onPress={() => router.push('/document/add' as any)}
              accessibilityLabel="Add Document"
              accessibilityRole="button"
            >
              <MaterialIcons name="add" size={18} color="#FFFFFF" />
              <Text style={styles.addBtnText}>Add</Text>
            </TouchableOpacity>
          }
        />
      )}

      <View style={styles.content}>
        <View style={styles.searchBar}>
          <MaterialIcons name="search" size={20} color={SereneColors.onSurfaceVariant} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search documents, types, issuers, notes…"
            placeholderTextColor={SereneColors.outline}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityLabel="Clear search">
              <MaterialIcons name="cancel" size={18} color={SereneColors.outline} />
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.controlsRow}>
          <TouchableOpacity
            style={styles.sortBtn}
            onPress={() => setShowSortModal(true)}
            activeOpacity={0.8}
            accessibilityLabel="Sort documents"
          >
            <MaterialIcons name="sort" size={17} color={SereneColors.primary} />
            <Text style={styles.sortBtnText} numberOfLines={1}>
              <Text style={styles.sortBtnLabel}>Sorted by </Text>
              <Text style={styles.sortBtnValue}>{DOC_SORT_LABELS[selectedSort]}</Text>
            </Text>
            <MaterialIcons name="expand-more" size={18} color={SereneColors.onSurfaceVariant} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterBtn, activeFilterCount > 0 && styles.filterBtnActive]}
            onPress={() => setShowFilterModal(true)}
            activeOpacity={0.8}
            accessibilityLabel="Filter documents"
          >
            <MaterialIcons name="tune" size={18} color={activeFilterCount > 0 ? SereneColors.primary : SereneColors.onSurfaceVariant} />
            <Text style={[styles.filterBtnText, activeFilterCount > 0 && styles.filterBtnTextActive]}>
              {activeFilterCount > 0 ? 'Filter · ' + activeFilterCount : 'Filters'}
            </Text>
          </TouchableOpacity>
        </View>

        {hasAnyFilter && (
          <View style={styles.activeFilterBar}>
            <MaterialIcons name="filter-alt" size={14} color={SereneColors.primary} style={{ marginRight: 4 }} />
            <Text style={styles.activeFilterText} numberOfLines={1}>
              {searchQuery ? '"' + searchQuery + '"' : ''}
              {filters.category !== 'all' ? (searchQuery ? ' · ' : '') + filters.category : ''}
              {filters.documentType && filters.documentType !== 'all' ? ' · ' + filters.documentType : ''}
              {filters.expiryStatus !== 'all' ? ' · Expiry: ' + filters.expiryStatus : ''}
              {filters.docDateRange !== 'all' ? ' · Date range: ' + filters.docDateRange : ''}
              {' (' + filteredDocuments.length + ' matching)'}
            </Text>
            <TouchableOpacity onPress={handleClearAllSearchAndFilters} style={styles.clearAllBtn}>
              <Text style={styles.clearAllText}>Clear All</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.countRow}>
          <Text style={styles.countText}>
            {filteredDocuments.length} document{filteredDocuments.length === 1 ? '' : 's'}
            {userDocuments.length !== filteredDocuments.length ? ' of ' + userDocuments.length : ''}
          </Text>
        </View>

        <FlatList
          data={filteredDocuments}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          extraData={selectedDocIds}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={emptyNode}
          removeClippedSubviews
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={8}
        />
      </View>

      {isSelectionMode && (
        <View
          style={{
            flexDirection: 'row',
            gap: 10,
            paddingHorizontal: 16,
            paddingVertical: 12,
            paddingBottom: Platform.OS === 'ios' ? 28 : 16,
            backgroundColor: '#fff',
            borderTopWidth: 1,
            borderTopColor: 'rgba(17,80,134,0.10)',
          }}
        >
          <TouchableOpacity
            onPress={handleShareDocs}
            disabled={selectedDocIds.size === 0}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: 12,
              borderRadius: 10,
              backgroundColor: 'rgba(17,80,134,0.08)',
              borderWidth: 1,
              borderColor: 'rgba(17,80,134,0.18)',
              opacity: selectedDocIds.size === 0 ? 0.45 : 1,
            }}
            accessibilityLabel={`Share ${selectedDocIds.size} selected documents`}
          >
            <MaterialIcons name="share" size={18} color={SereneColors.primary} />
            <Text style={{ fontSize: 14, fontWeight: '600', color: SereneColors.primary }}>
              Share
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleDeleteDocs}
            disabled={selectedDocIds.size === 0}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: 12,
              borderRadius: 10,
              backgroundColor: 'rgba(186,26,26,0.08)',
              borderWidth: 1,
              borderColor: 'rgba(186,26,26,0.20)',
              opacity: selectedDocIds.size === 0 ? 0.45 : 1,
            }}
            accessibilityLabel={`Delete ${selectedDocIds.size} selected documents`}
          >
            <MaterialIcons name="delete-outline" size={18} color={SereneColors.error} />
            <Text style={{ fontSize: 14, fontWeight: '600', color: SereneColors.error }}>
              {selectedDocIds.size > 0 ? `Delete (${selectedDocIds.size})` : 'Delete'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <DocSortModal
        visible={showSortModal}
        selectedSort={selectedSort}
        onSelectSort={(s) => setSelectedSort(s)}
        onClose={() => setShowSortModal(false)}
      />

      <DocFilterModal
        visible={showFilterModal}
        filters={filters}
        onApplyFilters={handleApplyFilters}
        onClose={() => setShowFilterModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SereneColors.surface },
  content: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },

  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: SereneColors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    ...Platform.select({ ios: { shadowColor: SereneColors.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4 }, android: { elevation: 3 } }),
  },
  addBtnText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SereneColors.surfaceContainerLowest,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: SereneColors.subtleBorder,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 14, color: SereneColors.onSurface },

  controlsRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  sortBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: SereneColors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: SereneColors.subtleBorder,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  sortBtnText: { flex: 1, fontSize: 12, color: SereneColors.onSurface },
  sortBtnLabel: { fontWeight: '400' },
  sortBtnValue: { fontWeight: '700', color: SereneColors.primary },

  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: SereneColors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: SereneColors.subtleBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filterBtnActive: {
    backgroundColor: SereneColors.surfaceContainerHighest,
    borderColor: SereneColors.primary,
  },
  filterBtnText: { fontSize: 12, fontWeight: '600', color: SereneColors.onSurface },
  filterBtnTextActive: { fontWeight: '700', color: SereneColors.primary },

  activeFilterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SereneColors.surfaceContainerLow,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: SereneColors.subtleBorder,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 6,
  },
  activeFilterText: { flex: 1, fontSize: 11, color: SereneColors.onSurface, marginRight: 6 },
  clearAllBtn: { paddingVertical: 2, paddingHorizontal: 4 },
  clearAllText: { fontSize: 11, fontWeight: '700', color: SereneColors.primary },

  countRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  countText: { fontSize: 12, fontWeight: '500', color: SereneColors.onSurfaceVariant },

  listContent: { paddingBottom: 32 },

  card: {
    backgroundColor: SereneColors.surfaceContainerLowest,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: SereneColors.subtleBorder,
    ...Platform.select({ ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2 }, android: { elevation: 1 } }),
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12 },
  thumb: { width: 52, height: 56, borderRadius: 10, overflow: 'hidden', backgroundColor: SereneColors.surfaceContainerLow, borderWidth: 1, borderColor: SereneColors.subtleBorder, alignItems: 'center', justifyContent: 'center' },
  thumbInner: { alignItems: 'center', justifyContent: 'center' },
  thumbPdfLabel: { fontSize: 9, fontWeight: '700', color: SereneColors.error, marginTop: 2 },
  cardContent: { flex: 1, gap: 3 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: SereneColors.onSurface, marginRight: 8 },
  cardAmount: { fontSize: 13, fontWeight: '700', color: SereneColors.primary },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  cardIssuer: { fontSize: 11, fontWeight: '500', color: SereneColors.onSurfaceVariant },
  cardDot: { fontSize: 11, color: SereneColors.outline },
  cardRef: { fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', color: SereneColors.onSurfaceVariant },
  cardTags: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5, marginTop: 2 },
  typePill: { backgroundColor: SereneColors.surfaceContainerHigh, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  typePillText: { fontSize: 10, fontWeight: '600', color: SereneColors.onSurfaceVariant },
  linkedPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#F0F9FF', borderWidth: 1, borderColor: '#BAE6FD', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  linkedPillText: { fontSize: 10, fontWeight: '600', color: '#0369A1' },
  expiryPill: { borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  expiryPillText: { fontSize: 10, fontWeight: '700' },
  docDate: { fontSize: 10, color: SereneColors.outline, marginLeft: 'auto' },

  emptyContainer: { paddingTop: 48, alignItems: 'center', paddingHorizontal: 24 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(17,80,134,0.08)', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: SereneColors.onSurface, textAlign: 'center', marginBottom: 6 },
  emptySubtitle: { fontSize: 13, color: SereneColors.onSurfaceVariant, textAlign: 'center', marginBottom: 20, lineHeight: 19 },
  emptyAction: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: SereneColors.primary, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10 },
  emptyActionText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  clearBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: SereneColors.subtleBorder, backgroundColor: SereneColors.surfaceContainerLow },
  clearBtnText: { fontSize: 14, fontWeight: '600', color: SereneColors.primary },
});
