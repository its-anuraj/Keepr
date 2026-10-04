// ==============================================================================
// KEEPR DIGITAL OWNERSHIP VAULT: Add / Edit Service & Repair Screen
// Canonical Service & Repair record creation and editing for Purchased Items.
// Strictly user-scoped, offline-sync enabled, with genuine date reminder support.
// ==============================================================================

import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Switch,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Header } from '../../src/components/ui/Header';
import { SereneColors } from '../../src/constants/theme';
import { useItemStore } from '../../src/store/itemStore';
import { ServiceType, WarrantyCoverageStatus, MaintenanceRecord } from '../../src/types';
import { formatCurrency, formatDate } from '../../src/utils/currency';
import { persistDocumentToVault } from '../../src/services/receiptFileService';

const SERVICE_TYPES: { type: ServiceType; label: string; icon: string }[] = [
  { type: 'Repair', label: 'Repair', icon: 'build' },
  { type: 'Maintenance', label: 'Maintenance', icon: 'handyman' },
  { type: 'Servicing', label: 'Servicing', icon: 'car-repair' },
  { type: 'Inspection', label: 'Inspection', icon: 'search' },
  { type: 'Part Replacement', label: 'Part Replacement', icon: 'extension' },
  { type: 'Software / Technical', label: 'Software / Tech', icon: 'memory' },
  { type: 'Cleaning', label: 'Cleaning', icon: 'cleaning-services' },
  { type: 'Other', label: 'Other', icon: 'more-horiz' },
];

