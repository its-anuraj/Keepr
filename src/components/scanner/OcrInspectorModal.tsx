
import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { OcrResult, OcrPreprocessedOutput } from '../../types/scanner';

interface OcrInspectorModalProps {
  visible: boolean;
  onClose: () => void;
  ocrResult?: OcrResult | null;
  preprocessed?: OcrPreprocessedOutput | null;
}

export const OcrInspectorModal: React.FC<OcrInspectorModalProps> = ({
  visible,
  onClose,
  ocrResult,
  preprocessed,
}) => {
  const [copied, setCopied] = React.useState(false);

  const textToDisplay = preprocessed?.cleanedText || ocrResult?.text || 'No OCR text extracted yet.';

  const handleCopy = async () => {
    await Clipboard.setStringAsync(textToDisplay);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const preserved = preprocessed?.preservedIdentifiers;

  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
      <View className="flex-1 bg-[rgba(15,23,42,0.65)] justify-end">
        <View className="bg-white rounded-t-[20px] max-h-[85%] min-h-[55%]">
          <View className="flex-row items-center justify-between px-5 py-4 border-b border-[#E2E8F0]">
            <View className="flex-row items-center gap-2">
              <MaterialIcons name="document-scanner" size={20} color="#115086" />
              <Text className="text-[16px] font-bold text-[#0F172A]">Extracted OCR Text & Blocks</Text>
            </View>
            <TouchableOpacity className="p-[6px] rounded-serene-md bg-[#F1F5F9]" onPress={onClose} activeOpacity={0.7}>
              <MaterialIcons name="close" size={20} color="#64748B" />
            </TouchableOpacity>
          </View>

          <ScrollView className="flex-1" contentContainerStyle={{ padding: 20, gap: 20 }}>
            <View className="flex-row gap-[10px]">
              <View className="flex-1 bg-[#F8FAFC] rounded-[10px] p-[10px] items-center border border-[#E2E8F0]">
                <Text className="text-[11px] text-[#64748B] mb-1">OCR Confidence</Text>
                <Text className="text-[15px] font-extrabold text-[#115086]">
                  {Math.round((ocrResult?.confidence || 0.95) * 100)}%
                </Text>
              </View>
              <View className="flex-1 bg-[#F8FAFC] rounded-[10px] p-[10px] items-center border border-[#E2E8F0]">
                <Text className="text-[11px] text-[#64748B] mb-1">Detected Blocks</Text>
                <Text className="text-[15px] font-extrabold text-[#115086]">{ocrResult?.blocks?.length || 0}</Text>
              </View>
              <View className="flex-1 bg-[#F8FAFC] rounded-[10px] p-[10px] items-center border border-[#E2E8F0]">
                <Text className="text-[11px] text-[#64748B] mb-1">Text Length</Text>
                <Text className="text-[15px] font-extrabold text-[#115086]">{textToDisplay.length} chars</Text>
              </View>
            </View>

            {preserved && (
              <View className="gap-2">
                <Text className="text-[13px] font-bold text-[#334155] uppercase tracking-[0.5px]">
                  Preserved High-Priority Identifiers
                </Text>
                <View className="flex-row flex-wrap gap-[6px]">
                  {preserved.gstNumbers.map((gst, idx) => (
                    <View key={`gst-${idx}`} className="px-2 py-1 rounded-[6px] bg-[#FEE2E2]">
                      <Text className="text-[11px] font-semibold text-[#1E293B]">GST: {gst}</Text>
                    </View>
                  ))}
                  {preserved.serialNumbers.map((sn, idx) => (
                    <View key={`sn-${idx}`} className="px-2 py-1 rounded-[6px] bg-[#FEF3C7]">
                      <Text className="text-[11px] font-semibold text-[#1E293B]">SN: {sn}</Text>
                    </View>
                  ))}
                  {preserved.imeiNumbers.map((imei, idx) => (
                    <View key={`imei-${idx}`} className="px-2 py-1 rounded-[6px] bg-[#E0E7FF]">
                      <Text className="text-[11px] font-semibold text-[#1E293B]">IMEI: {imei}</Text>
                    </View>
                  ))}
                  {preserved.currencyValues.slice(0, 4).map((c, idx) => (
                    <View key={`c-${idx}`} className="px-2 py-1 rounded-[6px] bg-[#D1FAE5]">
                      <Text className="text-[11px] font-semibold text-[#1E293B]">{c}</Text>
                    </View>
                  ))}
                  {preserved.dates.slice(0, 3).map((d, idx) => (
                    <View key={`d-${idx}`} className="px-2 py-1 rounded-[6px] bg-[#F3E8FF]">
                      <Text className="text-[11px] font-semibold text-[#1E293B]">{d}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            <View className="gap-2">
              <View className="flex-row justify-between items-center">
                <Text className="text-[13px] font-bold text-[#334155] uppercase tracking-[0.5px]">
                  Preprocessed Machine-Readable Text
                </Text>
                <TouchableOpacity className="flex-row items-center gap-1 bg-[#E0F2FE] px-2 py-1 rounded-[6px]" onPress={handleCopy} activeOpacity={0.7}>
                  <MaterialIcons
                    name={copied ? 'check' : 'content-copy'}
                    size={14}
                    color={copied ? '#10B981' : '#115086'}
                  />
                  <Text className={`text-[11px] font-bold ${copied ? 'text-[#10B981]' : 'text-[#115086]'}`}>
                    {copied ? 'Copied!' : 'Copy'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View className="bg-[#0F172A] rounded-[10px] p-[14px]">
                <Text className="text-[#F8FAFC] font-mono text-[12px] leading-[18px]">{textToDisplay}</Text>
              </View>
            </View>

            {ocrResult?.blocks && ocrResult.blocks.length > 0 && (
              <View className="gap-2">
                <Text className="text-[13px] font-bold text-[#334155] uppercase tracking-[0.5px]">
                  Optical Block Segments
                </Text>
                <View className="gap-2">
                  {ocrResult.blocks.map((block, idx) => (
                    <View key={`blk-${idx}`} className="bg-[#F8FAFC] rounded-serene-md p-[10px] border border-[#E2E8F0]">
                      <View className="flex-row justify-between mb-1">
                        <Text className="text-[11px] font-bold text-[#115086]">Block #{idx + 1}</Text>
                        <Text className="text-[11px] text-[#64748B]">
                          {Math.round(block.confidence * 100)}% conf
                        </Text>
                      </View>
                      <Text className="text-[12px] text-[#334155] leading-4">{block.text}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </ScrollView>

          <View className="p-4 border-t border-[#E2E8F0] bg-white">
            <TouchableOpacity className="bg-[#115086] rounded-[10px] py-3 items-center" onPress={onClose} activeOpacity={0.8}>
              <Text className="text-white text-[14px] font-bold">Close Inspector</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};
