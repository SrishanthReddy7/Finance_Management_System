import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, borderRadius, spacing, typography } from './theme';

export default function Input({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  secureTextEntry,
  keyboardType = 'default',
  autoCapitalize = 'none',
  multiline = false,
  numberOfLines = 1,
  editable = true,
  leadingIcon,
  trailingIcon,
  onTrailingIconPress,
  style,
  inputStyle,
  helperText,
}) {
  const [isFocused, setIsFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(!secureTextEntry);

  const isPassword = Boolean(secureTextEntry);

  return (
    <View style={[styles.container, style]}>
      {label && (
        <View style={styles.labelRow}>
          <Text style={[styles.label, isFocused && styles.labelFocused, !!error && styles.labelError]}>
            {label}
          </Text>
        </View>
      )}

      <View
        style={[
          styles.inputWrapper,
          isFocused && styles.inputWrapperFocused,
          !editable && styles.inputWrapperDisabled,
          !!error && styles.inputWrapperError,
          multiline && styles.inputWrapperMultiline,
        ]}
      >
        {leadingIcon && (
          <View style={styles.leadingIconContainer}>
            {leadingIcon}
          </View>
        )}

        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textLight}
          secureTextEntry={isPassword ? !showPassword : false}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          multiline={multiline}
          numberOfLines={numberOfLines}
          editable={editable}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          style={[
            styles.input,
            multiline && styles.multilineInput,
            !editable && styles.disabledInput,
            inputStyle,
          ]}
        />

        {isPassword ? (
          <TouchableOpacity
            style={styles.trailingIconContainer}
            activeOpacity={0.7}
            onPress={() => setShowPassword((prev) => !prev)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={18}
              color={isFocused ? colors.primary : colors.textMuted}
            />
          </TouchableOpacity>
        ) : trailingIcon ? (
          <TouchableOpacity
            style={styles.trailingIconContainer}
            activeOpacity={0.7}
            onPress={onTrailingIconPress}
            disabled={!onTrailingIconPress}
          >
            {trailingIcon}
          </TouchableOpacity>
        ) : null}
      </View>

      {!!error && (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle" size={13} color={colors.danger} style={{ marginRight: 4 }} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!error && !!helperText && (
        <Text style={styles.helperText}>{helperText}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  label: {
    fontSize: typography.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    letterSpacing: 0.1,
  },
  labelFocused: {
    color: colors.primary,
  },
  labelError: {
    color: colors.danger,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    minHeight: 48,
    paddingHorizontal: spacing.sm + 4,
  },
  inputWrapperFocused: {
    borderColor: colors.primary,
    backgroundColor: '#FAF5FF' === colors.primaryLight ? colors.surface : '#FFFFFF',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  inputWrapperMultiline: {
    minHeight: 96,
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
  },
  inputWrapperDisabled: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
  },
  inputWrapperError: {
    borderColor: colors.danger,
  },
  input: {
    flex: 1,
    height: '100%',
    fontSize: typography.base,
    color: colors.text,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  multilineInput: {
    textAlignVertical: 'top',
    height: 80,
  },
  disabledInput: {
    color: colors.textMuted,
  },
  leadingIconContainer: {
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trailingIconContainer: {
    padding: 4,
    marginLeft: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },
  errorText: {
    fontSize: 12,
    color: colors.danger,
    fontWeight: '500',
  },
  helperText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
  },
});
