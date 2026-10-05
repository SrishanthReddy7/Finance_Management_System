import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, borderRadius } from './theme';

const STATUS_CONFIGS = {
  DRAFT: { label: 'Draft', bg: colors.surfaceSubtle, text: colors.textMuted },
  SUBMITTED: { label: 'Submitted', bg: colors.infoLight, text: colors.infoText },
  APPROVED: { label: 'Approved', bg: colors.successLight, text: colors.successText },
  MANAGER_APPROVED: { label: 'Manager Approved', bg: colors.successLight, text: colors.successText },
  FINANCE_APPROVED: { label: 'Finance Approved', bg: colors.successLight, text: colors.successText },
  REIMBURSEMENT_PENDING: { label: 'Awaiting Payment', bg: colors.warningLight, text: colors.warningText },
  REJECTED: { label: 'Rejected', bg: colors.dangerLight, text: colors.dangerText },
  MANAGER_REJECTED: { label: 'Rejected', bg: colors.dangerLight, text: colors.dangerText },
  FINANCE_REJECTED: { label: 'Rejected', bg: colors.dangerLight, text: colors.dangerText },
  REIMBURSED: { label: 'Paid', bg: colors.successLight, text: colors.successText },
  PAID: { label: 'Paid', bg: colors.successLight, text: colors.successText },
  CANCELLED: { label: 'Cancelled', bg: colors.surfaceSubtle, text: colors.textLight },

  ISSUED: { label: 'Issued', bg: colors.infoLight, text: colors.infoText },
  PARTIALLY_PAID: { label: 'Partial', bg: colors.warningLight, text: colors.warningText },
  OVERDUE: { label: 'Overdue', bg: colors.dangerLight, text: colors.dangerText },

  PENDING: { label: 'Pending', bg: colors.warningLight, text: colors.warningText },
  PROCESSING: { label: 'Processing', bg: colors.infoLight, text: colors.infoText },
  FAILED: { label: 'Failed', bg: colors.dangerLight, text: colors.dangerText },
};

export default function StatusBadge({ status, style }) {
  const normalized = (status || '').toUpperCase();
  const config = STATUS_CONFIGS[normalized] || {
    label: status || 'Unknown',
    bg: colors.surfaceSubtle,
    text: colors.textMuted,
  };

  return (
    <View style={[styles.badge, { backgroundColor: config.bg }, style]}>
      <Text style={[styles.text, { color: config.text }]}>{config.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
