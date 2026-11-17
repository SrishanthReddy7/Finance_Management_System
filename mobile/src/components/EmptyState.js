import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from './theme';
import Button from './Button';

export default function EmptyState({
  title = 'No records found',
  message = 'There is nothing to display here yet.',
  actionTitle,
  onAction,
  icon,
}) {
  return (
    <View style={styles.container}>
      <View style={styles.iconCircle}>
        {icon ? icon : <Ionicons name="folder-open-outline" size={32} color={colors.textLight} />}
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {actionTitle && onAction && (
        <Button
          title={actionTitle}
          onPress={onAction}
          variant="primary"
          size="md"
          style={styles.actionBtn}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl + 8,
    paddingHorizontal: spacing.lg,
  },
  iconCircle: {
    width: 68,
    height: 68,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: typography.md,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  message: {
    fontSize: typography.sm,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.lg,
    lineHeight: 20,
    maxWidth: 320,
  },
  actionBtn: {
    minWidth: 160,
  },
});
