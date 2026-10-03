
import React from 'react';
import Svg, {
  Defs,
  LinearGradient,
  Stop,
  Rect,
  Path,
  Circle,
} from 'react-native-svg';

interface KeeprLogoProps {
  size?: number;
}

export const KeeprLogo: React.FC<KeeprLogoProps> = ({ size = 36 }) => {
  return (
    <Svg viewBox="0 0 120 120" width={size} height={size}>
      <Defs>
        <LinearGradient id="keeprWarmGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor="#3368A0" />
          <Stop offset="100%" stopColor="#66A3BF" />
        </LinearGradient>
        <LinearGradient id="bgWarmGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor="#FFFFFF" />
          <Stop offset="100%" stopColor="#F2EFE7" />
        </LinearGradient>
      </Defs>

      <Rect
        x="8"
        y="8"
        width="104"
        height="104"
        rx="26"
        fill="url(#bgWarmGrad)"
        stroke="#C8DFDB"
        strokeWidth="2"
      />

      <Path
        d="M40 34 V86 M40 60 L68 34 M52 50 L76 86"
        stroke="url(#keeprWarmGrad)"
        strokeWidth="7.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      <Circle cx="78" cy="36" r="4.5" fill="#3368A0" />
    </Svg>
  );
};
