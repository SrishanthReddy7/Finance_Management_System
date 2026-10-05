import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { colors, spacing, borderRadius } from '../../components/theme';
import StatusBadge from '../../components/StatusBadge';
import Card from '../../components/Card';
import EmptyState from '../../components/EmptyState';
import { listInvoices } from '../../api/invoices';
import { Ionicons } from '@expo/vector-icons';

const INVOICE_FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'ISSUED', label: 'Issued' },
  { key: 'PARTIALLY_PAID', label: 'Partial' },
  { key: 'PAID', label: 'Paid' },
  { key: 'OVERDUE', label: 'Overdue' },
];

export default function InvoicesListScreen({ navigation }) {
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  const fetchInvoices = useCallback(async () => {
    try {
      setForbidden(false);
      const res = await listInvoices({
        status: selectedStatus === 'ALL' ? undefined : selectedStatus,
        pageSize: 50,
      });
      const data = res?.rows || res || [];
      setInvoices(data);
    } catch (err) {
      if (err?.response?.status === 403 || err?.message?.includes('403') || err?.message?.toLowerCase().includes('forbidden') || err?.message?.toLowerCase().includes('permission')) {
        setForbidden(true);
      }
      setInvoices([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedStatus]);

  useEffect(() => {
    setLoading(true);
    fetchInvoices();
  }, [fetchInvoices]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchInvoices();
  };

  const renderItem = ({ item }) => (
    <Card
      style={styles.invoiceCard}
      onPress={() => navigation.navigate('InvoiceDetail', { invoiceId: item.id })}
    >
      <View style={styles.cardHeader}>
        <View style={styles.headerLeft}>
          <Text style={styles.invoiceNumber}>
            {item.invoiceNumber || `INV-${item.id?.slice(0, 8)}`}
          </Text>
          <Text style={styles.clientName}>
            {item.client?.name || item.clientName || 'Client'}
          </Text>
        </View>
        <StatusBadge status={item.status} />
      </View>

      <View style={styles.cardFooter}>
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="calendar-outline" size={11} color={colors.textLight} style={{ marginRight: 3 }} />
            <Text style={styles.dueLabel}>Due Date</Text>
          </View>
          <Text style={styles.dueValue}>
            {item.dueDate
              ? new Date(item.dueDate).toLocaleDateString('en-IN', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })
              : 'N/A'}
          </Text>
        </View>
        <View style={styles.amountCol}>
          <Text style={styles.totalLabel}>Total Amount</Text>
          <Text style={styles.amountText}>
            ₹{Number(item.totalAmount || item.total || 0).toLocaleString('en-IN')}
          </Text>
        </View>
      </View>
    </Card>
  );

  return (
    <View style={styles.container}>
      <View style={styles.filterContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScroll}
        >
          {INVOICE_FILTERS.map((f) => {
            const isActive = selectedStatus === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                style={[styles.filterChip, isActive && styles.filterChipActive]}
                onPress={() => setSelectedStatus(f.key)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    isActive && styles.filterChipTextActive,
                  ]}
                >
                  {f.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading client invoices...</Text>
        </View>
      ) : (
        <FlatList
          data={invoices}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[colors.primary]}
            />
          }
          ListEmptyComponent={
            forbidden ? (
              <EmptyState
                title="Access Restricted"
                message="Your account does not have permission to view client invoices. Invoices are accessible to Finance Admins and Managers."
              />
            ) : (
              <EmptyState
                title="No invoices found"
                message={
                  selectedStatus === 'ALL'
                    ? 'No client invoices have been created yet.'
                    : `No invoices match status "${selectedStatus}".`
                }
              />
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  filterContainer: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  filterScroll: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  filterChipTextActive: {
    color: colors.textInverse,
  },
  listContent: {
    padding: spacing.md,
  },
  invoiceCard: {
    marginBottom: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  headerLeft: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  invoiceNumber: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  clientName: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceSubtle,
  },
  dueLabel: {
    fontSize: 11,
    color: colors.textLight,
  },
  dueValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginTop: 2,
  },
  amountCol: {
    alignItems: 'flex-end',
  },
  totalLabel: {
    fontSize: 11,
    color: colors.textLight,
  },
  amountText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    marginTop: 2,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: spacing.sm,
    fontSize: 14,
    color: colors.textMuted,
  },
});
