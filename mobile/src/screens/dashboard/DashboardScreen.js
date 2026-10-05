import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { colors, spacing, borderRadius, shadows } from '../../components/theme';
import StatusBadge from '../../components/StatusBadge';
import Card from '../../components/Card';
import { listClaims } from '../../api/expenses';

export default function DashboardScreen({ navigation }) {
  const { user, can } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [recentClaims, setRecentClaims] = useState([]);
  const [stats, setStats] = useState({
    pendingExpenses: 0,
    totalApproved: 0,
    totalPaid: 0,
    submittedCount: 0,
    paidCount: 0,
  });

  const loadDashboardData = useCallback(async () => {
    try {
      const claimsRes = await listClaims({ pageSize: 50 });
      const claims = claimsRes?.rows || claimsRes || [];
      setRecentClaims(claims.slice(0, 5));

      let pending = 0;
      let approvedSum = 0;
      let paidSum = 0;
      let submitted = 0;
      let paidCount = 0;

      claims.forEach((c) => {
        const amt = Number(c.amount || c.totalAmount || 0);
        if (c.status === 'SUBMITTED') {
          pending += amt;
          submitted += 1;
        } else if (
          c.status === 'APPROVED' ||
          c.status === 'MANAGER_APPROVED' ||
          c.status === 'FINANCE_APPROVED' ||
          c.status === 'REIMBURSEMENT_PENDING'
        ) {
          approvedSum += amt;
        } else if (c.status === 'PAID' || c.status === 'REIMBURSED') {
          paidSum += amt;
          paidCount += 1;
        }
      });

      setStats({
        pendingExpenses: pending,
        totalApproved: approvedSum,
        totalPaid: paidSum,
        submittedCount: submitted,
        paidCount,
      });
    } catch (err) {
      console.warn('Dashboard fetch error:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const onRefresh = () => {
    setRefreshing(true);
    loadDashboardData();
  };

  const isReviewer = can('APPROVE_EXPENSE') || can('VERIFY_EXPENSE');
  const isHrAdmin =
    user?.roleName === 'HR Admin' ||
    user?.role?.name === 'HR Admin';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
      }
    >
      <View style={styles.headerCard}>
        <View style={styles.headerLeft}>
          <Text style={styles.greeting}>Welcome back,</Text>
          <Text style={styles.userName}>
            {user?.employee ? `${user.employee.firstName} ${user.employee.lastName}`.trim() : user?.name || user?.email?.split('@')[0] || 'User'}
          </Text>
          <View style={styles.roleRow}>
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>{user?.roleName || user?.roleType || 'Staff'}</Text>
            </View>
            {user?.employee?.department?.name && (
              <Text style={styles.deptText}>• {user.employee.department.name}</Text>
            )}
          </View>
        </View>
        <View style={styles.headerRightActions}>
          <TouchableOpacity
            style={styles.avatarButton}
            onPress={() => navigation.navigate('ProfileTab')}
          >
            <Text style={styles.avatarLetter}>
              {((user?.employee?.firstName || user?.name || user?.email || 'U')[0] || 'U').toUpperCase()}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.metricsRow}>
        <TouchableOpacity
          style={[styles.metricCard, { borderLeftColor: colors.warning }]}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('ExpensesTab', { initialFilter: 'SUBMITTED' })}
        >
          <Text style={styles.metricLabel}>Pending</Text>
          <Text style={styles.metricValue}>₹{stats.pendingExpenses.toLocaleString('en-IN')}</Text>
          <Text style={styles.metricSub}>{stats.submittedCount} to review</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.metricCard, { borderLeftColor: colors.info }]}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('ExpensesTab', { initialFilter: 'APPROVED' })}
        >
          <Text style={styles.metricLabel}>Approved</Text>
          <Text style={styles.metricValue}>₹{stats.totalApproved.toLocaleString('en-IN')}</Text>
          <Text style={styles.metricSub}>Ready to pay</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.metricCard, { borderLeftColor: colors.success }]}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('ExpensesTab', { initialFilter: 'PAID' })}
        >
          <Text style={styles.metricLabel}>Paid</Text>
          <Text style={styles.metricValue}>₹{stats.totalPaid.toLocaleString('en-IN')}</Text>
          <Text style={styles.metricSub}>{stats.paidCount} reimbursed</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actionsGrid}>
        <TouchableOpacity
          style={styles.actionTile}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('SubmitExpense')}
        >
          <View style={[styles.tileIconCircle, { backgroundColor: colors.primaryLight }]}>
            <Ionicons name="add" size={22} color={colors.primary} />
          </View>
          <Text style={styles.tileTitle}>New Expense</Text>
          <Text style={styles.tileDesc}>Submit claim & receipt</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionTile}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('ExpensesTab')}
        >
          <View style={[styles.tileIconCircle, { backgroundColor: colors.warningLight }]}>
            <Ionicons name="receipt-outline" size={20} color={colors.warning} />
          </View>
          <Text style={styles.tileTitle}>My Expenses</Text>
          <Text style={styles.tileDesc}>Track reimbursements</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionTile}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('InvoicesTab')}
        >
          <View style={[styles.tileIconCircle, { backgroundColor: colors.infoLight }]}>
            <Ionicons name="document-text-outline" size={20} color={colors.info} />
          </View>
          <Text style={styles.tileTitle}>Invoices</Text>
          <Text style={styles.tileDesc}>Receivables & bills</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionTile}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('PayslipsTab')}
        >
          <View style={[styles.tileIconCircle, { backgroundColor: colors.successLight }]}>
            <Ionicons name="wallet-outline" size={20} color={colors.success} />
          </View>
          <Text style={styles.tileTitle}>My Payslips</Text>
          <Text style={styles.tileDesc}>Salary slips & tax</Text>
        </TouchableOpacity>
      </View>

      {isHrAdmin && (
        <Card style={styles.hrBannerCard}>
          <TouchableOpacity
            style={styles.hrBannerTouchable}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('HRAdmin')}
          >
            <View style={styles.hrBannerIconWrap}>
              <Ionicons name="people" size={24} color="#fff" />
            </View>
            <View style={styles.hrBannerInfo}>
              <Text style={styles.hrBannerTitle}>HR Administration Portal</Text>
              <Text style={styles.hrBannerSub}>
                Workforce directory, onboarding & staff management
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.primary} />
          </TouchableOpacity>
        </Card>
      )}

      {isReviewer && (
        <Card style={styles.reviewerCard}>
          <TouchableOpacity
            style={styles.reviewerHeader}
            activeOpacity={0.7}
            onPress={() =>
              navigation.navigate('ExpensesTab', {
                initialFilter: 'SUBMITTED',
              })
            }
          >
            <Ionicons name="shield-checkmark" size={24} color={colors.primary} style={{ marginRight: spacing.sm }} />
            <View style={styles.reviewerInfo}>
              <Text style={styles.reviewerTitle}>Admin Expense Review</Text>
              <Text style={styles.reviewerDesc}>
                Filter and review claims across your scope
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.primary} />
          </TouchableOpacity>

          <View style={styles.adminFilterRow}>
            <TouchableOpacity
              style={styles.adminFilterBtn}
              onPress={() => navigation.navigate('ExpensesTab', { initialFilter: 'DRAFT' })}
            >
              <Text style={styles.adminFilterBtnText}>Draft</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.adminFilterBtn, styles.adminFilterBtnWarning]}
              onPress={() => navigation.navigate('ExpensesTab', { initialFilter: 'SUBMITTED' })}
            >
              <Text style={[styles.adminFilterBtnText, styles.adminFilterBtnTextWarning]}>
                Submitted ({stats.submittedCount})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.adminFilterBtn, styles.adminFilterBtnPrimary]}
              onPress={() => navigation.navigate('ExpensesTab', { initialFilter: 'APPROVED' })}
            >
              <Text style={[styles.adminFilterBtnText, styles.adminFilterBtnTextPrimary]}>
                Approved
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.adminFilterBtn, styles.adminFilterBtnSuccess]}
              onPress={() => navigation.navigate('ExpensesTab', { initialFilter: 'PAID' })}
            >
              <Text style={[styles.adminFilterBtnText, styles.adminFilterBtnTextSuccess]}>
                Paid ({stats.paidCount})
              </Text>
            </TouchableOpacity>
          </View>
        </Card>
      )}

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Recent Expense Claims</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('ExpensesTab')}
        >
          <Text style={styles.viewAllText}>View All</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
      ) : recentClaims.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Ionicons name="document-text-outline" size={38} color={colors.textLight} style={{ marginBottom: spacing.sm }} />
          <Text style={styles.emptyText}>No recent expense claims</Text>
          <TouchableOpacity
            style={styles.createFirstBtn}
            onPress={() => navigation.navigate('SubmitExpense')}
          >
            <Text style={styles.createFirstText}>+ Create your first expense</Text>
          </TouchableOpacity>
        </Card>
      ) : (
        recentClaims.map((item, index) => (
          <Card
            key={item?.id ? `claim-${item.id}-${index}` : `claim-${index}`}
            style={styles.claimCard}
            onPress={() =>
              navigation.navigate('ExpenseDetail', {
                claimId: item.id,
              })
            }
          >
            <View style={styles.claimRowTop}>
              <View style={styles.claimInfo}>
                <Text style={styles.claimMerchant}>
                  {item.merchantName || item.description || 'Expense Claim'}
                </Text>
                <Text style={styles.claimCategory}>
                  {item.category?.name || 'General Expense'} •{' '}
                  {item.expenseDate
                    ? new Date(item.expenseDate).toLocaleDateString()
                    : 'Recent'}
                </Text>
              </View>
              <View style={styles.claimAmountCol}>
                <Text style={styles.claimAmount}>
                  ₹{Number(item.amount || item.totalAmount || 0).toLocaleString('en-IN')}
                </Text>
                <StatusBadge status={item.status} style={styles.claimBadge} />
              </View>
            </View>
          </Card>
        ))
      )}
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
  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  headerLeft: {
    flex: 1,
  },
  greeting: {
    fontSize: 13,
    color: colors.textMuted,
  },
  userName: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  roleBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  roleText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  deptText: {
    fontSize: 12,
    color: colors.textMuted,
    marginLeft: 6,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  avatarButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    color: colors.textInverse,
    fontSize: 18,
    fontWeight: '700',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  metricCard: {
    flex: 1,
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    ...shadows.sm,
  },
  metricLabel: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    marginVertical: 4,
  },
  metricSub: {
    fontSize: 11,
    color: colors.textLight,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  actionTile: {
    width: '48.5%',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  tileIconCircle: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  tileIcon: {
    fontSize: 18,
  },
  tileTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  tileDesc: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  reviewerCard: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    marginBottom: spacing.md,
  },
  reviewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reviewerIcon: {
    fontSize: 22,
    marginRight: spacing.sm,
  },
  reviewerInfo: {
    flex: 1,
  },
  reviewerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  reviewerDesc: {
    fontSize: 12,
    color: colors.textMuted,
  },
  adminFilterRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: '#DBEAFE',
  },
  adminFilterBtn: {
    flex: 1,
    paddingVertical: 7,
    paddingHorizontal: 4,
    borderRadius: borderRadius.md,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminFilterBtnWarning: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FCD34D',
  },
  adminFilterBtnPrimary: {
    backgroundColor: '#E0E7FF',
    borderColor: '#C7D2FE',
  },
  adminFilterBtnSuccess: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  adminFilterBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.text,
  },
  adminFilterBtnTextWarning: {
    color: '#92400E',
  },
  adminFilterBtnTextPrimary: {
    color: '#3730A3',
  },
  adminFilterBtnTextSuccess: {
    color: '#166534',
  },
  chevron: {
    fontSize: 18,
    color: colors.primary,
    fontWeight: '700',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  viewAllText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
  },
  loader: {
    marginVertical: spacing.lg,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: spacing.sm,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  createFirstBtn: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: borderRadius.md,
  },
  createFirstText: {
    color: colors.primary,
    fontWeight: '600',
    fontSize: 13,
  },
  claimCard: {
    marginBottom: spacing.sm,
  },
  claimRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  claimInfo: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  claimMerchant: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  claimCategory: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  claimAmountCol: {
    alignItems: 'flex-end',
  },
  claimAmount: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  claimBadge: {
    marginTop: 4,
  },
  hrBannerCard: {
    marginBottom: spacing.md,
    padding: spacing.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  hrBannerTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  hrBannerIconWrap: {
    width: 42,
    height: 42,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  hrBannerInfo: {
    flex: 1,
  },
  hrBannerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  hrBannerSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
});
