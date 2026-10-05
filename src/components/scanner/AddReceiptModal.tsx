import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { KeeprLogo } from '../ui/KeeprLogo';

export interface AddReceiptModalProps {
  visible: boolean;
  onClose: () => void;
  onChooseFromGallery: () => void;
}

export const AddReceiptModal: React.FC<AddReceiptModalProps> = ({
  visible,
  onClose,
  onChooseFromGallery,
}) => {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View className="flex-1 bg-[rgba(15,23,42,0.55)] justify-end">
          <TouchableWithoutFeedback>
            <View
              className={`bg-white rounded-t-[24px] px-5 pt-3 ${
                Platform.OS === 'ios' ? 'pb-9' : 'pb-6'
              } shadow-lg`}
            >
              <View className="w-9 h-1 rounded-sm bg-[#CBD5E1] self-center mb-4" />

              <View className="flex-row justify-between items-start mb-5">
                <View className="flex-row items-center gap-3 flex-1">
                  <KeeprLogo size={32} />
                  <View className="flex-1">
                    <Text className="text-[18px] font-bold text-[#0F172A] tracking-[-0.2px]">
                      Add Receipt
                    </Text>
                    <Text className="text-[13px] text-[#64748B] mt-[2px] leading-[18px]">
                      Choose how you'd like to add your receipt.
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  className="w-8 h-8 rounded-full bg-[#F1F5F9] items-center justify-center"
                  onPress={onClose}
                  activeOpacity={0.7}
                  accessibilityLabel="Close dialog"
                >
                  <MaterialIcons name="close" size={20} color="#64748B" />
                </TouchableOpacity>
              </View>

              <View className="gap-3 mb-[18px]">
                <TouchableOpacity
                  className="flex-row items-center bg-white rounded-serene-xl p-4 border border-[#E2E8F0] shadow-sm"
                  onPress={onChooseFromGallery}
                  activeOpacity={0.85}
                >
                  <View className="w-[50px] h-[50px] rounded-full items-center justify-center mr-[14px] bg-[#E0F2FE]">
                    <MaterialIcons name="photo-library" size={26} color="#115086" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-[15px] font-bold text-[#0F172A] mb-[3px]">
                      Choose from Gallery
                    </Text>
                    <Text className="text-[12px] text-[#64748B] leading-4">
                      Select an existing receipt photo
                    </Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={22} color="#94A3B8" />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                className="py-[14px] rounded-serene-lg bg-[#F8FAFC] border border-[#E2E8F0] items-center justify-center"
                onPress={onClose}
                activeOpacity={0.8}
              >
                <Text className="text-[14px] font-semibold text-[#64748B]">Cancel</Text>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};
