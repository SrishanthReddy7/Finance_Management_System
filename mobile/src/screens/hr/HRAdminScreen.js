import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Modal,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { colors, spacing, borderRadius, shadows } from '../../components/theme';
import StatusBadge from '../../components/StatusBadge';
import Card from '../../components/Card';
import EmptyState from '../../components/EmptyState';
import Button from '../../components/Button';
import Input from '../../components/Input';
import { listUsersApi, createEmployeeApi, setUserStatusApi } from '../../api/employees';
import { listDepartmentsApi } from '../../api/departments';
import { unwrapError } from '../../api/unwrap';
import { useAuth } from '../../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';

export default function HRAdminScreen() {
  const { user } = useAuth();

  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');

  // Modal State for Onboarding New Staff
  const [onboardModalVisible, setOnboardModalVisible] = useState(false);
  const [formFirstName, setFormFirstName] = useState('');
  const [formLastName, setFormLastName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formTempPassword, setFormTempPassword] = useState('Passw0rd!123');
  const [formCode, setFormCode] = useState('');
  const [formDesignation, setFormDesignation] = useState('');
  const [formDeptId, setFormDeptId] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [usersRes, deptsRes] = await Promise.all([
        listUsersApi({ pageSize: 100 }),
        listDepartmentsApi({ includeInactive: true }),
      ]);
      setEmployees(usersRes?.rows || usersRes || []);
      setDepartments(deptsRes || []);
    } catch (err) {
      console.warn('Error fetching HR data:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  // Toggle user status (Activate / Deactivate)
  const handleToggleStatus = (target) => {
    if (target.id === user?.id) {
      Alert.alert('Permission Denied', 'You cannot change your own account status.');
      return;
    }

    const nextStatus = target.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const actionName = nextStatus === 'ACTIVE' ? 'activate' : 'deactivate';

    Alert.alert(
      `Confirm ${actionName.toUpperCase()}`,
      `Are you sure you want to ${actionName} the account for ${target.employee?.firstName || target.email}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Yes, ${actionName}`,
          style: nextStatus === 'INACTIVE' ? 'destructive' : 'default',
          onPress: async () => {
            try {
              await setUserStatusApi(target.id, nextStatus);
              Alert.alert('Success', `Account has been updated to ${nextStatus}.`);
              fetchData();
            } catch (err) {
              Alert.alert('Action Failed', unwrapError(err, 'Could not change account status.'));
            }
          },
        },
      ]
    );
  };

  // Onboard New Staff Submission
  const handleOnboardSubmit = async () => {
    if (!formFirstName.trim() || !formLastName.trim()) {
      setFormError('Please enter both first and last name.');
      return;
    }
    if (!formEmail.trim()) {
      setFormError('Please enter a valid work email.');
      return;
    }
    if (!formCode.trim()) {
      setFormError('Please enter an employee code (e.g. EMP-008).');
      return;
    }
    if (!formDesignation.trim()) {
      setFormError('Please enter a designation.');
      return;
    }
    if (formTempPassword.length < 8) {
      setFormError('Password must be at least 8 characters long.');
      return;
    }

    setFormError('');
    setFormLoading(true);

    try {
      await createEmployeeApi({
        firstName: formFirstName.trim(),
        lastName: formLastName.trim(),
        email: formEmail.trim(),
        temporaryPassword: formTempPassword,
        employeeCode: formCode.trim().toUpperCase(),
        designation: formDesignation.trim(),
        departmentId: formDeptId || undefined,
        roleType: 'USER',
      });

      setFormLoading(false);
      setOnboardModalVisible(false);

      // Reset form
      setFormFirstName('');
      setFormLastName('');
      setFormEmail('');
      setFormCode('');
      setFormDesignation('');
      setFormDeptId('');
      setFormTempPassword('Passw0rd!123');

      Alert.alert('Onboarded!', 'New staff member has been successfully registered.');
      fetchData();
    } catch (err) {
      setFormLoading(false);
      setFormError(unwrapError(err, 'Could not onboard this employee.'));
    }
  };

  // Filtered employees
  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      const q = searchQuery.toLowerCase().trim();
      const fullName = `${emp.employee?.firstName || ''} ${emp.employee?.lastName || ''}`.toLowerCase();
      const email = (emp.email || '').toLowerCase();
      const code = (emp.employee?.employeeCode || '').toLowerCase();
      const designation = (emp.employee?.designation || '').toLowerCase();
      const matchesSearch =
        !q ||
        fullName.includes(q) ||
        email.includes(q) ||
        code.includes(q) ||
        designation.includes(q);

      const matchesDept = selectedDept === 'ALL' || emp.employee?.departmentId === selectedDept;
      const matchesStatus = selectedStatus === 'ALL' || emp.status === selectedStatus;

      return matchesSearch && matchesDept && matchesStatus;
    });
  }, [employees, searchQuery, selectedDept, selectedStatus]);

  // Aggregate stats
  const totalStaff = employees.length;
  const activeStaff = employees.filter((e) => e.status === 'ACTIVE').length;
  const totalDepts = departments.length;

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      {/* Top Banner */}
      <View style={styles.topCard}>
        <View style={styles.topCardHeader}>
          <View style={styles.topCardBadge}>
            <Ionicons name="shield-checkmark" size={18} color={colors.primary} />
            <Text style={styles.topCardBadgeText}>HR Administrator Portal</Text>
          </View>
          <Text style={styles.topCardSub}>Role-Based Staff Governance</Text>
        </View>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{totalStaff}</Text>
            <Text style={styles.statLabel}>Total Staff</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={[styles.statNumber, { color: colors.success }]}>{activeStaff}</Text>
            <Text style={styles.statLabel}>Active</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{totalDepts}</Text>
            <Text style={styles.statLabel}>Departments</Text>
          </View>
        </View>
      </View>

      {/* Onboard Button */}
      <TouchableOpacity
        style={styles.onboardBtn}
        activeOpacity={0.8}
        onPress={() => {
          setFormError('');
          setOnboardModalVisible(true);
        }}
      >
        <Ionicons name="person-add" size={18} color="#fff" />
        <Text style={styles.onboardBtnText}>Onboard New Employee</Text>
      </TouchableOpacity>

      {/* Search Input */}
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={colors.textMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name, email, code, designation..."
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          clearButtonMode="while-editing"
        />
        {!!searchQuery && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Department Filter Chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterScroll}
      >
        <TouchableOpacity
          style={[styles.filterChip, selectedDept === 'ALL' && styles.filterChipActive]}
          onPress={() => setSelectedDept('ALL')}
        >
          <Text
            style={[styles.filterChipText, selectedDept === 'ALL' && styles.filterChipTextActive]}
          >
            All Depts ({totalStaff})
          </Text>
        </TouchableOpacity>
        {departments.map((dept) => {
          const count = employees.filter((e) => e.employee?.departmentId === dept.id).length;
          const isSelected = selectedDept === dept.id;
          return (
            <TouchableOpacity
              key={dept.id}
              style={[styles.filterChip, isSelected && styles.filterChipActive]}
              onPress={() => setSelectedDept(dept.id)}
            >
              <Text
                style={[styles.filterChipText, isSelected && styles.filterChipTextActive]}
              >
                {dept.name} ({count})
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Status Filter Chips */}
      <View style={styles.statusChipsRow}>
        {['ALL', 'ACTIVE', 'INACTIVE', 'PENDING'].map((st) => {
          const isSelected = selectedStatus === st;
          return (
            <TouchableOpacity
              key={st}
              style={[styles.statusChip, isSelected && styles.statusChipActive]}
              onPress={() => setSelectedStatus(st)}
            >
              <Text style={[styles.statusChipText, isSelected && styles.statusChipTextActive]}>
                {st}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          Workforce Directory ({filteredEmployees.length})
        </Text>
      </View>
    </View>
  );

  const renderEmployeeCard = ({ item }) => {
    const name = item.employee
      ? `${item.employee.firstName} ${item.employee.lastName}`
      : item.email;
    const initial = (name || 'E').charAt(0).toUpperCase();
    const dept = departments.find((d) => d.id === item.employee?.departmentId)?.name || 'General';
    const isSelf = item.id === user?.id;

    return (
      <Card style={styles.empCard}>
        <View style={styles.empRow}>
          {/* Avatar Initial */}
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>

          {/* Details */}
          <View style={styles.empInfo}>
            <View style={styles.empNameRow}>
              <Text style={styles.empName} numberOfLines={1}>
                {name}
              </Text>
              {item.employee?.employeeCode && (
                <View style={styles.codeBadge}>
                  <Text style={styles.codeBadgeText}>{item.employee.employeeCode}</Text>
                </View>
              )}
            </View>

            <Text style={styles.empEmail} numberOfLines={1}>
              {item.email}
            </Text>

            <View style={styles.metaRow}>
              <View style={styles.tagBadge}>
                <Ionicons name="briefcase-outline" size={12} color={colors.primary} />
                <Text style={styles.tagBadgeText}>
                  {item.employee?.designation || 'Staff'}
                </Text>
              </View>

              <View style={styles.tagBadge}>
                <Ionicons name="business-outline" size={12} color={colors.textMuted} />
                <Text style={styles.tagBadgeText}>{dept}</Text>
              </View>
            </View>

            {/* Role & Status */}
            <View style={styles.statusRow}>
              <View style={styles.roleChip}>
                <Text style={styles.roleChipText}>{item.role?.name || item.roleType}</Text>
              </View>
              <StatusBadge status={item.status} />
            </View>
          </View>
        </View>

        {/* Action Bar */}
        <View style={styles.cardActions}>
          <Text style={styles.joinedText}>
            {item.employee?.dateOfJoining
              ? `Joined ${new Date(item.employee.dateOfJoining).toLocaleDateString()}`
              : 'Active account'}
          </Text>

          {!isSelf && (
            <TouchableOpacity
              style={[
                styles.actionToggleBtn,
                item.status === 'ACTIVE' ? styles.actionDeactivate : styles.actionActivate,
              ]}
              onPress={() => handleToggleStatus(item)}
            >
              <Ionicons
                name={item.status === 'ACTIVE' ? 'ban-outline' : 'checkmark-circle-outline'}
                size={14}
                color={item.status === 'ACTIVE' ? colors.danger : colors.success}
              />
              <Text
                style={[
                  styles.actionToggleText,
                  item.status === 'ACTIVE'
                    ? { color: colors.danger }
                    : { color: colors.success },
                ]}
              >
                {item.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </Card>
    );
  };

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading HR directory…</Text>
        </View>
      ) : (
        <FlatList
          data={filteredEmployees}
          keyExtractor={(item) => item.id}
          renderItem={renderEmployeeCard}
          ListHeaderComponent={renderHeader}
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
              icon="people-outline"
              title="No Staff Found"
              description={
                searchQuery || selectedDept !== 'ALL' || selectedStatus !== 'ALL'
                  ? 'No employees match the applied filter criteria.'
                  : 'No employees found in the directory.'
              }
              actionLabel="Onboard Staff"
              onAction={() => setOnboardModalVisible(true)}
            />
          }
        />
      )}

      {/* Onboard Staff Modal */}
      <Modal
        visible={onboardModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setOnboardModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <Ionicons name="person-add" size={20} color={colors.primary} />
                <Text style={styles.modalTitle}>Onboard New Employee</Text>
              </View>
              <TouchableOpacity
                onPress={() => setOnboardModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
              {!!formError && (
                <View style={styles.modalErrorBanner}>
                  <Ionicons name="alert-circle" size={16} color={colors.danger} />
                  <Text style={styles.modalErrorText}>{formError}</Text>
                </View>
              )}

              <View style={styles.nameRow}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Input
                    label="First Name *"
                    placeholder="e.g. Rahul"
                    value={formFirstName}
                    onChangeText={setFormFirstName}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Input
                    label="Last Name *"
                    placeholder="e.g. Sharma"
                    value={formLastName}
                    onChangeText={setFormLastName}
                  />
                </View>
              </View>

              <Input
                label="Work Email *"
                placeholder="e.g. employee@company.com"
                value={formEmail}
                onChangeText={setFormEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />

              <Input
                label="Employee Code *"
                placeholder="e.g. EMP-008"
                value={formCode}
                onChangeText={setFormCode}
                autoCapitalize="characters"
              />

              <Input
                label="Designation *"
                placeholder="e.g. Software Engineer / HR Associate"
                value={formDesignation}
                onChangeText={setFormDesignation}
              />

              {/* Department Picker */}
              <Text style={styles.pickerLabel}>Department</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.deptPickerScroll}
              >
                {departments.map((d) => {
                  const isChosen = formDeptId === d.id;
                  return (
                    <TouchableOpacity
                      key={d.id}
                      style={[styles.deptPickerChip, isChosen && styles.deptPickerChipActive]}
                      onPress={() => setFormDeptId(d.id)}
                    >
                      <Text
                        style={[
                          styles.deptPickerChipText,
                          isChosen && styles.deptPickerChipTextActive,
                        ]}
                      >
                        {d.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <Input
                label="Temporary Password *"
                placeholder="Min. 8 characters"
                value={formTempPassword}
                onChangeText={setFormTempPassword}
              />

              <View style={styles.modalBtnRow}>
                <Button
                  title="Cancel"
                  variant="outline"
                  onPress={() => setOnboardModalVisible(false)}
                  style={{ flex: 1, marginRight: 8 }}
                />
                <Button
                  title={formLoading ? 'Registering…' : 'Register Staff'}
                  onPress={handleOnboardSubmit}
                  loading={formLoading}
                  style={{ flex: 1 }}
                />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  loadingText: {
    marginTop: spacing.md,
    color: colors.textMuted,
    fontSize: 14,
  },
  listContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  headerContainer: {
    marginBottom: spacing.md,
  },
  topCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  topCardHeader: {
    marginBottom: spacing.md,
  },
  topCardBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  topCardBadgeText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  topCardSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  statLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
    marginTop: 2,
    textTransform: 'uppercase',
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: colors.border,
  },
  onboardBtn: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: borderRadius.md,
    gap: 8,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  onboardBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: 12,
    height: 42,
    marginBottom: spacing.sm,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
    height: '100%',
  },
  filterScroll: {
    paddingVertical: 4,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.full,
    marginRight: 6,
  },
  filterChipActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  filterChipTextActive: {
    color: colors.primary,
  },
  statusChipsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
    marginBottom: spacing.md,
  },
  statusChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
  },
  statusChipTextActive: {
    color: '#fff',
  },
  sectionHeader: {
    marginTop: 4,
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  empCard: {
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  empRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.primary,
  },
  empInfo: {
    flex: 1,
  },
  empNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  empName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  codeBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 6,
  },
  codeBadgeText: {
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontWeight: '600',
    color: colors.textSecondary,
  },
  empEmail: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  tagBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4,
  },
  tagBadgeText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  roleChip: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  roleChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.sm,
    paddingTop: spacing.xs,
  },
  joinedText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  actionToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
  },
  actionDeactivate: {
    backgroundColor: '#FFF1F2',
  },
  actionActivate: {
    backgroundColor: '#ECFDF5',
  },
  actionToggleText: {
    fontSize: 11,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    maxHeight: '90%',
    padding: spacing.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  modalScroll: {
    marginBottom: spacing.md,
  },
  modalErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFF1F2',
    padding: 10,
    borderRadius: borderRadius.md,
    marginBottom: spacing.md,
  },
  modalErrorText: {
    fontSize: 12,
    color: colors.danger,
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
  },
  pickerLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 6,
  },
  deptPickerScroll: {
    marginBottom: spacing.md,
  },
  deptPickerChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
  },
  deptPickerChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  deptPickerChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  deptPickerChipTextActive: {
    color: '#fff',
  },
  modalBtnRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
});
