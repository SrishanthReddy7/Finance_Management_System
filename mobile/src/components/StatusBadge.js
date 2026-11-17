import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, borderRadius, typography } from './theme';

const STATUS_CONFIGS = {
  // Expense claim statuses
  DRAFT: { label: 'Draft', bg: colors.surfaceSubtle, text: colors.textMuted, border: colors.borderDark, dot: colors.textMuted },
  SUBMITTED: { label: 'Submitted', bg: colors.infoLight, text: colors.infoDark, border: colors.infoBorder, dot: colors.info },
  APPROVED: { label: 'Approved', bg: colors.successLight, text: colors.successDark, border: colors.successBorder, dot: colors.success },
  MANAGER_APPROVED: { label: 'Manager Approved', bg: colors.successLight, text: colors.successDark, border: colors.successBorder, dot: colors.success },
  FINANCE_APPROVED: { label: 'Finance Approved', bg: colors.successLight, text: colors.successDark, border: colors.successBorder, dot: colors.success },
  REIMBURSEMENT_PENDING: { label: 'Awaiting Payout', bg: colors.warningLight, text: colors.warningDark, border: colors.warningBorder, dot: colors.warning },
  REJECTED: { label: 'Rejected', bg: colors.dangerLight, text: colors.dangerDark, border: colors.dangerBorder, dot: colors.danger },
  MANAGER_REJECTED: { label: 'Rejected', bg: colors.dangerLight, text: colors.dangerDark, border: colors.dangerBorder, dot: colors.danger },
  FINANCE_REJECTED: { label: 'Rejected', bg: colors.dangerLight, text: colors.dangerDark, border: colors.dangerBorder, dot: colors.danger },
  REIMBURSED: { label: 'Reimbursed', bg: colors.successLight, text: colors.successDark, border: colors.successBorder, dot: colors.success },
  PAID: { label: 'Paid', bg: colors.successLight, text: colors.successDark, border: colors.successBorder, dot: colors.success },
  CANCELLED: { label: 'Cancelled', bg: colors.surfaceSubtle, text: colors.textLight, border: colors.border, dot: colors.textLight },

  // Invoice statuses
  ISSUED: { label: 'Issued', bg: colors.infoLight, text: colors.infoDark, border: colors.infoBorder, dot: colors.info },
  PARTIALLY_PAID: { label: 'Partially Paid', bg: colors.warningLight, text: colors.warningDark, border: colors.warningBorder, dot: colors.warning },
  OVERDUE: { label: 'Overdue', bg: colors.dangerLight, text: colors.dangerDark, border: colors.dangerBorder, dot: colors.danger },

  // General payment & transaction statuses
  PENDING: { label: 'Pending', bg: colors.warningLight, text: colors.warningDark, border: colors.warningBorder, dot: colors.warning },
  PROCESSING: { label: 'Processing', bg: colors.infoLight, text: colors.infoDark, border: colors.infoBorder, dot: colors.info },
  FINALIZED: { label: 'Finalized', bg: colors.primaryLight, text: colors.primaryDark, border: colors.primaryBorder, dot: colors.primary },
  PROCESSED: { label: 'Processed', bg: colors.primaryLight, text: colors.primaryDark, border: colors.primaryBorder, dot: colors.primary },
  FAILED: { label: 'Failed', bg: colors.dangerLight, text: colors.dangerDark, border: colors.dangerBorder, dot: colors.danger },
};

export default function StatusBadge({ status, style, showDot = true, size = 'md' }) {
  const normalized = (status || '').toUpperCase();
  const config = STATUS_CONFIGS[normalized] || {
    label: status || 'Unknown',
    bg: colors.surfaceSubtle,
    text: colors.textMuted,
    border: colors.border,
    dot: colors.textMuted,
  };

  const isSmall = size === 'sm';

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: config.bg, borderColor: config.border },
        isSmall && styles.badgeSm,
        style,
      ]}
    >
      {showDot && (
        <View style={[styles.dot, { backgroundColor: config.dot }, isSmall && styles.dotSm]} />
      )}
      <Text style={[styles.text, { color: config.text }, isSmall && styles.textSm]}>
        {config.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 3.5,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  badgeSm: {
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  dotSm: {
    width: 4.5,
    height: 4.5,
    borderRadius: 2.5,
    marginRight: 4,
  },
  text: {
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  textSm: {
    fontSize: 10,
    fontWeight: '700',
  },
});
