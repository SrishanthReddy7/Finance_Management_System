import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../../components/theme';
import StatusBadge from '../../components/StatusBadge';
import Card from '../../components/Card';
import { getInvoice } from '../../api/invoices';
import { unwrapError } from '../../api/unwrap';

export default function InvoiceDetailScreen({ route }) {
  const insets = useSafeAreaInsets();
  const { invoiceId } = route.params;
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchDetail = useCallback(async () => {
    try {
      const data = await getInvoice(invoiceId);
      setInvoice(data);
    } catch (err) {
      Alert.alert('Error', unwrapError(err, 'Failed to fetch invoice details.'));
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading invoice details...</Text>
      </View>
    );
  }

  if (!invoice) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>Invoice not found.</Text>
      </View>
    );
  }

  const items = invoice.items || invoice.invoiceItems || [];
  const total = Number(invoice.totalAmount || invoice.total || 0);
  const amountPaid = Number(invoice.amountPaid || 0);
  const balanceDue = total - amountPaid;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingBottom: Math.max(insets.bottom, 20) + 40 },
      ]}
    >
      <Card style={styles.headerCard}>
        <View style={styles.headerRow}>
          <Text style={styles.invoiceNumber}>
            {invoice.invoiceNumber || `INV-${invoice.id?.slice(0, 8)}`}
          </Text>
          <StatusBadge status={invoice.status} />
        </View>

        <Text style={styles.clientName}>
          {invoice.client?.name || invoice.clientName || 'Client Name'}
        </Text>

        <View style={styles.dateRow}>
          <View style={styles.dateBlock}>
            <Text style={styles.dateLabel}>Issue Date</Text>
            <Text style={styles.dateValue}>
              {invoice.issueDate
                ? new Date(invoice.issueDate).toLocaleDateString('en-IN')
                : 'N/A'}
            </Text>
          </View>

          <View style={styles.dateBlock}>
            <Text style={styles.dateLabel}>Due Date</Text>
            <Text style={styles.dateValue}>
              {invoice.dueDate
                ? new Date(invoice.dueDate).toLocaleDateString('en-IN')
                : 'N/A'}
            </Text>
          </View>
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Line Items</Text>
        {items.length === 0 ? (
          <Text style={styles.emptyItemsText}>No items listed on this invoice.</Text>
        ) : (
          items.map((item, idx) => {
            const itemAmt = Number(item.amount || (item.quantity || 1) * (item.rate || item.unitPrice || 0));
            return (
              <View key={item.id || idx} style={styles.itemRow}>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemDesc}>{item.description || `Item #${idx + 1}`}</Text>
                  <Text style={styles.itemQtyRate}>
                    Qty: {item.quantity || 1} × ₹{Number(item.rate || item.unitPrice || itemAmt).toLocaleString('en-IN')}
                  </Text>
                </View>
                <Text style={styles.itemTotal}>₹{itemAmt.toLocaleString('en-IN')}</Text>
              </View>
            );
          })
        )}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Payment Summary</Text>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Subtotal</Text>
          <Text style={styles.summaryValue}>
            ₹{Number(invoice.subtotal || total).toLocaleString('en-IN')}
          </Text>
        </View>

        {invoice.cgstAmount ? (
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>CGST</Text>
            <Text style={styles.summaryValue}>
              ₹{Number(invoice.cgstAmount).toLocaleString('en-IN')}
            </Text>
          </View>
        ) : null}

        {invoice.sgstAmount ? (
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>SGST</Text>
            <Text style={styles.summaryValue}>
              ₹{Number(invoice.sgstAmount).toLocaleString('en-IN')}
            </Text>
          </View>
        ) : null}

        {invoice.igstAmount ? (
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>IGST</Text>
            <Text style={styles.summaryValue}>
              ₹{Number(invoice.igstAmount).toLocaleString('en-IN')}
            </Text>
          </View>
        ) : null}

        <View style={[styles.summaryRow, styles.totalRow]}>
          <Text style={styles.totalLabel}>Total Amount</Text>
          <Text style={styles.totalValue}>₹{total.toLocaleString('en-IN')}</Text>
        </View>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Amount Paid</Text>
          <Text style={[styles.summaryValue, { color: colors.success }]}>
            ₹{amountPaid.toLocaleString('en-IN')}
          </Text>
        </View>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Balance Due</Text>
          <Text style={[styles.summaryValue, { color: colors.danger, fontWeight: '700' }]}>
            ₹{balanceDue > 0 ? balanceDue.toLocaleString('en-IN') : '0.00'}
          </Text>
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: spacing.sm,
    color: colors.textMuted,
  },
  errorText: {
    color: colors.danger,
    fontSize: 16,
  },
  headerCard: {
    borderLeftWidth: 4,
    borderLeftColor: colors.info,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  invoiceNumber: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  clientName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: 4,
    marginBottom: spacing.md,
  },
  dateRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceSubtle,
  },
  dateBlock: {
    flex: 1,
  },
  dateLabel: {
    fontSize: 11,
    color: colors.textLight,
  },
  dateValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyItemsText: {
    fontSize: 13,
    color: colors.textLight,
    fontStyle: 'italic',
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceSubtle,
  },
  itemInfo: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  itemDesc: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  itemQtyRate: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  itemTotal: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  summaryLabel: {
    fontSize: 13,
    color: colors.textMuted,
  },
  summaryValue: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '500',
  },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  totalLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
});
