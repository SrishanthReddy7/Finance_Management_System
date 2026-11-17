import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { colors, spacing, borderRadius, shadows, typography } from '../../components/theme';
import StatusBadge from '../../components/StatusBadge';
import Card from '../../components/Card';
import { listClaims } from '../../api/expenses';

export default function DashboardScreen({ navigation }) {
  const { user, can } = useAuth();
  const { width } = useWindowDimensions();

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

  // Responsive calculations
  const isTablet = width >= 768;
  const isSmallDevice = width < 360;

  // Day greeting (Morning, Afternoon, Evening)
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

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

  // Responsive tile sizing
  const actionTileWidth = isTablet ? '23.5%' : isSmallDevice ? '100%' : '48.5%';
  const metricCardWidth = isTablet ? '31.5%' : isSmallDevice ? '100%' : '31.5%';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scrollContent, isTablet && styles.tabletScrollContent]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
      }
    >
      {/* ==================== HERO PROFILE HEADER ==================== */}
      <View style={styles.headerCard}>
        <View style={styles.headerLeft}>
          <Text style={styles.greeting}>{greeting},</Text>
          <Text style={styles.userName} numberOfLines={1}>
            {user?.employee
              ? `${user.employee.firstName} ${user.employee.lastName}`.trim()
              : user?.name || user?.email?.split('@')[0] || 'User'}
          </Text>
          <View style={styles.roleRow}>
            <View style={styles.roleBadge}>
              <View style={styles.roleDot} />
              <Text style={styles.roleText}>{user?.roleName || user?.roleType || 'Staff'}</Text>
            </View>
            {user?.employee?.department?.name && (
              <Text style={styles.deptText} numberOfLines={1}>
                • {user.employee.department.name}
              </Text>
            )}
          </View>
        </View>

        <TouchableOpacity
          style={styles.avatarButton}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('ProfileTab')}
        >
          <Text style={styles.avatarLetter}>
            {((user?.employee?.firstName || user?.name || user?.email || 'U')[0] || 'U').toUpperCase()}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ==================== FINANCIAL METRICS ROW ==================== */}
      <View style={[styles.metricsRow, isSmallDevice && styles.metricsRowStacked]}>
        <TouchableOpacity
          style={[styles.metricCard, { width: metricCardWidth, borderLeftColor: colors.warning }]}
          activeOpacity={0.75}
          onPress={() => navigation.navigate('ExpensesTab', { initialFilter: 'SUBMITTED' })}
        >
          <View style={styles.metricHeaderRow}>
            <Text style={styles.metricLabel}>Pending</Text>
            <View style={[styles.metricDot, { backgroundColor: colors.warning }]} />
          </View>
          <Text
            style={[styles.metricValue, isSmallDevice && { fontSize: 16 }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            ₹{stats.pendingExpenses.toLocaleString('en-IN')}
          </Text>
          <Text style={styles.metricSub}>{stats.submittedCount} awaiting review</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.metricCard, { width: metricCardWidth, borderLeftColor: colors.info }]}
          activeOpacity={0.75}
          onPress={() => navigation.navigate('ExpensesTab', { initialFilter: 'APPROVED' })}
        >
          <View style={styles.metricHeaderRow}>
            <Text style={styles.metricLabel}>Approved</Text>
            <View style={[styles.metricDot, { backgroundColor: colors.info }]} />
          </View>
          <Text
            style={[styles.metricValue, isSmallDevice && { fontSize: 16 }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            ₹{stats.totalApproved.toLocaleString('en-IN')}
          </Text>
          <Text style={styles.metricSub}>Ready to pay</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.metricCard, { width: metricCardWidth, borderLeftColor: colors.success }]}
          activeOpacity={0.75}
          onPress={() => navigation.navigate('ExpensesTab', { initialFilter: 'PAID' })}
        >
          <View style={styles.metricHeaderRow}>
            <Text style={styles.metricLabel}>Paid</Text>
            <View style={[styles.metricDot, { backgroundColor: colors.success }]} />
          </View>
          <Text
            style={[styles.metricValue, isSmallDevice && { fontSize: 16 }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            ₹{stats.totalPaid.toLocaleString('en-IN')}
          </Text>
          <Text style={styles.metricSub}>{stats.paidCount} reimbursed</Text>
        </TouchableOpacity>
      </View>

      {/* ==================== QUICK ACTIONS GRID ==================== */}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
      </View>

      <View style={styles.actionsGrid}>
        <TouchableOpacity
          style={[styles.actionTile, { width: actionTileWidth }]}
          activeOpacity={0.75}
          onPress={() => navigation.navigate('SubmitExpense')}
        >
          <View style={[styles.tileIconCircle, { backgroundColor: colors.primaryLight }]}>
            <Ionicons name="add" size={24} color={colors.primary} />
          </View>
          <View style={styles.tileTextWrap}>
            <Text style={styles.tileTitle}>New Expense</Text>
            <Text style={styles.tileDesc}>Submit claim & receipt</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionTile, { width: actionTileWidth }]}
          activeOpacity={0.75}
          onPress={() => navigation.navigate('ExpensesTab')}
        >
          <View style={[styles.tileIconCircle, { backgroundColor: colors.warningLight }]}>
            <Ionicons name="receipt-outline" size={22} color={colors.warning} />
          </View>
          <View style={styles.tileTextWrap}>
            <Text style={styles.tileTitle}>My Expenses</Text>
            <Text style={styles.tileDesc}>Track reimbursements</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionTile, { width: actionTileWidth }]}
          activeOpacity={0.75}
          onPress={() => navigation.navigate('InvoicesTab')}
        >
          <View style={[styles.tileIconCircle, { backgroundColor: colors.infoLight }]}>
            <Ionicons name="document-text-outline" size={22} color={colors.info} />
          </View>
          <View style={styles.tileTextWrap}>
            <Text style={styles.tileTitle}>Invoices</Text>
            <Text style={styles.tileDesc}>Client bills & payments</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionTile, { width: actionTileWidth }]}
          activeOpacity={0.75}
          onPress={() => navigation.navigate('PayslipsTab')}
        >
          <View style={[styles.tileIconCircle, { backgroundColor: colors.successLight }]}>
            <Ionicons name="wallet-outline" size={22} color={colors.success} />
          </View>
          <View style={styles.tileTextWrap}>
            <Text style={styles.tileTitle}>My Payslips</Text>
            <Text style={styles.tileDesc}>Salary breakdown & tax</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* ==================== ROLE-BASED PORTALS ==================== */}
      {isHrAdmin && (
        <Card style={styles.hrBannerCard}>
          <TouchableOpacity
            style={styles.hrBannerTouchable}
            activeOpacity={0.75}
            onPress={() => navigation.navigate('HRAdmin')}
          >
            <View style={styles.hrBannerIconWrap}>
              <Ionicons name="people" size={22} color="#FFFFFF" />
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
            activeOpacity={0.75}
            onPress={() =>
              navigation.navigate('ExpensesTab', {
                initialFilter: 'SUBMITTED',
              })
            }
          >
            <View style={styles.reviewerIconCircle}>
              <Ionicons name="shield-checkmark" size={20} color={colors.primary} />
            </View>
            <View style={styles.reviewerInfo}>
              <Text style={styles.reviewerTitle}>Admin Expense Review</Text>
              <Text style={styles.reviewerDesc}>
                Filter and review claims across your team
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

      {/* ==================== RECENT CLAIMS SECTION ==================== */}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Recent Expense Claims</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('ExpensesTab')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.viewAllText}>View All</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
      ) : recentClaims.length === 0 ? (
        <Card style={styles.emptyCard}>
          <View style={styles.emptyIconCircle}>
            <Ionicons name="document-text-outline" size={32} color={colors.textLight} />
          </View>
          <Text style={styles.emptyText}>No recent expense claims</Text>
          <TouchableOpacity
            style={styles.createFirstBtn}
            onPress={() => navigation.navigate('SubmitExpense')}
          >
            <Ionicons name="add" size={16} color="#FFFFFF" style={{ marginRight: 4 }} />
            <Text style={styles.createFirstText}>Submit first expense</Text>
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
                <Text style={styles.claimMerchant} numberOfLines={1}>
                  {item.merchantName || item.purpose || item.description || 'Expense Claim'}
                </Text>
                <Text style={styles.claimCategory} numberOfLines={1}>
                  {item.category?.name || 'General Expense'}
                  {item.expenseDate
                    ? ` • ${new Date(item.expenseDate).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                      })}`
                    : ''}
                </Text>
              </View>

              <View style={styles.claimAmountCol}>
                <Text style={styles.claimAmount}>
                  ₹{Number(item.amount || item.totalAmount || 0).toLocaleString('en-IN')}
                </Text>
                <StatusBadge status={item.status} size="sm" style={styles.claimBadge} />
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
    paddingBottom: spacing.xxl,
  },
  tabletScrollContent: {
    paddingHorizontal: spacing.xl,
    maxWidth: 900,
    alignSelf: 'center',
    width: '100%',
  },
  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    padding: spacing.md + 2,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  headerLeft: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  greeting: {
    fontSize: typography.sm,
    color: colors.textMuted,
    fontWeight: '500',
  },
  userName: {
    fontSize: typography.xl,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.3,
    marginTop: 1,
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    flexWrap: 'wrap',
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  roleDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginRight: 5,
  },
  roleText: {
    fontSize: typography.xs,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  deptText: {
    fontSize: typography.xs,
    color: colors.textMuted,
    marginLeft: 6,
    fontWeight: '500',
  },
  avatarButton: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.primaryGlow,
  },
  avatarLetter: {
    color: colors.textInverse,
    fontSize: typography.lg,
    fontWeight: '800',
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  metricsRowStacked: {
    flexDirection: 'column',
    gap: spacing.sm,
  },
  metricCard: {
    backgroundColor: colors.surface,
    padding: spacing.md - 2,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    ...shadows.sm,
  },
  metricHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metricDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  metricLabel: {
    fontSize: typography.xs,
    color: colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metricValue: {
    fontSize: typography.lg,
    fontWeight: '800',
    color: colors.text,
    marginVertical: 4,
    letterSpacing: -0.3,
  },
  metricSub: {
    fontSize: typography.xs,
    color: colors.textLight,
    fontWeight: '500',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: typography.md,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.2,
  },
  viewAllText: {
    fontSize: typography.sm,
    fontWeight: '600',
    color: colors.primary,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  actionTile: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: spacing.md - 2,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  tileIconCircle: {
    width: 42,
    height: 42,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm + 2,
  },
  tileTextWrap: {
    flex: 1,
  },
  tileTitle: {
    fontSize: typography.base,
    fontWeight: '700',
    color: colors.text,
  },
  tileDesc: {
    fontSize: typography.xs,
    color: colors.textMuted,
    marginTop: 1,
  },
  hrBannerCard: {
    backgroundColor: '#FAF5FF',
    borderColor: '#E9D5FF',
    marginBottom: spacing.md,
    padding: spacing.sm + 2,
  },
  hrBannerTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  hrBannerIconWrap: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colors.purple,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm + 2,
  },
  hrBannerInfo: {
    flex: 1,
  },
  hrBannerTitle: {
    fontSize: typography.base,
    fontWeight: '700',
    color: colors.purpleText,
  },
  hrBannerSub: {
    fontSize: typography.xs,
    color: colors.textMuted,
    marginTop: 1,
  },
  reviewerCard: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primaryBorder,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  reviewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reviewerIconCircle: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  reviewerInfo: {
    flex: 1,
  },
  reviewerTitle: {
    fontSize: typography.base,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  reviewerDesc: {
    fontSize: typography.xs,
    color: colors.textMuted,
    marginTop: 1,
  },
  adminFilterRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: spacing.sm + 4,
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
    fontSize: 10.5,
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
    color: '#065F46',
  },
  loader: {
    marginVertical: spacing.xl,
  },
  emptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  emptyIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyText: {
    fontSize: typography.sm,
    color: colors.textMuted,
    fontWeight: '500',
    marginBottom: spacing.md,
  },
  createFirstBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: borderRadius.md,
    ...shadows.sm,
  },
  createFirstText: {
    color: '#FFFFFF',
    fontSize: typography.sm,
    fontWeight: '700',
  },
  claimCard: {
    marginBottom: spacing.sm,
    padding: spacing.md - 2,
  },
  claimRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  claimInfo: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  claimMerchant: {
    fontSize: typography.base,
    fontWeight: '700',
    color: colors.text,
  },
  claimCategory: {
    fontSize: typography.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  claimAmountCol: {
    alignItems: 'flex-end',
  },
  claimAmount: {
    fontSize: typography.md,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 4,
  },
  claimBadge: {
    alignSelf: 'flex-end',
  },
});
