import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, View } from 'react-native';
import { colors, borderRadius, spacing, shadows, typography } from './theme';

export default function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  style,
  textStyle,
  icon,
  iconPosition = 'left',
  fullWidth = false,
}) {
  const getContainerStyle = () => {
    switch (variant) {
      case 'secondary':
        return styles.btnSecondary;
      case 'outline':
        return styles.btnOutline;
      case 'danger':
        return styles.btnDanger;
      case 'success':
        return styles.btnSuccess;
      case 'ghost':
        return styles.btnGhost;
      case 'primary':
      default:
        return styles.btnPrimary;
    }
  };

  const getTextStyle = () => {
    switch (variant) {
      case 'secondary':
        return styles.textSecondary;
      case 'outline':
        return styles.textOutline;
      case 'danger':
        return styles.textDanger;
      case 'success':
        return styles.textSuccess;
      case 'ghost':
        return styles.textGhost;
      case 'primary':
      default:
        return styles.textPrimary;
    }
  };

  const getSizeStyle = () => {
    switch (size) {
      case 'sm':
        return styles.sizeSm;
      case 'lg':
        return styles.sizeLg;
      case 'md':
      default:
        return styles.sizeMd;
    }
  };

  const getTextSizeStyle = () => {
    switch (size) {
      case 'sm':
        return styles.textSizeSm;
      case 'lg':
        return styles.textSizeLg;
      case 'md':
      default:
        return styles.textSizeMd;
    }
  };

  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      disabled={isDisabled}
      style={[
        styles.base,
        getContainerStyle(),
        getSizeStyle(),
        fullWidth && styles.fullWidth,
        variant === 'primary' && !isDisabled && shadows.sm,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'outline' || variant === 'ghost' ? colors.primary : colors.textInverse}
        />
      ) : (
        <View style={[styles.contentRow, iconPosition === 'right' && styles.contentRowReverse]}>
          {icon && (
            <View style={iconPosition === 'right' ? styles.iconRight : styles.iconLeft}>
              {icon}
            </View>
          )}
          <Text style={[styles.baseText, getTextStyle(), getTextSizeStyle(), textStyle]}>
            {title}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  fullWidth: {
    width: '100%',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentRowReverse: {
    flexDirection: 'row-reverse',
  },
  iconLeft: {
    marginRight: spacing.sm,
  },
  iconRight: {
    marginLeft: spacing.sm,
  },
  // Sizes
  sizeSm: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  sizeMd: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  sizeLg: {
    minHeight: 54,
    paddingHorizontal: spacing.xl,
    paddingVertical: 14,
  },
  // Variants
  btnPrimary: {
    backgroundColor: colors.primary,
  },
  btnSecondary: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.borderDark,
  },
  btnDanger: {
    backgroundColor: colors.danger,
  },
  btnSuccess: {
    backgroundColor: colors.success,
  },
  btnGhost: {
    backgroundColor: 'transparent',
  },
  disabled: {
    opacity: 0.5,
  },
  // Typography
  baseText: {
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  textSizeSm: {
    fontSize: typography.sm,
  },
  textSizeMd: {
    fontSize: typography.base,
  },
  textSizeLg: {
    fontSize: typography.md,
    fontWeight: '700',
  },
  textPrimary: {
    color: colors.textInverse,
  },
  textSecondary: {
    color: colors.text,
  },
  textOutline: {
    color: colors.text,
  },
  textDanger: {
    color: colors.textInverse,
  },
  textSuccess: {
    color: colors.textInverse,
  },
  textGhost: {
    color: colors.primary,
  },
});
