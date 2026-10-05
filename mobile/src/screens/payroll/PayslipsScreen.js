import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  ScrollView,
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { colors, spacing, borderRadius, shadows } from '../../components/theme';
import StatusBadge from '../../components/StatusBadge';
import Card from '../../components/Card';
import EmptyState from '../../components/EmptyState';
import { listEmployeePayslips } from '../../api/payroll';
import { Ionicons } from '@expo/vector-icons';

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function PayslipsScreen() {
  const { user } = useAuth();
  const [payslips, setPayslips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  // Detailed Payslip Modal State
  const [modalPayslip, setModalPayslip] = useState(null);

  // Filter State
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [selectedYear, setSelectedYear] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');

  // Available Years
  const availableYears = useMemo(() => {
    const cur = new Date().getFullYear();
    const set = new Set([cur, cur - 1, cur - 2]);
    payslips.forEach((p) => {
      if (p.periodYear) set.add(p.periodYear);
    });
    return Array.from(set).sort((a, b) => b - a);
  }, [payslips]);

  const activeFiltersCount = (selectedYear ? 1 : 0) + (selectedMonth ? 1 : 0) + (selectedStatus ? 1 : 0);

  const fetchPayslips = useCallback(async () => {
    const employeeId = user?.employee?.id;
    if (!employeeId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const res = await listEmployeePayslips(employeeId, {
        periodYear: selectedYear || undefined,
        periodMonth: selectedMonth || undefined,
        paymentStatus: selectedStatus || undefined,
      });
      const data = res?.rows || res || [];
      setPayslips(data);
    } catch (err) {
      console.warn('Error fetching payslips:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, selectedYear, selectedMonth, selectedStatus]);

  useEffect(() => {
    setLoading(true);
    fetchPayslips();
  }, [fetchPayslips]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchPayslips();
  };

  const toggleExpand = (id) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const handleResetFilters = () => {
    setSelectedYear('');
    setSelectedMonth('');
    setSelectedStatus('');
    setFilterModalVisible(false);
  };

  const renderItem = ({ item }) => {
    const isExpanded = expandedId === item.id;
    const netPay = Number(item.netSalary || item.netPay || 0);
    const grossPay = Number(item.grossEarnings || item.grossPay || 0);
    const deductions = Number(item.totalDeductions || 0);

    const monthName = item.periodMonth
      ? FULL_MONTH_NAMES[item.periodMonth] || `Month ${item.periodMonth}`
      : item.month || 'Payslip';

    return (
      <Card style={styles.slipCard} onPress={() => toggleExpand(item.id)}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.periodTitle}>
              {monthName} {item.periodYear || '2026'}
            </Text>
            <Text style={styles.slipSub}>
              {item.employee?.employeeCode || user?.employee?.employeeCode || 'EMP'} • {user?.employee ? `${user.employee.firstName} ${user.employee.lastName}` : (user?.name || 'Staff')}
            </Text>
          </View>
          <StatusBadge status={item.paymentStatus || item.status || 'PAID'} />
        </View>

        <View style={styles.amountRow}>
          <View>
            <Text style={styles.netLabel}>Net Take-Home</Text>
            <Text style={styles.netAmount}>₹{netPay.toLocaleString('en-IN')}</Text>
          </View>

          {/* Explicit View Button beside payslip */}
          <TouchableOpacity
            style={styles.viewDetailsBtn}
            activeOpacity={0.7}
            onPress={(e) => {
              e.stopPropagation();
              setModalPayslip(item);
            }}
          >
            <Ionicons name="eye-outline" size={15} color={colors.primary} style={{ marginRight: 4 }} />
            <Text style={styles.viewDetailsBtnText}>View Breakdown</Text>
          </TouchableOpacity>
        </View>

        {isExpanded ? (
          <View style={styles.expandedSection}>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Gross Earnings</Text>
              <Text style={styles.breakdownValue}>
                +₹{grossPay.toLocaleString('en-IN')}
              </Text>
            </View>

            {item.lines
              ?.filter((l) => l.type !== 'DEDUCTION')
              .map((line) => (
                <View key={line.id} style={styles.subItemRow}>
                  <Text style={styles.subItemLabel}>• {line.label}</Text>
                  <Text style={styles.subItemValue}>
                    ₹{Number(line.amount).toLocaleString('en-IN')}
                  </Text>
                </View>
              ))}

            <View style={[styles.breakdownRow, { marginTop: spacing.sm }]}>
              <Text style={styles.breakdownLabel}>Total Deductions</Text>
              <Text style={[styles.breakdownValue, { color: colors.danger }]}>
                -₹{deductions.toLocaleString('en-IN')}
              </Text>
            </View>

            {item.lines
              ?.filter((l) => l.type === 'DEDUCTION')
              .map((line) => (
                <View key={line.id} style={styles.subItemRow}>
                  <Text style={styles.subItemLabel}>• {line.label}</Text>
                  <Text style={[styles.subItemValue, { color: colors.danger }]}>
                    -₹{Number(line.amount).toLocaleString('en-IN')}
                  </Text>
                </View>
              ))}

            <View style={styles.expandedFooter}>
              <TouchableOpacity style={styles.collapseRow} onPress={() => toggleExpand(item.id)}>
                <Text style={styles.tapToClose}>Tap to collapse</Text>
                <Ionicons name="chevron-up" size={13} color={colors.textMuted} style={{ marginLeft: 3 }} />
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.expandRow}>
            <Text style={styles.tapToView}>Tap card to toggle quick preview</Text>
            <Ionicons name="chevron-down" size={13} color={colors.primary} style={{ marginLeft: 3 }} />
          </View>
        )}
      </Card>
    );
  };

  return (
    <View style={styles.container}>
      {/* Top Filter and Controls Bar */}
      <View style={styles.filterTopBar}>
        <View>
          <Text style={styles.filterHeaderTitle}>Monthly Payslips</Text>
          <Text style={styles.filterHeaderSub}>
            {payslips.length} statement{payslips.length === 1 ? '' : 's'} found
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.filterTriggerBtn,
            activeFiltersCount > 0 && styles.filterTriggerBtnActive,
          ]}
          onPress={() => setFilterModalVisible(true)}
          activeOpacity={0.8}
        >
          <Ionicons
            name={activeFiltersCount > 0 ? 'funnel' : 'funnel-outline'}
            size={16}
            color={activeFiltersCount > 0 ? '#fff' : colors.primary}
          />
          <Text
            style={[
              styles.filterTriggerText,
              activeFiltersCount > 0 && styles.filterTriggerTextActive,
            ]}
          >
            Filters
          </Text>
          {activeFiltersCount > 0 && (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{activeFiltersCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Active Filter Pills */}
      {activeFiltersCount > 0 && (
        <View style={styles.activePillsContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillsScroll}>
            {selectedYear ? (
              <View style={styles.pillTag}>
                <Text style={styles.pillText}>Year: {selectedYear}</Text>
                <TouchableOpacity onPress={() => setSelectedYear('')}>
                  <Ionicons name="close-circle" size={14} color={colors.primary} style={{ marginLeft: 4 }} />
                </TouchableOpacity>
              </View>
            ) : null}
            {selectedMonth ? (
              <View style={styles.pillTag}>
                <Text style={styles.pillText}>Month: {MONTH_NAMES[selectedMonth]}</Text>
                <TouchableOpacity onPress={() => setSelectedMonth('')}>
                  <Ionicons name="close-circle" size={14} color={colors.primary} style={{ marginLeft: 4 }} />
                </TouchableOpacity>
              </View>
            ) : null}
            {selectedStatus ? (
              <View style={styles.pillTag}>
                <Text style={styles.pillText}>Status: {selectedStatus}</Text>
                <TouchableOpacity onPress={() => setSelectedStatus('')}>
                  <Ionicons name="close-circle" size={14} color={colors.primary} style={{ marginLeft: 4 }} />
                </TouchableOpacity>
              </View>
            ) : null}
            <TouchableOpacity style={styles.clearAllPill} onPress={handleResetFilters}>
              <Text style={styles.clearAllText}>Clear All</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading payslips...</Text>
        </View>
      ) : (
        <FlatList
          data={payslips}
          keyExtractor={(item, index) => (item?.id ? `payslip-${item.id}-${index}` : `payslip-${index}`)}
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
              title="No payslips available"
              message={
                activeFiltersCount > 0
                  ? 'No payslips match your current filter settings. Try resetting the filters.'
                  : user?.employee
                  ? 'Your payslips will appear here once monthly payroll is approved.'
                  : 'No employee record linked with this account.'
              }
            />
          }
        />
      )}

      {/* Filter Modal */}
      <Modal
        visible={filterModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFilterModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <Ionicons name="options-outline" size={20} color={colors.primary} style={{ marginRight: 6 }} />
                <Text style={styles.modalTitle}>Filter Payslips</Text>
              </View>
              <TouchableOpacity onPress={() => setFilterModalVisible(false)} style={styles.closeBtn}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.filterSheetContent}>
              {/* Year Filter */}
              <Text style={styles.filterSectionTitle}>Period Year</Text>
              <View style={styles.chipRow}>
                <TouchableOpacity
                  style={[styles.chip, !selectedYear && styles.chipActive]}
                  onPress={() => setSelectedYear('')}
                >
                  <Text style={[styles.chipText, !selectedYear && styles.chipTextActive]}>All Years</Text>
                </TouchableOpacity>
                {availableYears.map((yr) => (
                  <TouchableOpacity
                    key={yr}
                    style={[styles.chip, String(selectedYear) === String(yr) && styles.chipActive]}
                    onPress={() => setSelectedYear(String(selectedYear) === String(yr) ? '' : String(yr))}
                  >
                    <Text style={[styles.chipText, String(selectedYear) === String(yr) && styles.chipTextActive]}>
                      {yr}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Month Filter */}
              <Text style={[styles.filterSectionTitle, { marginTop: spacing.md }]}>Period Month</Text>
              <View style={styles.monthGrid}>
                <TouchableOpacity
                  style={[styles.monthChip, !selectedMonth && styles.monthChipActive]}
                  onPress={() => setSelectedMonth('')}
                >
                  <Text style={[styles.monthChipText, !selectedMonth && styles.monthChipTextActive]}>All</Text>
                </TouchableOpacity>
                {MONTH_NAMES.slice(1).map((m, idx) => {
                  const mNum = String(idx + 1);
                  const isSelected = String(selectedMonth) === mNum;
                  return (
                    <TouchableOpacity
                      key={m}
                      style={[styles.monthChip, isSelected && styles.monthChipActive]}
                      onPress={() => setSelectedMonth(isSelected ? '' : mNum)}
                    >
                      <Text style={[styles.monthChipText, isSelected && styles.monthChipTextActive]}>{m}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Status Filter */}
              <Text style={[styles.filterSectionTitle, { marginTop: spacing.md }]}>Payment Status</Text>
              <View style={styles.chipRow}>
                {[
                  { label: 'All Statuses', value: '' },
                  { label: 'Paid', value: 'PAID' },
                  { label: 'Unpaid', value: 'UNPAID' },
                  { label: 'Failed', value: 'FAILED' },
                ].map((s) => (
                  <TouchableOpacity
                    key={s.value}
                    style={[styles.chip, selectedStatus === s.value && styles.chipActive]}
                    onPress={() => setSelectedStatus(s.value)}
                  >
                    <Text style={[styles.chipText, selectedStatus === s.value && styles.chipTextActive]}>
                      {s.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.resetBtn} onPress={handleResetFilters}>
                <Text style={styles.resetBtnText}>Reset</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.applyBtn}
                onPress={() => setFilterModalVisible(false)}
              >
                <Text style={styles.applyBtnText}>Apply Filters</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Detailed Payslip Statement Modal */}
      {modalPayslip && (
        <Modal
          visible={!!modalPayslip}
          transparent
          animationType="fade"
          onRequestClose={() => setModalPayslip(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.payslipModalCard}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalBadgeText}>SALARY STATEMENT</Text>
                  <Text style={styles.modalPeriodTitle}>
                    {FULL_MONTH_NAMES[modalPayslip.periodMonth]} {modalPayslip.periodYear}
                  </Text>
                  <Text style={styles.modalSubEmp}>
                    {modalPayslip.employee?.employeeCode || user?.employee?.employeeCode || 'EMP'} • {user?.employee ? `${user.employee.firstName} ${user.employee.lastName}` : (user?.name || 'Staff')}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setModalPayslip(null)} style={styles.closeBtn}>
                  <Ionicons name="close" size={22} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.payslipModalScroll}>
                {/* Status Row */}
                <View style={styles.modalStatusRow}>
                  <Text style={styles.modalStatusLabel}>Disbursement Status:</Text>
                  <StatusBadge status={modalPayslip.paymentStatus || modalPayslip.status || 'PAID'} />
                </View>

                {/* Earnings List */}
                <Text style={styles.modalSectionHeading}>EARNINGS & ALLOWANCES</Text>
                {modalPayslip.lines
                  ?.filter((l) => l.type !== 'DEDUCTION')
                  .map((line) => (
                    <View key={line.id} style={styles.modalLineRow}>
                      <Text style={styles.modalLineLabel}>{line.label}</Text>
                      <Text style={styles.modalLineVal}>
                        ₹{Number(line.amount).toLocaleString('en-IN')}
                      </Text>
                    </View>
                  ))}

                {/* Deductions List */}
                <Text style={[styles.modalSectionHeading, { marginTop: spacing.md }]}>DEDUCTIONS</Text>
                {modalPayslip.lines
                  ?.filter((l) => l.type === 'DEDUCTION')
                  .map((line) => (
                    <View key={line.id} style={styles.modalLineRow}>
                      <Text style={styles.modalLineLabel}>{line.label}</Text>
                      <Text style={[styles.modalLineVal, { color: colors.danger }]}>
                        −₹{Number(line.amount).toLocaleString('en-IN')}
                      </Text>
                    </View>
                  ))}

                {/* Summary Card */}
                <View style={styles.modalSummaryBox}>
                  <View style={styles.summaryItemRow}>
                    <Text style={styles.summaryItemLabel}>Gross Remuneration:</Text>
                    <Text style={styles.summaryItemVal}>
                      ₹{Number(modalPayslip.grossEarnings || 0).toLocaleString('en-IN')}
                    </Text>
                  </View>
                  <View style={styles.summaryItemRow}>
                    <Text style={styles.summaryItemLabel}>Total Deductions:</Text>
                    <Text style={[styles.summaryItemVal, { color: colors.danger }]}>
                      −₹{Number(modalPayslip.totalDeductions || 0).toLocaleString('en-IN')}
                    </Text>
                  </View>
                  <View style={styles.summaryNetRow}>
                    <Text style={styles.summaryNetLabel}>Net Take-Home</Text>
                    <Text style={styles.summaryNetVal}>
                      ₹{Number(modalPayslip.netSalary || 0).toLocaleString('en-IN')}
                    </Text>
                  </View>
                </View>

                {modalPayslip.paidAt && (
                  <View style={styles.disbursedBox}>
                    <Ionicons name="checkmark-circle-outline" size={16} color={colors.success} style={{ marginRight: 6 }} />
                    <Text style={styles.disbursedText}>
                      Paid via {modalPayslip.paymentMethod?.replace(/_/g, ' ') || 'Bank Transfer'}
                      {modalPayslip.paymentReferenceNo ? ` • Ref #${modalPayslip.paymentReferenceNo}` : ''}
                    </Text>
                  </View>
                )}
              </ScrollView>

              <View style={styles.modalCardFooter}>
                <TouchableOpacity
                  style={styles.closeDoneBtn}
                  onPress={() => setModalPayslip(null)}
                >
                  <Text style={styles.closeDoneBtnText}>Close Statement</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  filterTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  filterHeaderTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  filterHeaderSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  filterTriggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  filterTriggerBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterTriggerText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  filterTriggerTextActive: {
    color: '#fff',
  },
  filterBadge: {
    backgroundColor: '#fff',
    borderRadius: 9,
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.primary,
  },
  activePillsContainer: {
    backgroundColor: colors.surface,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  pillsScroll: {
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pillTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  pillText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
  },
  clearAllPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  clearAllText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
  },
  listContent: {
    padding: spacing.md,
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
  slipCard: {
    marginBottom: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  periodTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  slipSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  netLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  netAmount: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  viewDetailsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  viewDetailsBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  expandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    marginTop: spacing.xs,
  },
  tapToView: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '500',
  },
  expandedSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  breakdownLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  breakdownValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  subItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
    paddingLeft: spacing.sm,
  },
  subItemLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  subItemValue: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  expandedFooter: {
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  collapseRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tapToClose: {
    fontSize: 11,
    color: colors.textMuted,
  },
  // Filter Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    padding: spacing.md,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  closeBtn: {
    padding: 4,
  },
  filterSheetContent: {
    paddingVertical: spacing.sm,
  },
  filterSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  chipTextActive: {
    color: '#fff',
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  monthChip: {
    width: '23%',
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: borderRadius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  monthChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  monthChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  monthChipTextActive: {
    color: '#fff',
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  resetBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  resetBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  applyBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  applyBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  // Payslip Modal Card
  payslipModalCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    margin: spacing.md,
    maxHeight: '85%',
    ...shadows.lg,
  },
  modalBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 0.8,
  },
  modalPeriodTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    marginTop: 2,
  },
  modalSubEmp: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  payslipModalScroll: {
    marginVertical: spacing.sm,
    maxHeight: 380,
  },
  modalStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  modalStatusLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  modalSectionHeading: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textLight,
    letterSpacing: 0.6,
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  modalLineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.borderLight,
  },
  modalLineLabel: {
    fontSize: 13,
    color: colors.text,
  },
  modalLineVal: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  modalSummaryBox: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  summaryItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  summaryItemLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  summaryItemVal: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  summaryNetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  summaryNetLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  summaryNetVal: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.primary,
  },
  disbursedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.successLight,
    padding: 8,
    borderRadius: borderRadius.md,
    marginTop: spacing.sm,
  },
  disbursedText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.success,
  },
  modalCardFooter: {
    paddingTop: spacing.xs,
  },
  closeDoneBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  closeDoneBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
});
