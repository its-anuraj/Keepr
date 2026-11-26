import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SereneColors } from '../../constants/theme';
import { DocumentScanResult } from '../../services/documentScannerService';
import { useItemStore } from '../../store/itemStore';

export interface DocumentOcrModalProps {
  visible: boolean;
  docId: string;
  docTitle: string;
  isScanning: boolean;
  scanResult: DocumentScanResult | null;
  onRetry: () => void;
  onClose: () => void;
}

export const DocumentOcrModal: React.FC<DocumentOcrModalProps> = ({
  visible,
  docId,
  docTitle,
  isScanning,
  scanResult,
  onRetry,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<'text' | 'metadata'>('text');
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState('');
  const [copied, setCopied] = useState(false);

  // Sync edited text when new result arrives
  React.useEffect(() => {
    if (scanResult?.extractedText) {
      setEditedText(scanResult.extractedText);
    }
  }, [scanResult?.extractedText]);

  const handleCopyText = async () => {
    const textToCopy = isEditing ? editedText : (scanResult?.extractedText || '');
    if (!textToCopy) return;

    await Clipboard.setStringAsync(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveEdits = () => {
    if (!docId) return;

    useItemStore.getState().updateDocument(docId, {
      extractedText: editedText.trim(),
      ocrStatus: 'completed',
    });

    setIsEditing(false);
    Alert.alert('Updated', 'Extracted document text was updated in your vault.');
  };

  return (
    <Modal visible={visible} transparent={false} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: Math.max(insets.top, 16) }]}>
        {/* Header Bar */}
        <View style={styles.header}>
          <View style={styles.headerTitleWrap}>
            <MaterialIcons name="document-scanner" size={20} color={SereneColors.primary} />
            <Text style={styles.headerTitle} numberOfLines={1}>
              {isScanning ? 'Scanning Document...' : 'Document Scan & OCR'}
            </Text>
          </View>

          <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.7}>
            <MaterialIcons name="close" size={22} color={SereneColors.onSurfaceVariant} />
          </TouchableOpacity>
        </View>

        {/* Content Area */}
        {isScanning ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={SereneColors.primary} />
            <Text style={styles.loadingTitle}>Analyzing Document</Text>
            <Text style={styles.loadingSubtitle}>
              Extracting text and structured details from {docTitle}...
            </Text>
            <View style={styles.stepBox}>
              <Text style={styles.stepText}>• Validating binary format integrity</Text>
              <Text style={styles.stepText}>• Scanning text streams and layout</Text>
              <Text style={styles.stepText}>• Reading line items and dates</Text>
            </View>
          </View>
        ) : !scanResult?.success ? (
          <View style={styles.errorContainer}>
            <MaterialIcons name="error-outline" size={48} color={SereneColors.error} />
            <Text style={styles.errorTitle}>Scan Incomplete</Text>
            <Text style={styles.errorSubtitle}>
              {scanResult?.error || 'We could not complete the OCR scan for this document.'}
            </Text>
            <Text style={styles.errorSafeNote}>
              Your original stored document remains 100% safe and intact in your vault.
            </Text>
            <TouchableOpacity style={styles.retryButton} onPress={onRetry} activeOpacity={0.8}>
              <MaterialIcons name="refresh" size={18} color="#FFFFFF" />
              <Text style={styles.retryButtonText}>Retry Scan</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.resultContainer}>
            {/* Meta Ribbon */}
            <View style={styles.metaRibbon}>
              <View style={styles.badgeWrap}>
                <View style={styles.statusBadge}>
                  <MaterialIcons name="check-circle" size={13} color="#166534" />
                  <Text style={styles.statusBadgeText}>OCR Complete</Text>
                </View>
                <View style={styles.formatBadge}>
                  <Text style={styles.formatBadgeText}>
                    {scanResult.sourceType.toUpperCase()} · {scanResult.pageCount}{' '}
                    {scanResult.pageCount === 1 ? 'Page' : 'Pages'}
                  </Text>
                </View>
                {scanResult.isNativePdfExtraction && (
                  <View style={styles.nativeBadge}>
                    <Text style={styles.nativeBadgeText}>Native Text Layer</Text>
                  </View>
                )}
              </View>

              <View style={styles.actionButtons}>
                <TouchableOpacity
                  style={styles.iconAction}
                  onPress={handleCopyText}
                  activeOpacity={0.7}
                  accessibilityLabel="Copy text"
                >
                  <MaterialIcons
                    name={copied ? 'done' : 'content-copy'}
                    size={16}
                    color={copied ? '#166534' : SereneColors.primary}
                  />
                  <Text style={[styles.actionText, copied && { color: '#166534' }]}>
                    {copied ? 'Copied' : 'Copy'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.iconAction}
                  onPress={() => {
                    if (isEditing) {
                      handleSaveEdits();
                    } else {
                      setIsEditing(true);
                    }
                  }}
                  activeOpacity={0.7}
                  accessibilityLabel="Edit text"
                >
                  <MaterialIcons
                    name={isEditing ? 'save' : 'edit'}
                    size={16}
                    color={SereneColors.primary}
                  />
                  <Text style={styles.actionText}>{isEditing ? 'Save' : 'Edit'}</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Tab Switcher */}
            <View style={styles.tabBar}>
              <TouchableOpacity
                style={[styles.tabItem, activeTab === 'text' && styles.tabItemActive]}
                onPress={() => setActiveTab('text')}
              >
                <Text
                  style={[styles.tabItemText, activeTab === 'text' && styles.tabItemTextActive]}
                >
                  Extracted Text
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabItem, activeTab === 'metadata' && styles.tabItemActive]}
                onPress={() => setActiveTab('metadata')}
              >
                <Text
                  style={[styles.tabItemText, activeTab === 'metadata' && styles.tabItemTextActive]}
                >
                  Identified Fields
                </Text>
              </TouchableOpacity>
            </View>

            {/* Tab 1: Extracted Text */}
            {activeTab === 'text' && (
              <ScrollView style={styles.scrollBody} contentContainerStyle={{ padding: 16 }}>
                {isEditing ? (
                  <TextInput
                    style={styles.textInput}
                    multiline
                    value={editedText}
                    onChangeText={setEditedText}
                    placeholder="Extracted text..."
                    placeholderTextColor="#94A3B8"
                    textAlignVertical="top"
                  />
                ) : (
                  <View style={styles.textCard}>
                    <Text style={styles.extractedTextContent}>
                      {editedText || 'No text extracted from this document.'}
                    </Text>
                  </View>
                )}
              </ScrollView>
            )}

            {/* Tab 2: Structured Metadata */}
            {activeTab === 'metadata' && (
              <ScrollView style={styles.scrollBody} contentContainerStyle={{ padding: 16, gap: 12 }}>
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Issuer / Merchant</Text>
                  <Text style={styles.metaValue}>
                    {scanResult.metadata.issuerName || 'Not identified'}
                  </Text>
                </View>

                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Reference / Invoice #</Text>
                  <Text style={[styles.metaValue, styles.monoText]}>
                    {scanResult.metadata.referenceNumber || 'Not identified'}
                  </Text>
                </View>

                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Document Date</Text>
                  <Text style={styles.metaValue}>
                    {scanResult.metadata.documentDate || 'Not identified'}
                  </Text>
                </View>

                {scanResult.metadata.expiryDate && (
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Expiry Date</Text>
                    <Text style={styles.metaValue}>{scanResult.metadata.expiryDate}</Text>
                  </View>
                )}

                {scanResult.metadata.amount != null && (
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Detected Amount</Text>
                    <Text style={[styles.metaValue, { color: '#047857', fontWeight: 'bold' }]}>
                      ₹{scanResult.metadata.amount}
                    </Text>
                  </View>
                )}

                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Classification</Text>
                  <Text style={styles.metaValue}>
                    {scanResult.metadata.category || 'General Document'} ·{' '}
                    {scanResult.metadata.documentType || 'Standard'}
                  </Text>
                </View>
              </ScrollView>
            )}
          </View>
        )}

        {/* Footer */}
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <TouchableOpacity style={styles.closeFooterButton} onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.closeFooterText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: SereneColors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: SereneColors.hairlineBorder,
    backgroundColor: SereneColors.surface,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: SereneColors.onSurface,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: SereneColors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  loadingTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: SereneColors.onSurface,
    marginTop: 8,
  },
  loadingSubtitle: {
    fontSize: 13,
    color: SereneColors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 18,
  },
  stepBox: {
    marginTop: 16,
    gap: 6,
    backgroundColor: SereneColors.surfaceContainerLowest,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: SereneColors.subtleBorder,
    width: '100%',
    maxWidth: 280,
  },
  stepText: {
    fontSize: 12,
    color: SereneColors.onSurfaceVariant,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: SereneColors.error,
  },
  errorSubtitle: {
    fontSize: 13,
    color: SereneColors.onSurfaceVariant,
    textAlign: 'center',
  },
  errorSafeNote: {
    fontSize: 12,
    color: SereneColors.primary,
    textAlign: 'center',
    marginTop: 4,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: SereneColors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    marginTop: 12,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
  resultContainer: {
    flex: 1,
  },
  metaRibbon: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: SereneColors.surfaceContainerLowest,
    borderBottomWidth: 1,
    borderBottomColor: SereneColors.hairlineBorder,
  },
  badgeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusBadgeText: {
    color: '#166534',
    fontSize: 11,
    fontWeight: 'bold',
  },
  formatBadge: {
    backgroundColor: SereneColors.surfaceContainerHigh,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  formatBadgeText: {
    color: SereneColors.onSurfaceVariant,
    fontSize: 11,
    fontWeight: '600',
  },
  nativeBadge: {
    backgroundColor: '#E0E7FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  nativeBadgeText: {
    color: '#4338CA',
    fontSize: 11,
    fontWeight: '600',
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '600',
    color: SereneColors.primary,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: SereneColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: SereneColors.hairlineBorder,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: SereneColors.primary,
  },
  tabItemText: {
    fontSize: 13,
    fontWeight: '600',
    color: SereneColors.onSurfaceVariant,
  },
  tabItemTextActive: {
    color: SereneColors.primary,
    fontWeight: 'bold',
  },
  scrollBody: {
    flex: 1,
  },
  textCard: {
    backgroundColor: SereneColors.surfaceContainerLowest,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: SereneColors.hairlineBorder,
  },
  extractedTextContent: {
    fontSize: 13,
    color: SereneColors.onSurface,
    lineHeight: 20,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  textInput: {
    backgroundColor: SereneColors.surfaceContainerLowest,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: SereneColors.primary,
    fontSize: 13,
    color: SereneColors.onSurface,
    minHeight: 280,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  metaRow: {
    backgroundColor: SereneColors.surfaceContainerLowest,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: SereneColors.hairlineBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaLabel: {
    fontSize: 12,
    color: SereneColors.onSurfaceVariant,
    fontWeight: '500',
  },
  metaValue: {
    fontSize: 13,
    color: SereneColors.onSurface,
    fontWeight: '600',
  },
  monoText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  footer: {
    padding: 16,
    backgroundColor: SereneColors.surface,
    borderTopWidth: 1,
    borderTopColor: SereneColors.hairlineBorder,
  },
  closeFooterButton: {
    backgroundColor: SereneColors.primary,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  closeFooterText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
