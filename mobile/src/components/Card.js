import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, borderRadius, spacing, shadows } from './theme';

export default function Card({
  children,
  style,
  onPress,
  variant = 'elevated',
  accentBorderColor,
  padding = 'md',
}) {
  const getPaddingStyle = () => {
    switch (padding) {
      case 'none':
        return { padding: 0 };
      case 'sm':
        return { padding: spacing.sm };
      case 'lg':
        return { padding: spacing.lg };
      case 'md':
      default:
        return { padding: spacing.md };
    }
  };

  const getVariantStyle = () => {
    switch (variant) {
      case 'outlined':
        return styles.cardOutlined;
      case 'flat':
        return styles.cardFlat;
      case 'elevated':
      default:
        return styles.cardElevated;
    }
  };

  const combinedStyles = [
    styles.cardBase,
    getVariantStyle(),
    getPaddingStyle(),
    accentBorderColor && { borderLeftWidth: 4, borderLeftColor: accentBorderColor },
    style,
  ];

  if (onPress) {
    return (
      <TouchableOpacity
        activeOpacity={0.72}
        onPress={onPress}
        style={combinedStyles}
      >
        {children}
      </TouchableOpacity>
    );
  }

  return <View style={combinedStyles}>{children}</View>;
}

const styles = StyleSheet.create({
  cardBase: {
    borderRadius: borderRadius.lg,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  cardElevated: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  cardOutlined: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderDark,
  },
  cardFlat: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
