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
import { listClaims } from '../../api/expenses';
import { Ionicons } from '@expo/vector-icons';

const FILTER_OPTIONS = [
  { key: 'ALL', label: 'All' },
  { key: 'DRAFT', label: 'Draft' },
  { key: 'SUBMITTED', label: 'Submitted' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'PAID', label: 'Paid' },
  { key: 'REJECTED', label: 'Rejected' },
];

export default function ExpensesListScreen({ navigation, route }) {
  const initialFilter = route?.params?.initialFilter || 'ALL';
  const [selectedStatus, setSelectedStatus] = useState(initialFilter);
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (route?.params?.initialFilter) {
      setSelectedStatus(route.params.initialFilter);
    }
  }, [route?.params?.initialFilter]);

  const fetchClaims = useCallback(async () => {
    try {
      const res = await listClaims({
        status: selectedStatus === 'ALL' ? undefined : selectedStatus,
        pageSize: 50,
      });
      const data = res?.rows || res || [];
      setClaims(data);
    } catch (err) {
      console.warn('Error fetching claims:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedStatus]);

  useEffect(() => {
    setLoading(true);
    fetchClaims();
  }, [fetchClaims]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchClaims();
  };

  const renderItem = ({ item }) => (
    <Card
      style={styles.claimCard}
      onPress={() => navigation.navigate('ExpenseDetail', { claimId: item.id })}
    >
      <View style={styles.cardHeader}>
        <View style={styles.headerLeft}>
          <Text style={styles.merchantName}>
            {item.purpose || item.merchantName || item.description || 'Expense Claim'}
          </Text>
          <Text style={styles.categoryName}>
            {item.category?.name || 'General Expense'}
            {item.project ? ` • ${item.project.name}` : ''}
          </Text>
          {item.employee && (
            <View style={styles.employeeBadge}>
              <Ionicons name="person-circle-outline" size={13} color={colors.primary} style={{ marginRight: 4 }} />
              <Text style={styles.employeeText}>
                {item.employee.firstName} {item.employee.lastName}
              </Text>
            </View>
          )}
        </View>
        <StatusBadge status={item.status} />
      </View>

      <View style={styles.cardFooter}>
        <View style={styles.dateRow}>
          <Ionicons name="calendar-outline" size={13} color={colors.textMuted} style={{ marginRight: 4 }} />
          <Text style={styles.dateText}>
            {item.expenseDate
              ? new Date(item.expenseDate).toLocaleDateString('en-IN', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })
              : 'No date'}
          </Text>
        </View>
        <Text style={styles.amountText}>
          ₹{Number(item.amount || item.totalAmount || 0).toLocaleString('en-IN')}
        </Text>
      </View>
    </Card>
  );

  const getEmptyMessage = () => {
    switch (selectedStatus) {
      case 'ALL':
        return 'No expense claims found.';
      case 'DRAFT':
        return 'No draft expense claims.';
      case 'SUBMITTED':
        return 'No claims currently submitted or awaiting approval.';
      case 'APPROVED':
        return 'No claims approved awaiting payment.';
      case 'PAID':
        return 'No paid / reimbursed expenses found.';
      case 'REJECTED':
        return 'No rejected expense claims found.';
      default:
        return `No expenses found with status "${selectedStatus}".`;
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.filterContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScroll}
        >
          {FILTER_OPTIONS.map((filter) => {
            const isActive = selectedStatus === filter.key;
            return (
              <TouchableOpacity
                key={filter.key}
                style={[styles.filterChip, isActive && styles.filterChipActive]}
                onPress={() => setSelectedStatus(filter.key)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    isActive && styles.filterChipTextActive,
                  ]}
                >
                  {filter.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading expense claims...</Text>
        </View>
      ) : (
        <FlatList
          data={claims}
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
            <EmptyState
              title="No expense claims"
              message={getEmptyMessage()}
              actionTitle="Submit an Expense"
              onAction={() => navigation.navigate('SubmitExpense')}
            />
          }
        />
      )}

      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('SubmitExpense')}
      >
        <Ionicons name="add" size={30} color={colors.textInverse} />
      </TouchableOpacity>
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
    paddingBottom: 80,
  },
  claimCard: {
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
  merchantName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  categoryName: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  employeeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    backgroundColor: colors.primaryLight,
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  employeeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceSubtle,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  amountText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
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
  fab: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
  },
  fabIcon: {
    color: colors.textInverse,
    fontSize: 28,
    fontWeight: '300',
    lineHeight: 32,
  },
});