export default function AddServiceScreen() {
  const params = useLocalSearchParams<{
    itemId?: string;
    editId?: string;
  }>();

  const getItemById = useItemStore((s) => s.getItemById);
  const getMaintenanceRecordById = useItemStore((s) => s.getMaintenanceRecordById);
  const addMaintenanceRecord = useItemStore((s) => s.addMaintenanceRecord);
  const updateMaintenanceRecord = useItemStore((s) => s.updateMaintenanceRecord);
  const getDocumentsByItemId = useItemStore((s) => s.getDocumentsByItemId);
  const addDocument = useItemStore((s) => s.addDocument);

  const editRecord: MaintenanceRecord | undefined = params.editId
    ? getMaintenanceRecordById(params.editId)
    : undefined;

  const targetItemId = editRecord?.itemId || params.itemId || '';
  const item = getItemById(targetItemId);
  const linkedDocs = targetItemId ? getDocumentsByItemId(targetItemId) : [];

  const isEditing = Boolean(editRecord);

  // Form State
  const [title, setTitle] = useState(editRecord?.title || '');
  const [serviceType, setServiceType] = useState<ServiceType>(
    (editRecord?.serviceType as ServiceType) || 'Repair'
  );
  const [serviceDate, setServiceDate] = useState(
    editRecord?.serviceDate || new Date().toISOString().split('T')[0]
  );
  const [problemDescription, setProblemDescription] = useState(
    editRecord?.problemDescription || editRecord?.description || ''
  );
  const [workPerformed, setWorkPerformed] = useState(editRecord?.workPerformed || '');
  const [partsReplaced, setPartsReplaced] = useState(editRecord?.partsReplaced || '');
  const [serviceProvider, setServiceProvider] = useState(editRecord?.serviceProvider || '');
  const [serviceProviderAddress, setServiceProviderAddress] = useState(
    editRecord?.serviceProviderAddress || ''
  );
  const [serviceProviderPhone, setServiceProviderPhone] = useState(
    editRecord?.serviceProviderPhone || ''
  );

  const [warrantyCovered, setWarrantyCovered] = useState<WarrantyCoverageStatus>(
    editRecord?.warrantyCovered || 'unknown'
  );
  const [coverageType, setCoverageType] = useState(editRecord?.coverageType || '');
  const [coverageReferenceNumber, setCoverageReferenceNumber] = useState(
    editRecord?.coverageReferenceNumber || ''
  );
  const [amountPaid, setAmountPaid] = useState(
    editRecord ? String(editRecord.amountPaid != null ? editRecord.amountPaid : editRecord.cost) : ''
  );

  const [hasPostWarranty, setHasPostWarranty] = useState(
    Boolean(editRecord?.postServiceWarranty && editRecord?.postServiceWarrantyUntil)
  );
  const [postServiceWarrantyUntil, setPostServiceWarrantyUntil] = useState(
    editRecord?.postServiceWarrantyUntil || ''
  );

  const [hasPostGuarantee, setHasPostGuarantee] = useState(
    Boolean(editRecord?.postServiceGuarantee && editRecord?.postServiceGuaranteeUntil)
  );
  const [postServiceGuaranteeUntil, setPostServiceGuaranteeUntil] = useState(
    editRecord?.postServiceGuaranteeUntil || ''
  );

  const [selectedDocIds, setSelectedDocIds] = useState<string[]>(
    editRecord?.documentIds || []
  );
  const [isAttachingDoc, setIsAttachingDoc] = useState(false);
  const [technicianNotes, setTechnicianNotes] = useState(editRecord?.technicianNotes || '');
  const [notes, setNotes] = useState(editRecord?.notes || '');

  const handleAttachFromPicker = async (source: 'camera' | 'gallery' | 'pdf') => {
    try {
      let fileUri: string | null = null;
      let fileName = 'Service_Document.jpg';
      let mimeType = 'image/jpeg';
      let base64: string | null | undefined = null;

      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Permission Required', 'Camera access is required to take photos of documents.');
          return;
        }
        const res = await ImagePicker.launchCameraAsync({
          quality: 0.85,
          base64: true,
        });
        if (res.canceled || !res.assets?.[0]) return;
        fileUri = res.assets[0].uri;
        fileName = res.assets[0].fileName || `Service_Doc_${Date.now()}.jpg`;
        mimeType = res.assets[0].mimeType || 'image/jpeg';
        base64 = res.assets[0].base64;
      } else if (source === 'gallery') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Permission Required', 'Gallery access is required to select photos.');
          return;
        }
        const res = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.85,
          base64: true,
        });
        if (res.canceled || !res.assets?.[0]) return;
        fileUri = res.assets[0].uri;
        fileName = res.assets[0].fileName || `Service_Doc_${Date.now()}.jpg`;
        mimeType = res.assets[0].mimeType || 'image/jpeg';
        base64 = res.assets[0].base64;
      } else if (source === 'pdf') {
        const res = await DocumentPicker.getDocumentAsync({
          type: ['application/pdf', 'image/*'],
          copyToCacheDirectory: true,
        });
        if (res.canceled || !res.assets?.[0]) return;
        fileUri = res.assets[0].uri;
        fileName = res.assets[0].name || `Service_Doc_${Date.now()}.pdf`;
        mimeType = res.assets[0].mimeType || 'application/pdf';
      }

      if (!fileUri) return;

      setIsAttachingDoc(true);
      const persisted = await persistDocumentToVault(fileUri, fileName, base64);
      if (!persisted.persisted || !persisted.uri) {
        throw new Error(persisted.error || 'Failed to save document to permanent vault storage.');
      }

      const parsedAmount = amountPaid.trim() ? parseFloat(amountPaid.replace(/[^0-9.]/g, '')) : 0;
      const cleanCost = isNaN(parsedAmount) ? 0 : parsedAmount;

      const createdDoc = await addDocument({
        title: `${title.trim() || serviceType} Invoice / Report`,
        category: 'Receipts & Invoices',
        documentType: 'Invoice',
        documentDate: serviceDate,
        itemId: targetItemId || undefined,
        filePath: persisted.uri,
        fileUrl: persisted.uri,
        storagePath: persisted.storagePath,
        fileSizeBytes: persisted.fileSize || 0,
        mimeType: mimeType,
        amount: cleanCost > 0 ? cleanCost : undefined,
      });

      setSelectedDocIds((prev) => [...prev, createdDoc.id]);
      Alert.alert('Attached', `"${createdDoc.title}" has been attached and preserved in your Document Vault.`);
    } catch (err: any) {
      Alert.alert('Attachment Failed', err?.message || 'Could not attach the file.');
    } finally {
      setIsAttachingDoc(false);
    }
  };

  const promptAttachOptions = () => {
    Alert.alert(
      'Attach Document / Invoice',
      'Choose how to attach a service invoice, bill, or technician report:',
      [
        { text: 'Take Photo', onPress: () => handleAttachFromPicker('camera') },
        { text: 'Choose from Photos', onPress: () => handleAttachFromPicker('gallery') },
        { text: 'Select PDF File', onPress: () => handleAttachFromPicker('pdf') },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!title.trim()) {
      errs.title = 'Please enter a service title or problem summary.';
    }
    if (!serviceDate.trim() || isNaN(new Date(serviceDate).getTime())) {
      errs.serviceDate = 'Please enter a valid service date (YYYY-MM-DD).';
    }
    if (hasPostWarranty && postServiceWarrantyUntil) {
      if (isNaN(new Date(postServiceWarrantyUntil).getTime())) {
        errs.postServiceWarrantyUntil = 'Please enter a valid date (YYYY-MM-DD).';
      }
    }
    if (hasPostGuarantee && postServiceGuaranteeUntil) {
      if (isNaN(new Date(postServiceGuaranteeUntil).getTime())) {
        errs.postServiceGuaranteeUntil = 'Please enter a valid date (YYYY-MM-DD).';
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    if (!targetItemId) {
      Alert.alert('Error', 'No associated purchased item found for this service record.');
      return;
    }

    setIsSubmitting(true);
    try {
      const parsedAmount = amountPaid.trim() ? parseFloat(amountPaid.replace(/[^0-9.]/g, '')) : 0;
      const cleanCost = isNaN(parsedAmount) ? 0 : parsedAmount;

      const recordPayload = {
        itemId: targetItemId,
        title: title.trim(),
        serviceType,
        serviceDate: serviceDate.trim(),
        description: problemDescription.trim() || undefined,
        problemDescription: problemDescription.trim() || undefined,
        workPerformed: workPerformed.trim() || undefined,
        partsReplaced: partsReplaced.trim() || undefined,
        technicianNotes: technicianNotes.trim() || undefined,
        serviceProvider: serviceProvider.trim() || undefined,
        serviceProviderAddress: serviceProviderAddress.trim() || undefined,
        serviceProviderPhone: serviceProviderPhone.trim() || undefined,
        cost: cleanCost,
        amountPaid: cleanCost,
        currency: item?.currency || 'INR',
        warrantyCovered,
        coverageType: coverageType.trim() || undefined,
        coverageReferenceNumber: coverageReferenceNumber.trim() || undefined,
        postServiceWarranty: hasPostWarranty && Boolean(postServiceWarrantyUntil.trim()),
        postServiceWarrantyUntil:
          hasPostWarranty && postServiceWarrantyUntil.trim() ? postServiceWarrantyUntil.trim() : null,
        postServiceGuarantee: hasPostGuarantee && Boolean(postServiceGuaranteeUntil.trim()),
        postServiceGuaranteeUntil:
          hasPostGuarantee && postServiceGuaranteeUntil.trim() ? postServiceGuaranteeUntil.trim() : null,
        documentIds: selectedDocIds,
        notes: notes.trim() || undefined,
        status: 'completed' as const,
      };

      if (isEditing && editRecord) {
        await updateMaintenanceRecord(editRecord.id, recordPayload);
        router.back();
      } else {
        const created = await addMaintenanceRecord(recordPayload);
        router.replace(`/service/${created.id}` as any);
      }
    } catch (err: any) {
      Alert.alert('Failed to Save', err?.message || 'Could not save the service record.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleDocLink = (docId: string) => {
    setSelectedDocIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: SereneColors.surface }}>
      <Header title={isEditing ? 'Edit Service Record' : 'Add Service & Repair'} showBack />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 50, gap: 14, paddingTop: 10 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Purchased Item Context Card (Read-only) */}
          {item && (
            <View
              style={{
                backgroundColor: 'rgba(17,80,134,0.06)',
                borderColor: 'rgba(17,80,134,0.18)',
                borderWidth: 1,
                borderRadius: 14,
                padding: 12,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  backgroundColor: '#fff',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  borderWidth: 1,
                  borderColor: SereneColors.subtleBorder,
                }}
              >
                {item.receiptUri && !item.receiptUri.toLowerCase().endsWith('.pdf') ? (
                  <Image source={{ uri: item.receiptUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                ) : (
                  <MaterialIcons name="inventory-2" size={22} color={SereneColors.primary} />
                )}
              </View>

              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: SereneColors.primary }}>
                  PURCHASED ITEM CONTEXT
                </Text>
                <Text style={{ fontSize: 14, fontWeight: '700', color: SereneColors.onSurface }} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={{ fontSize: 11, color: SereneColors.onSurfaceVariant }} numberOfLines={1}>
                  {item.brand ? `${item.brand} ` : ''}{item.model ? `(${item.model})` : ''}
                </Text>
              </View>
            </View>
          )}

          {/* Service Title & Date Card */}
          <View style={cardStyle}>
            <Text style={sectionTitleStyle}>Service Overview</Text>

            <View style={{ gap: 4 }}>
              <Text style={labelStyle}>Service Title / Summary</Text>
              <TextInput
                style={[inputStyle, errors.title ? { borderColor: SereneColors.error } : null]}
                placeholder="e.g. Keyboard repair, Battery replacement, 10,000 km Service"
                placeholderTextColor={SereneColors.outline}
                value={title}
                onChangeText={(t) => {
                  setTitle(t);
                  if (errors.title) setErrors((prev) => ({ ...prev, title: '' }));
                }}
              />
              {errors.title ? <Text style={errorTextStyle}>{errors.title}</Text> : null}
            </View>

            <View style={{ gap: 4 }}>
              <Text style={labelStyle}>Service Date (YYYY-MM-DD)</Text>
              <TextInput
                style={[inputStyle, errors.serviceDate ? { borderColor: SereneColors.error } : null]}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={SereneColors.outline}
                value={serviceDate}
                onChangeText={(t) => {
                  setServiceDate(t);
                  if (errors.serviceDate) setErrors((prev) => ({ ...prev, serviceDate: '' }));
                }}
              />
              {errors.serviceDate ? <Text style={errorTextStyle}>{errors.serviceDate}</Text> : null}
            </View>

            <View style={{ gap: 6, marginTop: 4 }}>
              <Text style={labelStyle}>Service Type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {SERVICE_TYPES.map((t) => {
                  const isSelected = serviceType === t.type;
                  return (
                    <TouchableOpacity
                      key={t.type}
                      onPress={() => setServiceType(t.type)}
                      activeOpacity={0.8}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 5,
                        paddingHorizontal: 12,
                        paddingVertical: 7,
                        borderRadius: 20,
                        backgroundColor: isSelected ? SereneColors.primary : SereneColors.surfaceContainerLow,
                        borderWidth: 1,
                        borderColor: isSelected ? SereneColors.primary : SereneColors.subtleBorder,
                      }}
                    >
                      <MaterialIcons
                        name={t.icon as any}
                        size={15}
                        color={isSelected ? '#fff' : SereneColors.onSurfaceVariant}
                      />
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: isSelected ? '700' : '500',
                          color: isSelected ? '#fff' : SereneColors.onSurface,
                        }}
                      >
                        {t.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </View>

          {/* Service Details Card */}
          <View style={cardStyle}>
            <Text style={sectionTitleStyle}>Diagnostic & Work Performed</Text>

            <View style={{ gap: 4 }}>
              <Text style={labelStyle}>Problem / Issue</Text>
              <TextInput
                style={[inputStyle, { minHeight: 64, textAlignVertical: 'top' }]}
                placeholder="What was the problem? (e.g. Spacebar key sticking, battery drains quickly)"
                placeholderTextColor={SereneColors.outline}
                multiline
                numberOfLines={3}
                value={problemDescription}
                onChangeText={setProblemDescription}
              />
            </View>

            <View style={{ gap: 4 }}>
              <Text style={labelStyle}>Work Performed</Text>
              <TextInput
                style={[inputStyle, { minHeight: 64, textAlignVertical: 'top' }]}
                placeholder="What was done? (e.g. Keyboard assembly replaced, system diagnostics run)"
                placeholderTextColor={SereneColors.outline}
                multiline
                numberOfLines={3}
                value={workPerformed}
                onChangeText={setWorkPerformed}
              />
            </View>

            <View style={{ gap: 4 }}>
              <Text style={labelStyle}>Parts Replaced</Text>
              <TextInput
                style={inputStyle}
                placeholder="e.g. Top case with battery, OEM Display unit"
                placeholderTextColor={SereneColors.outline}
                value={partsReplaced}
                onChangeText={setPartsReplaced}
              />
            </View>
          </View>

          {/* Service Provider Card */}
          <View style={cardStyle}>
            <Text style={sectionTitleStyle}>Service Provider / Technician</Text>

            <View style={{ gap: 4 }}>
              <Text style={labelStyle}>Service Center / Provider Name</Text>
              <TextInput
                style={inputStyle}
                placeholder="e.g. Apple Authorized Service Center, Local Mechanic"
                placeholderTextColor={SereneColors.outline}
                value={serviceProvider}
                onChangeText={setServiceProvider}
              />
            </View>

            <View style={{ gap: 4 }}>
              <Text style={labelStyle}>Address / Location</Text>
              <TextInput
                style={inputStyle}
                placeholder="e.g. Connaught Place, New Delhi"
                placeholderTextColor={SereneColors.outline}
                value={serviceProviderAddress}
                onChangeText={setServiceProviderAddress}
              />
            </View>

            <View style={{ gap: 4 }}>
              <Text style={labelStyle}>Contact Phone / Support Number</Text>
              <TextInput
                style={inputStyle}
                placeholder="e.g. +91 98765 43210"
                placeholderTextColor={SereneColors.outline}
                keyboardType="phone-pad"
                value={serviceProviderPhone}
                onChangeText={setServiceProviderPhone}
              />
            </View>
          </View>

          {/* Warranty & Cost Card */}
          <View style={cardStyle}>
            <Text style={sectionTitleStyle}>Warranty & Cost</Text>

            <View style={{ gap: 6 }}>
              <Text style={labelStyle}>Warranty Coverage</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {[
                  { value: 'yes', label: 'Covered' },
                  { value: 'no', label: 'Not Covered' },
                  { value: 'unknown', label: 'Unknown' },
                ].map((opt) => {
                  const isSel = warrantyCovered === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      onPress={() => setWarrantyCovered(opt.value as WarrantyCoverageStatus)}
                      activeOpacity={0.8}
                      style={{
                        flex: 1,
                        paddingVertical: 9,
                        borderRadius: 10,
                        backgroundColor: isSel ? 'rgba(17,80,134,0.12)' : SereneColors.surfaceContainerLow,
                        borderWidth: 1.5,
                        borderColor: isSel ? SereneColors.primary : SereneColors.subtleBorder,
                        alignItems: 'center',
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: isSel ? '700' : '500',
                          color: isSel ? SereneColors.primary : SereneColors.onSurface,
                        }}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={{ gap: 4 }}>
              <Text style={labelStyle}>Amount Paid (₹)</Text>
              <TextInput
                style={inputStyle}
                placeholder="e.g. 0 (if covered) or 4500"
                placeholderTextColor={SereneColors.outline}
                keyboardType="numeric"
                value={amountPaid}
                onChangeText={setAmountPaid}
              />
            </View>

            {warrantyCovered === 'yes' && (
              <View style={{ gap: 10, paddingTop: 4 }}>
                <View style={{ gap: 4 }}>
                  <Text style={labelStyle}>Coverage Type</Text>
                  <TextInput
                    style={inputStyle}
                    placeholder="e.g. Manufacturer Warranty, AppleCare+, Insurance"
                    placeholderTextColor={SereneColors.outline}
                    value={coverageType}
                    onChangeText={setCoverageType}
                  />
                </View>

                <View style={{ gap: 4 }}>
                  <Text style={labelStyle}>Claim / Service Request #</Text>
                  <TextInput
                    style={inputStyle}
                    placeholder="e.g. SR-2026-98124"
                    placeholderTextColor={SereneColors.outline}
                    value={coverageReferenceNumber}
                    onChangeText={setCoverageReferenceNumber}
                  />
                </View>
              </View>
            )}
          </View>

          {/* Post-Service Coverage Card */}
          <View style={cardStyle}>
            <Text style={sectionTitleStyle}>Post-Service Protection</Text>

            {/* Post-Service Warranty */}
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: SereneColors.onSurface }}>
                    Post-Service Warranty
                  </Text>
                  <Text style={{ fontSize: 11, color: SereneColors.onSurfaceVariant }}>
                    Does the technician / service center provide a warranty on replaced parts?
                  </Text>
                </View>
                <Switch
                  value={hasPostWarranty}
                  onValueChange={setHasPostWarranty}
                  trackColor={{ false: SereneColors.surfaceContainerHighest, true: SereneColors.primary }}
                  thumbColor="#fff"
                />
              </View>

              {hasPostWarranty && (
                <View style={{ gap: 4, marginTop: 4 }}>
                  <Text style={labelStyle}>Warranty Until (YYYY-MM-DD)</Text>
                  <TextInput
                    style={[inputStyle, errors.postServiceWarrantyUntil ? { borderColor: SereneColors.error } : null]}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={SereneColors.outline}
                    value={postServiceWarrantyUntil}
                    onChangeText={(t) => {
                      setPostServiceWarrantyUntil(t);
                      if (errors.postServiceWarrantyUntil) setErrors((prev) => ({ ...prev, postServiceWarrantyUntil: '' }));
                    }}
                  />
                  {errors.postServiceWarrantyUntil ? (
                    <Text style={errorTextStyle}>{errors.postServiceWarrantyUntil}</Text>
                  ) : null}
                  <Text style={{ fontSize: 10, color: SereneColors.onSurfaceVariant }}>
                    Keepr will automatically remind you 7 days before this warranty expires.
                  </Text>
                </View>
              )}
            </View>

            <View style={{ height: 1, backgroundColor: SereneColors.subtleBorder, marginVertical: 4 }} />

            {/* Post-Service Guarantee */}
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: SereneColors.onSurface }}>
                    Post-Service Guarantee
                  </Text>
                  <Text style={{ fontSize: 11, color: SereneColors.onSurfaceVariant }}>
                    Satisfaction guarantee / free return service if the same issue recurs.
                  </Text>
                </View>
                <Switch
                  value={hasPostGuarantee}
                  onValueChange={setHasPostGuarantee}
                  trackColor={{ false: SereneColors.surfaceContainerHighest, true: SereneColors.primary }}
                  thumbColor="#fff"
                />
              </View>

              {hasPostGuarantee && (
                <View style={{ gap: 4, marginTop: 4 }}>
                  <Text style={labelStyle}>Guarantee Until (YYYY-MM-DD)</Text>
                  <TextInput
                    style={[inputStyle, errors.postServiceGuaranteeUntil ? { borderColor: SereneColors.error } : null]}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={SereneColors.outline}
                    value={postServiceGuaranteeUntil}
                    onChangeText={(t) => {
                      setPostServiceGuaranteeUntil(t);
                      if (errors.postServiceGuaranteeUntil) setErrors((prev) => ({ ...prev, postServiceGuaranteeUntil: '' }));
                    }}
                  />
                  {errors.postServiceGuaranteeUntil ? (
                    <Text style={errorTextStyle}>{errors.postServiceGuaranteeUntil}</Text>
                  ) : null}
                  <Text style={{ fontSize: 10, color: SereneColors.onSurfaceVariant }}>
                    Keepr will automatically remind you 7 days before this guarantee ends.
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Supporting Documents & Invoices */}
          <View style={cardStyle}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={sectionTitleStyle}>Supporting Documents & Invoices</Text>
              <TouchableOpacity
                onPress={promptAttachOptions}
                disabled={isAttachingDoc}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 20,
                  backgroundColor: 'rgba(17,80,134,0.08)',
                }}
              >
                {isAttachingDoc ? (
                  <ActivityIndicator size="small" color={SereneColors.primary} />
                ) : (
                  <>
                    <MaterialIcons name="add" size={14} color={SereneColors.primary} />
                    <Text style={{ fontSize: 11, fontWeight: '700', color: SereneColors.primary }}>
                      Attach New
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <Text style={{ fontSize: 11, color: SereneColors.onSurfaceVariant, marginTop: 2 }}>
              Attach service invoices, repair bills, technician reports, or select existing documents linked to this item:
            </Text>

            {linkedDocs.length > 0 ? (
              <View style={{ gap: 8, marginTop: 6 }}>
                {linkedDocs.map((doc) => {
                  const isChecked = selectedDocIds.includes(doc.id);
                  return (
                    <TouchableOpacity
                      key={doc.id}
                      onPress={() => toggleDocLink(doc.id)}
                      activeOpacity={0.8}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: 10,
                        borderRadius: 10,
                        backgroundColor: isChecked ? 'rgba(17,80,134,0.06)' : SereneColors.surfaceContainerLow,
                        borderWidth: 1,
                        borderColor: isChecked ? SereneColors.primary : SereneColors.subtleBorder,
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

                      <MaterialIcons
                        name={isChecked ? 'check-box' : 'check-box-outline-blank'}
                        size={20}
                        color={isChecked ? SereneColors.primary : SereneColors.outline}
                      />
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <TouchableOpacity
                onPress={promptAttachOptions}
                disabled={isAttachingDoc}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  paddingVertical: 14,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderStyle: 'dashed',
                  borderColor: SereneColors.outline,
                  backgroundColor: SereneColors.surfaceContainerLow,
                  marginTop: 6,
                }}
              >
                {isAttachingDoc ? (
                  <ActivityIndicator size="small" color={SereneColors.primary} />
                ) : (
                  <>
                    <MaterialIcons name="upload-file" size={20} color={SereneColors.primary} />
                    <Text style={{ fontSize: 12, fontWeight: '600', color: SereneColors.primary }}>
                      Upload Service Invoice / Receipt / Report
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* Notes Card */}
          <View style={cardStyle}>
            <Text style={sectionTitleStyle}>Additional Notes</Text>
            <TextInput
              style={[inputStyle, { minHeight: 70, textAlignVertical: 'top' }]}
              placeholder="Any other details, technician advice, or maintenance notes..."
              placeholderTextColor={SereneColors.outline}
              multiline
              numberOfLines={3}
              value={notes}
              onChangeText={setNotes}
            />
          </View>

          {/* Submit Button */}
          <TouchableOpacity
            style={{
              backgroundColor: SereneColors.primary,
              paddingVertical: 14,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: 6,
              shadowColor: SereneColors.primary,
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.2,
              shadowRadius: 4,
              elevation: 3,
            }}
            activeOpacity={0.88}
            disabled={isSubmitting}
            onPress={handleSave}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>
                {isEditing ? 'Update Service Record' : 'Save Service Record'}
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const cardStyle = {
  backgroundColor: SereneColors.surfaceContainerLowest,
  borderRadius: 14,
  padding: 14,
  borderWidth: 1,
  borderColor: SereneColors.subtleBorder,
  gap: 12,
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

const labelStyle = {
  fontSize: 12,
  fontWeight: '600' as const,
  color: SereneColors.onSurface,
};

const inputStyle = {
  backgroundColor: SereneColors.surfaceContainerLow,
  borderWidth: 1,
  borderColor: SereneColors.subtleBorder,
  borderRadius: 10,
  paddingHorizontal: 12,
  paddingVertical: 9,
  fontSize: 13,
  color: SereneColors.onSurface,
};

const errorTextStyle = {
  fontSize: 11,
  fontWeight: '500' as const,
  color: SereneColors.error,
  marginTop: 2,
};
