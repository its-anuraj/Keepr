// ==============================================================================
// KEEPR DIGITAL OWNERSHIP VAULT: Service & Repair Details Screen
// Displays detailed records of maintenance, repairs, inspections, and parts.
// Supports editing, permanent deletion with confirmation, and document linking.
// ==============================================================================

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  Linking,
  Modal,
  TextInput,
  Pressable,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Header } from '../../src/components/ui/Header';
import { SereneColors } from '../../src/constants/theme';
import { useItemStore } from '../../src/store/itemStore';
import { formatCurrency, formatDate } from '../../src/utils/currency';

export default function ServiceDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const getMaintenanceRecordById = useItemStore((s) => s.getMaintenanceRecordById);
  const getItemById = useItemStore((s) => s.getItemById);
  const getDocumentById = useItemStore((s) => s.getDocumentById);
  const deleteMaintenanceRecord = useItemStore((s) => s.deleteMaintenanceRecord);
  const updateMaintenanceRecord = useItemStore((s) => s.updateMaintenanceRecord);
  const items = useItemStore((s) => s.items);

  const record = getMaintenanceRecordById(id);
  const item = record?.itemId ? getItemById(record.itemId) : null;

  const [isDeleting, setIsDeleting] = useState(false);
  const [showItemPickerModal, setShowItemPickerModal] = useState(false);
  const [itemSearchQuery, setItemSearchQuery] = useState('');

  const filteredItems = useMemo(() => {
    if (!itemSearchQuery.trim()) return items;
    const q = itemSearchQuery.toLowerCase().trim();
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.brand && i.brand.toLowerCase().includes(q)) ||
        (i.model && i.model.toLowerCase().includes(q))
    );
  }, [items, itemSearchQuery]);

  const handleUnlinkItem = () => {
    if (!record) return;
    Alert.alert(
      'Unlink Purchased Item',
      `Do you want to unlink "${item?.name || 'Item'}" from this service record? It will remain preserved as a standalone service record in Keepr.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlink',
          onPress: async () => {
            await updateMaintenanceRecord(record.id, { itemId: null });
          },
        },
      ]
    );
  };

  const handleLinkItem = async (targetItemId: string | null) => {
    if (!record) return;
    await updateMaintenanceRecord(record.id, { itemId: targetItemId });
    setShowItemPickerModal(false);
  };

  if (!record) {
    return (
      <View style={{ flex: 1, backgroundColor: SereneColors.surface, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View style={{ backgroundColor: '#fff', padding: 24, borderRadius: 16, alignItems: 'center', maxWidth: 320, width: '100%', borderWidth: 1, borderColor: SereneColors.subtleBorder }}>
          <MaterialIcons name="handyman" size={32} color={SereneColors.outline} style={{ marginBottom: 8 }} />
          <Text style={{ fontSize: 16, fontWeight: '700', color: SereneColors.onSurface, marginBottom: 4 }}>
            Record Not Found
          </Text>
          <Text style={{ fontSize: 12, color: SereneColors.onSurfaceVariant, textAlign: 'center', marginBottom: 16 }}>
            This service record may have been deleted.
          </Text>
          <TouchableOpacity
            style={{ backgroundColor: SereneColors.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 }}
            onPress={() => router.back()}
          >
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#fff' }}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const handleDelete = () => {
    Alert.alert(
      'Delete service record?',
      'This service record will be permanently deleted and cannot be recovered.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Permanently',
          style: 'destructive',
          onPress: async () => {
            setIsDeleting(true);
            try {
              await deleteMaintenanceRecord(record.id);
              if (item?.id) {
                router.replace(`/item/${item.id}` as any);
              } else {
                router.back();
              }
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Failed to delete service record.');
              setIsDeleting(false);
            }
          },
        },
      ]
    );
  };

  const handleEdit = () => {
    router.push(`/service/add?editId=${record.id}` as any);
  };

  const isWarrantyCovered = record.warrantyCovered === 'yes';
  const effectiveCost = record.amountPaid != null ? record.amountPaid : record.cost;

  // Attached documents
  const attachedDocs = (record.documentIds || [])
    .map((docId) => getDocumentById(docId))
    .filter(Boolean);

  return (
    <View style={{ flex: 1, backgroundColor: SereneColors.surface }}>
      <Header
        title="Service Details"
        showBack
        rightAction={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <TouchableOpacity
              onPress={handleEdit}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: 'rgba(17,80,134,0.08)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              accessibilityLabel="Edit service record"
            >
              <MaterialIcons name="edit" size={17} color={SereneColors.primary} />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleDelete}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: 'rgba(186,26,26,0.08)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              accessibilityLabel="Delete service record"
            >
              <MaterialIcons name="delete-outline" size={18} color={SereneColors.error} />
            </TouchableOpacity>
          </View>
        }
      />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 50, gap: 14, paddingTop: 10 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Linked Purchased Item Banner */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: item ? 'rgba(17,80,134,0.06)' : 'rgba(100,116,139,0.06)',
            borderColor: item ? 'rgba(17,80,134,0.18)' : 'rgba(100,116,139,0.18)',
            borderWidth: 1,
            borderRadius: 14,
            padding: 12,
          }}
        >
          <TouchableOpacity
            onPress={() => item && router.push(`/item/${item.id}` as any)}
            activeOpacity={item ? 0.75 : 1}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}
          >
            <MaterialIcons
              name="inventory-2"
              size={20}
              color={item ? SereneColors.primary : SereneColors.onSurfaceVariant}
            />
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: '700',
                  color: item ? SereneColors.primary : SereneColors.onSurfaceVariant,
                  letterSpacing: 0.5,
                }}
              >
                {item ? 'LINKED PURCHASED ITEM' : 'UNLINKED SERVICE RECORD'}
              </Text>
              <Text
                style={{ fontSize: 14, fontWeight: '700', color: SereneColors.onSurface }}
                numberOfLines={1}
              >
                {item ? item.name : 'No Item Linked (Standalone)'}
              </Text>
              {item && (item.brand || item.model) ? (
                <Text
                  style={{ fontSize: 11, color: SereneColors.onSurfaceVariant }}
                  numberOfLines={1}
                >
                  {item.brand ? `${item.brand} ` : ''}
                  {item.model ? `(${item.model})` : ''}
                </Text>
              ) : null}
            </View>
          </TouchableOpacity>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <TouchableOpacity
              onPress={() => {
                setItemSearchQuery('');
                setShowItemPickerModal(true);
              }}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 8,
                backgroundColor: 'rgba(17,80,134,0.10)',
              }}
              activeOpacity={0.8}
            >
              <Text style={{ fontSize: 11, fontWeight: '700', color: SereneColors.primary }}>
                {item ? 'Change' : 'Link Item'}
              </Text>
            </TouchableOpacity>

            {item && (
              <TouchableOpacity
                onPress={handleUnlinkItem}
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 6,
                  borderRadius: 8,
                  backgroundColor: 'rgba(186,26,26,0.08)',
                }}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 11, fontWeight: '700', color: SereneColors.error }}>
                  Unlink
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Primary Summary Card */}
        <View style={cardStyle}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                backgroundColor: 'rgba(17,80,134,0.10)',
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 20,
              }}
            >
              <MaterialIcons name="build" size={13} color={SereneColors.primary} />
              <Text style={{ fontSize: 11, fontWeight: '700', color: SereneColors.primary }}>
                {record.serviceType || 'Service'}
              </Text>
            </View>

            <Text style={{ fontSize: 12, color: SereneColors.onSurfaceVariant, fontWeight: '500' }}>
              {formatDate(record.serviceDate, 'full')}
            </Text>
          </View>

          <Text style={{ fontSize: 20, fontWeight: '700', color: SereneColors.onSurface, marginTop: 4 }}>
            {record.title}
          </Text>

          {/* Cost & Coverage Pill */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: isWarrantyCovered ? '#F0FDF4' : SereneColors.surfaceContainerLow,
              borderWidth: 1,
              borderColor: isWarrantyCovered ? '#BBF7D0' : SereneColors.subtleBorder,
              padding: 12,
              borderRadius: 10,
              marginTop: 6,
            }}
          >
            <View>
              <Text style={{ fontSize: 11, color: SereneColors.onSurfaceVariant }}>
                {isWarrantyCovered ? 'Warranty Status' : 'Amount Paid'}
              </Text>
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: '700',
                  color: isWarrantyCovered ? '#15803D' : SereneColors.onSurface,
                  marginTop: 1,
                }}
              >
                {isWarrantyCovered ? 'Covered under warranty' : formatCurrency(effectiveCost, record.currency || 'INR')}
              </Text>
            </View>

            {record.coverageType ? (
              <View style={{ backgroundColor: '#fff', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: SereneColors.subtleBorder }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: SereneColors.primary }}>
                  {record.coverageType}
                </Text>
              </View>
            ) : null}
          </View>

          {record.coverageReferenceNumber ? (
            <Text style={{ fontSize: 11, color: SereneColors.onSurfaceVariant, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }}>
              Claim / Service Ref: #{record.coverageReferenceNumber}
            </Text>
          ) : null}
        </View>

        {/* Problem Description Card */}
        {record.problemDescription ? (
          <View style={cardStyle}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MaterialIcons name="report-problem" size={17} color="#D97706" />
              <Text style={sectionTitleStyle}>Problem Reported</Text>
            </View>
            <Text style={{ fontSize: 13, color: SereneColors.onSurface, lineHeight: 20 }}>
              {record.problemDescription}
            </Text>
          </View>
        ) : null}

        {/* Work Performed Card */}
        {record.workPerformed ? (
          <View style={cardStyle}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MaterialIcons name="done-all" size={17} color={SereneColors.primary} />
              <Text style={sectionTitleStyle}>Work Performed</Text>
            </View>
            <Text style={{ fontSize: 13, color: SereneColors.onSurface, lineHeight: 20 }}>
              {record.workPerformed}
            </Text>
          </View>
        ) : null}

        {/* Parts Replaced Card */}
        {record.partsReplaced ? (
          <View style={cardStyle}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MaterialIcons name="extension" size={17} color={SereneColors.primary} />
              <Text style={sectionTitleStyle}>Parts Replaced</Text>
            </View>
            <Text style={{ fontSize: 13, color: SereneColors.onSurface, lineHeight: 20 }}>
              {record.partsReplaced}
            </Text>
          </View>
        ) : null}

        {/* Service Provider Card */}
        {(record.serviceProvider || record.serviceProviderPhone || record.serviceProviderAddress) && (
          <View style={cardStyle}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MaterialIcons name="store" size={17} color={SereneColors.primary} />
              <Text style={sectionTitleStyle}>Service Provider</Text>
            </View>

            {record.serviceProvider ? (
              <Text style={{ fontSize: 15, fontWeight: '700', color: SereneColors.onSurface }}>
                {record.serviceProvider}
              </Text>
            ) : null}

            {record.serviceProviderAddress ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MaterialIcons name="place" size={15} color={SereneColors.outline} />
                <Text style={{ fontSize: 12, color: SereneColors.onSurfaceVariant, flex: 1 }}>
                  {record.serviceProviderAddress}
                </Text>
              </View>
            ) : null}

            {record.serviceProviderPhone ? (
              <TouchableOpacity
                onPress={() => Linking.openURL(`tel:${record.serviceProviderPhone}`)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
              >
                <MaterialIcons name="phone" size={15} color={SereneColors.primary} />
                <Text style={{ fontSize: 13, color: SereneColors.primary, fontWeight: '600' }}>
                  {record.serviceProviderPhone}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {/* Post-Service Protection Card */}
        {(record.postServiceWarranty || record.postServiceGuarantee) && (
          <View style={cardStyle}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MaterialIcons name="verified-user" size={17} color={SereneColors.primary} />
              <Text style={sectionTitleStyle}>Post-Service Protection</Text>
            </View>

            {record.postServiceWarranty && record.postServiceWarrantyUntil ? (
              <View style={{ backgroundColor: 'rgba(17,80,134,0.06)', padding: 10, borderRadius: 8, gap: 2 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: SereneColors.primary }}>
                  REPAIR WARRANTY
                </Text>
                <Text style={{ fontSize: 13, fontWeight: '600', color: SereneColors.onSurface }}>
                  Valid until {formatDate(record.postServiceWarrantyUntil, 'full')}
                </Text>
              </View>
            ) : null}

            {record.postServiceGuarantee && record.postServiceGuaranteeUntil ? (
              <View style={{ backgroundColor: '#F0FDF4', padding: 10, borderRadius: 8, gap: 2 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#15803D' }}>
                  SERVICE GUARANTEE
                </Text>
                <Text style={{ fontSize: 13, fontWeight: '600', color: SereneColors.onSurface }}>
                  Valid until {formatDate(record.postServiceGuaranteeUntil, 'full')}
                </Text>
              </View>
            ) : null}
          </View>
        )}

        {/* Attached Documents */}
        {attachedDocs.length > 0 && (
          <View style={cardStyle}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MaterialIcons name="attach-file" size={17} color={SereneColors.primary} />
              <Text style={sectionTitleStyle}>Attached Documents ({attachedDocs.length})</Text>
            </View>

            <View style={{ gap: 8 }}>
              {attachedDocs.map((doc: any) => (
                <TouchableOpacity
                  key={doc.id}
                  onPress={() => router.push(`/document/${doc.id}` as any)}
                  activeOpacity={0.8}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 10,
                    borderRadius: 10,
                    backgroundColor: SereneColors.surfaceContainerLow,
                    borderWidth: 1,
                    borderColor: SereneColors.subtleBorder,
                  }}
                >
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: SereneColors.onSurface }} numberOfLines={1}>
                      {doc.title}
                    </Text>
                    <Text style={{ fontSize: 10, color: SereneColors.onSurfaceVariant }}>
                      {doc.documentType} {doc.documentDate ? `· ${formatDate(doc.documentDate)}` : ''}
                    </Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={18} color={SereneColors.outline} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Additional Notes Card */}
        {record.notes ? (
          <View style={cardStyle}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MaterialIcons name="notes" size={17} color={SereneColors.primary} />
              <Text style={sectionTitleStyle}>Technician / Service Notes</Text>
            </View>
            <Text style={{ fontSize: 13, color: SereneColors.onSurfaceVariant, lineHeight: 19 }}>
              {record.notes}
            </Text>
          </View>
        ) : null}

        {/* Action Buttons */}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
          <TouchableOpacity
            onPress={handleEdit}
            style={{
              flex: 1,
              backgroundColor: SereneColors.primary,
              paddingVertical: 12,
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 6,
            }}
            activeOpacity={0.85}
          >
            <MaterialIcons name="edit" size={16} color="#fff" />
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>Edit Record</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleDelete}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderRadius: 10,
              backgroundColor: 'rgba(186,26,26,0.08)',
              borderWidth: 1,
              borderColor: 'rgba(186,26,26,0.2)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            activeOpacity={0.85}
          >
            <MaterialIcons name="delete-outline" size={18} color={SereneColors.error} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Item Picker Modal */}
      <Modal
        visible={showItemPickerModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowItemPickerModal(false)}
      >
        <Pressable
          style={{
            flex: 1,
            backgroundColor: 'rgba(15,23,42,0.55)',
            justifyContent: 'flex-end',
          }}
          onPress={() => setShowItemPickerModal(false)}
        >
          <Pressable
            style={{
              backgroundColor: '#FFFFFF',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              maxHeight: '80%',
              paddingTop: 12,
              paddingBottom: Platform.OS === 'ios' ? 36 : 24,
              paddingHorizontal: 20,
              gap: 12,
            }}
            onPress={(e) => e.stopPropagation()}
          >
            <View
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                backgroundColor: '#CBD5E1',
                alignSelf: 'center',
                marginBottom: 4,
              }}
            />

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <View>
                <Text style={{ fontSize: 17, fontWeight: '700', color: SereneColors.onSurface }}>
                  Link to Purchased Item
                </Text>
                <Text style={{ fontSize: 12, color: SereneColors.onSurfaceVariant }}>
                  Select the item this service or repair was performed on
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowItemPickerModal(false)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: SereneColors.surfaceContainerHigh,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MaterialIcons name="close" size={18} color={SereneColors.onSurfaceVariant} />
              </TouchableOpacity>
            </View>

            {/* Search Input */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: '#F1F5F9',
                borderRadius: 10,
                paddingHorizontal: 10,
                height: 40,
                gap: 8,
              }}
            >
              <MaterialIcons name="search" size={18} color={SereneColors.onSurfaceVariant} />
              <TextInput
                style={{ flex: 1, fontSize: 13, color: SereneColors.onSurface }}
                placeholder="Search your items..."
                placeholderTextColor={SereneColors.onSurfaceVariant}
                value={itemSearchQuery}
                onChangeText={setItemSearchQuery}
              />
              {itemSearchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setItemSearchQuery('')}>
                  <MaterialIcons name="cancel" size={16} color={SereneColors.onSurfaceVariant} />
                </TouchableOpacity>
              )}
            </View>

            {/* Items List */}
            <ScrollView
              style={{ maxHeight: 320 }}
              contentContainerStyle={{ gap: 8 }}
              showsVerticalScrollIndicator={false}
            >
              {/* Unlink Option */}
              <TouchableOpacity
                onPress={() => handleLinkItem(null)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: !record.itemId ? SereneColors.primary : '#E2E8F0',
                  backgroundColor: !record.itemId ? 'rgba(17,80,134,0.06)' : '#F8FAFC',
                }}
                activeOpacity={0.8}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    backgroundColor: '#E2E8F0',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MaterialIcons name="link-off" size={18} color="#64748B" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: SereneColors.onSurface }}>
                    Keep Unlinked (Standalone)
                  </Text>
                  <Text style={{ fontSize: 11, color: SereneColors.onSurfaceVariant }}>
                    Do not associate with any item
                  </Text>
                </View>
                {!record.itemId && (
                  <MaterialIcons name="check" size={18} color={SereneColors.primary} />
                )}
              </TouchableOpacity>

              {filteredItems.map((it) => {
                const isSelected = record.itemId === it.id;
                return (
                  <TouchableOpacity
                    key={it.id}
                    onPress={() => handleLinkItem(it.id)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      padding: 12,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: isSelected ? SereneColors.primary : '#E2E8F0',
                      backgroundColor: isSelected ? 'rgba(17,80,134,0.06)' : '#FFFFFF',
                    }}
                    activeOpacity={0.8}
                  >
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 8,
                        backgroundColor: 'rgba(17,80,134,0.08)',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <MaterialIcons name="inventory-2" size={18} color={SereneColors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{ fontSize: 14, fontWeight: '600', color: SereneColors.onSurface }}
                        numberOfLines={1}
                      >
                        {it.name}
                      </Text>
                      <Text style={{ fontSize: 11, color: SereneColors.onSurfaceVariant }} numberOfLines={1}>
                        {it.brand ? `${it.brand} ` : ''}
                        {it.model ? `(${it.model})` : ''}
                      </Text>
                    </View>
                    {isSelected && (
                      <MaterialIcons name="check" size={18} color={SereneColors.primary} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const cardStyle = {
  backgroundColor: SereneColors.surfaceContainerLowest,
  borderRadius: 14,
  padding: 14,
  borderWidth: 1,
  borderColor: SereneColors.subtleBorder,
  gap: 10,
  ...Platform.select({
    ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3 },
    android: { elevation: 1 },
  }),
};

const sectionTitleStyle = {
  fontSize: 14,
  fontWeight: '700' as const,
  color: SereneColors.onSurface,
};
