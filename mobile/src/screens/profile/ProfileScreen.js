import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { colors, spacing, borderRadius, shadows } from '../../components/theme';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Input from '../../components/Input';
import { testConnection } from '../../api/client';
import { Ionicons } from '@expo/vector-icons';

export default function ProfileScreen({ navigation }) {
  const { user, logout, serverUrl, changeServerUrl } = useAuth();

  const isHrAdmin =
    user?.roleName === 'HR Admin' ||
    user?.role?.name === 'HR Admin';

  const [settingsModal, setSettingsModal] = useState(false);
  const [customUrl, setCustomUrl] = useState(serverUrl);
  const [testing, setTesting] = useState(false);
  const [pingResult, setPingResult] = useState(null);

  function handleLogout() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => logout() },
    ]);
  }

  async function handleTest(url) {
    setTesting(true);
    setPingResult(null);
    const res = await testConnection(url || customUrl);
    setTesting(false);
    setPingResult(res);
  }

  async function handleSaveServer() {
    if (!customUrl.trim()) {
      Alert.alert('Error', 'Server URL cannot be empty.');
      return;
    }
    await changeServerUrl(customUrl.trim());
    setSettingsModal(false);
    setPingResult(null);
    Alert.alert('Saved', 'API base URL updated.');
  }

  const employee = user?.employee;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <Card style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {((employee?.firstName || user?.name || user?.email || 'U')[0] || 'U').toUpperCase()}
          </Text>
        </View>

        <Text style={styles.userName}>
          {employee ? `${employee.firstName} ${employee.lastName}`.trim() : user?.name || user?.email || 'User Profile'}
        </Text>
        <Text style={styles.userEmail}>{user?.email}</Text>

        <View style={styles.roleBadge}>
          <Text style={styles.roleText}>{user?.roleName || user?.roleType || 'Employee'}</Text>
        </View>
      </Card>

      {employee && (
        <Card>
          <Text style={styles.sectionTitle}>Employee Information</Text>

          <View style={styles.infoRow}>
            <View style={styles.infoLabelRow}>
              <Ionicons name="card-outline" size={14} color={colors.textLight} style={{ marginRight: 6 }} />
              <Text style={styles.infoLabel}>Employee Code</Text>
            </View>
            <Text style={styles.infoValue}>{employee.employeeCode || 'N/A'}</Text>
          </View>

          {employee.department && (
            <View style={styles.infoRow}>
              <View style={styles.infoLabelRow}>
                <Ionicons name="business-outline" size={14} color={colors.textLight} style={{ marginRight: 6 }} />
                <Text style={styles.infoLabel}>Department</Text>
              </View>
              <Text style={styles.infoValue}>{employee.department.name}</Text>
            </View>
          )}

          {employee.designation && (
            <View style={styles.infoRow}>
              <View style={styles.infoLabelRow}>
                <Ionicons name="ribbon-outline" size={14} color={colors.textLight} style={{ marginRight: 6 }} />
                <Text style={styles.infoLabel}>Designation</Text>
              </View>
              <Text style={styles.infoValue}>{employee.designation}</Text>
            </View>
          )}

          {employee.joiningDate && (
            <View style={styles.infoRow}>
              <View style={styles.infoLabelRow}>
                <Ionicons name="calendar-outline" size={14} color={colors.textLight} style={{ marginRight: 6 }} />
                <Text style={styles.infoLabel}>Joining Date</Text>
              </View>
              <Text style={styles.infoValue}>
                {new Date(employee.joiningDate).toLocaleDateString('en-IN')}
              </Text>
            </View>
          )}
        </Card>
      )}

      {isHrAdmin && (
        <Card style={styles.hrMenuCard}>
          <TouchableOpacity
            style={styles.hrMenuRow}
            activeOpacity={0.7}
            onPress={() => navigation?.navigate('HRAdmin')}
          >
            <View style={styles.hrMenuIcon}>
              <Ionicons name="people" size={20} color="#fff" />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.hrMenuTitle}>HR Administration Portal</Text>
              <Text style={styles.hrMenuSub}>Manage staff directory, onboarding & status</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.primary} />
          </TouchableOpacity>
        </Card>
      )}

      <Card>
        <Text style={styles.sectionTitle}>Network & Server</Text>
        <Text style={styles.serverInfoText}>
          Connected to: <Text style={styles.serverUrlHighlight}>{serverUrl}</Text>
        </Text>

        <Button
          title="Change Backend URL"
          variant="outline"
          onPress={() => {
            setCustomUrl(serverUrl);
            setSettingsModal(true);
          }}
          style={styles.serverChangeBtn}
        />
      </Card>

      <Button
        title="Sign Out"
        variant="danger"
        onPress={handleLogout}
        style={styles.logoutBtn}
      />

      <Modal
        visible={settingsModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSettingsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Backend Server URL</Text>

            <Input
              label="API Base URL"
              value={customUrl}
              onChangeText={setCustomUrl}
              autoCapitalize="none"
              style={{ marginTop: spacing.sm }}
            />

            <View style={styles.presetRow}>
              <TouchableOpacity
                style={styles.presetChip}
                onPress={() => {
                  setCustomUrl('http://192.168.29.16:5000/api/v1');
                  handleTest('http://192.168.29.16:5000/api/v1');
                }}
              >
                <View style={styles.presetChipContent}>
                  <Ionicons name="wifi-outline" size={13} color={colors.primary} style={{ marginRight: 4 }} />
                  <Text style={styles.presetText}>Wi-Fi Phone (192.168.29.16)</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.presetChip}
                onPress={() => {
                  setCustomUrl('http://localhost:5000/api/v1');
                  handleTest('http://localhost:5000/api/v1');
                }}
              >
                <View style={styles.presetChipContent}>
                  <Ionicons name="laptop-outline" size={13} color={colors.primary} style={{ marginRight: 4 }} />
                  <Text style={styles.presetText}>Localhost / Web</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.presetChip}
                onPress={() => {
                  setCustomUrl('http://10.0.2.2:5000/api/v1');
                  handleTest('http://10.0.2.2:5000/api/v1');
                }}
              >
                <View style={styles.presetChipContent}>
                  <Ionicons name="phone-portrait-outline" size={13} color={colors.primary} style={{ marginRight: 4 }} />
                  <Text style={styles.presetText}>Android (10.0.2.2)</Text>
                </View>
              </TouchableOpacity>
            </View>

            {pingResult && (
              <View
                style={[
                  styles.pingBox,
                  pingResult.ok ? styles.pingSuccess : styles.pingFail,
                ]}
              >
                <View style={styles.pingRow}>
                  <Ionicons
                    name={pingResult.ok ? 'checkmark-circle' : 'alert-circle'}
                    size={16}
                    color={pingResult.ok ? colors.successText : colors.dangerText}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.pingText,
                      pingResult.ok ? styles.pingSuccessText : styles.pingFailText,
                      { flex: 1 },
                    ]}
                  >
                    {pingResult.ok
                      ? 'Server connection OK'
                      : `Connection error: ${pingResult.error}`}
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.modalActions}>
              <Button
                title="Test Ping"
                variant="outline"
                loading={testing}
                onPress={() => handleTest()}
                style={styles.halfBtn}
              />
              <Button
                title="Save & Connect"
                variant="primary"
                onPress={handleSaveServer}
                style={styles.halfBtn}
              />
            </View>

            <Button
              title="Close"
              variant="secondary"
              onPress={() => setSettingsModal(false)}
              style={styles.closeBtn}
            />
          </View>
        </View>
      </Modal>
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
  profileCard: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.textInverse,
  },
  userName: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  userEmail: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  roleBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  roleText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceSubtle,
  },
  infoLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 13,
    color: colors.textMuted,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  serverInfoText: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  serverUrlHighlight: {
    color: colors.primary,
    fontWeight: '600',
  },
  serverChangeBtn: {
    marginTop: spacing.xs,
  },
  logoutBtn: {
    marginTop: spacing.md,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    ...shadows.md,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  presetChip: {
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  presetChipContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  presetText: {
    fontSize: 12,
    color: colors.text,
    fontWeight: '500',
  },
  pingBox: {
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    marginBottom: spacing.md,
  },
  pingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pingSuccess: {
    backgroundColor: colors.successLight,
  },
  pingFail: {
    backgroundColor: colors.dangerLight,
  },
  pingText: {
    fontSize: 12,
    fontWeight: '600',
  },
  pingSuccessText: {
    color: colors.successText,
  },
  pingFailText: {
    color: colors.dangerText,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  halfBtn: {
    flex: 1,
  },
  closeBtn: {
    marginTop: 4,
  },
  hrMenuCard: {
    marginBottom: spacing.md,
    padding: spacing.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  hrMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  hrMenuIcon: {
    width: 38,
    height: 38,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hrMenuTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  hrMenuSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
});
