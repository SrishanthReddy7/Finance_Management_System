import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Modal,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { colors, spacing, borderRadius, shadows } from '../../components/theme';
import Input from '../../components/Input';
import Button from '../../components/Button';
import { testConnection } from '../../api/client';
import { Ionicons } from '@expo/vector-icons';

export default function LoginScreen() {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const isSmallDevice = width < 360;

  const {
    login,
    forgotPassword,
    resetPassword,
    serverUrl,
    changeServerUrl,
  } = useAuth();

  // Credentials State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Forgot Password Modal State: 'REQUEST_CODE' | 'ENTER_NEW_PASSWORD'
  const [forgotModalVisible, setForgotModalVisible] = useState(false);
  const [forgotStep, setForgotStep] = useState('REQUEST_CODE');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotOtp, setForgotOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState('');
  const [resetCodePreview, setResetCodePreview] = useState('');

  // Server Settings Modal State
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [customUrl, setCustomUrl] = useState(serverUrl);
  const [testingUrl, setTestingUrl] = useState(false);
  const [pingResult, setPingResult] = useState(null);

  // Direct Password Login (No sequential OTP prompt)
  async function handleLogin() {
    if (!email.trim()) {
      setError('Please enter your work email.');
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      return;
    }

    setError('');
    setLoading(true);

    const res = await login(email.trim(), password);
    setLoading(false);

    if (!res.success) {
      setError(res.message);
    }
  }

  // Forgot Password: Step 1 - Send Code
  async function handleForgotRequest() {
    if (!forgotEmail.trim()) {
      setForgotError('Please enter your registered work email.');
      return;
    }

    setForgotError('');
    setForgotLoading(true);

    const res = await forgotPassword(forgotEmail.trim());
    setForgotLoading(false);

    if (res.success) {
      setResetCodePreview(res.data?.resetCodePreview || res.resetCodePreview || '');
      setForgotStep('ENTER_NEW_PASSWORD');
    } else {
      setForgotError(res.message || 'Could not send reset code.');
    }
  }

  // Forgot Password: Step 2 - Verify Code & Set New Password
  async function handleResetSubmit() {
    if (!forgotOtp.trim()) {
      setForgotError('Please enter the 6-digit reset code.');
      return;
    }
    if (newPassword.length < 8) {
      setForgotError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setForgotError('Passwords do not match.');
      return;
    }

    setForgotError('');
    setForgotLoading(true);

    const res = await resetPassword(forgotEmail.trim(), forgotOtp.trim(), newPassword);
    setForgotLoading(false);

    if (res.success) {
      Alert.alert(
        'Password Reset Successful',
        'Your password has been reset. You can now log in with your new password.',
        [
          {
            text: 'Sign In Now',
            onPress: () => {
              setForgotModalVisible(false);
              setEmail(forgotEmail.trim());
              setPassword('');
            },
          },
        ]
      );
    } else {
      setForgotError(res.message || 'Failed to reset password.');
    }
  }

  async function handleTestConnection(urlToTest) {
    const target = urlToTest || customUrl;
    setTestingUrl(true);
    setPingResult(null);
    const res = await testConnection(target);
    setTestingUrl(false);
    setPingResult(res);
  }

  async function handleSaveServerUrl() {
    if (!customUrl.trim()) {
      Alert.alert('Error', 'Server URL cannot be empty.');
      return;
    }
    await changeServerUrl(customUrl.trim());
    setSettingsVisible(false);
    setPingResult(null);
    Alert.alert('Saved', `API URL updated to:\n${customUrl.trim()}`);
  }

  function setPreset(url) {
    setCustomUrl(url);
    handleTestConnection(url);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          isTablet && styles.tabletScrollContent,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.logoBadge}>
            <Ionicons name="wallet" size={32} color={colors.textInverse} />
          </View>
          <Text style={styles.title}>Finance Hub</Text>
          <Text style={styles.subtitle}>
            Enterprise Finance & Expense Management
          </Text>
        </View>

        <View style={[styles.card, isTablet && styles.tabletCard]}>
          <Text style={styles.formTitle}>Sign in to your account</Text>

          {!!error && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={16} color={colors.danger} style={{ marginRight: 6 }} />
              <Text style={styles.errorBannerText}>{error}</Text>
            </View>
          )}

          <Input
            label="Work Email"
            placeholder="e.g. employee@company.com"
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              if (error) setError('');
            }}
            keyboardType="email-address"
            autoCapitalize="none"
            leadingIcon={
              <Ionicons name="mail-outline" size={18} color={colors.textMuted} />
            }
          />

          <Input
            label="Password"
            placeholder="••••••••"
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              if (error) setError('');
            }}
            secureTextEntry
            leadingIcon={
              <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
            }
          />

          {/* Forgot password link */}
          <View style={styles.forgotPasswordRow}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => {
                setForgotEmail(email.trim());
                setForgotStep('REQUEST_CODE');
                setForgotError('');
                setForgotOtp('');
                setNewPassword('');
                setConfirmPassword('');
                setForgotModalVisible(true);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.forgotPasswordText}>Forgot password?</Text>
            </TouchableOpacity>
          </View>

          <Button
            title="Sign In"
            onPress={handleLogin}
            loading={loading}
            fullWidth
            style={styles.submitBtn}
          />

          {/* Quick Demo Credentials Autofill */}
          <View style={styles.demoSection}>
            <Text style={styles.demoTitle}>Quick Fill Demo Credentials:</Text>
            <View style={styles.demoRow}>
              {[
                { label: 'HR Admin', email: 'hr@company.test', icon: 'people-outline' },
                { label: 'CEO', email: 'ceo@company.test', icon: 'ribbon-outline' },
                { label: 'Finance', email: 'finance@company.test', icon: 'briefcase-outline' },
                { label: 'Manager', email: 'manager@company.test', icon: 'shield-checkmark-outline' },
                { label: 'Employee A', email: 'employee.a@company.test', icon: 'person-outline' },
              ].map((chip) => {
                const isActive = email === chip.email;
                return (
                  <TouchableOpacity
                    key={chip.label}
                    style={[styles.demoChip, isActive && styles.demoChipActive]}
                    activeOpacity={0.7}
                    onPress={() => {
                      setEmail(chip.email);
                      setPassword('Passw0rd!123');
                      if (error) setError('');
                    }}
                  >
                    <View style={styles.chipContent}>
                      <Ionicons
                        name={chip.icon}
                        size={13}
                        color={isActive ? colors.primaryDark : colors.textMuted}
                        style={{ marginRight: 4 }}
                      />
                      <Text style={[styles.demoChipText, isActive && styles.demoChipTextActive]}>
                        {chip.label}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Server Config Button */}
          <TouchableOpacity
            style={styles.serverButton}
            onPress={() => {
              setCustomUrl(serverUrl);
              setSettingsVisible(true);
            }}
          >
            <View style={styles.serverButtonRow}>
              <Ionicons name="settings-outline" size={13} color={colors.textMuted} style={{ marginRight: 5 }} />
              <Text style={styles.serverButtonText}>
                Server: <Text style={styles.serverUrlValue} numberOfLines={1}>{serverUrl}</Text>
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.footerNote}>
          <Text style={styles.footerNoteText}>
            Protected by Enterprise Multi-Role Access Control
          </Text>
        </View>
      </ScrollView>

      {/* ==================== FORGOT PASSWORD MODAL ==================== */}
      <Modal
        visible={forgotModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setForgotModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.modalTitleIconRow}>
                <Ionicons name="key-outline" size={22} color={colors.primary} style={{ marginRight: 8 }} />
                <Text style={styles.modalTitle}>
                  {forgotStep === 'REQUEST_CODE' ? 'Forgot Password' : 'Reset Password'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setForgotModalVisible(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {!!forgotError && (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle" size={16} color={colors.danger} style={{ marginRight: 6 }} />
                <Text style={styles.errorBannerText}>{forgotError}</Text>
              </View>
            )}

            {forgotStep === 'REQUEST_CODE' ? (
              <View>
                <Text style={styles.modalSubtitle}>
                  Enter your registered work email to receive a password reset code.
                </Text>

                <Input
                  label="Work Email"
                  placeholder="e.g. employee@company.com"
                  value={forgotEmail}
                  onChangeText={(text) => {
                    setForgotEmail(text);
                    if (forgotError) setForgotError('');
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />

                <Button
                  title="Send Reset Code"
                  onPress={handleForgotRequest}
                  loading={forgotLoading}
                  style={styles.modalSubmitBtn}
                />
              </View>
            ) : (
              <ScrollView>
                <Text style={styles.modalSubtitle}>
                  Enter the 6-digit reset code sent to {forgotEmail} and choose a new password.
                </Text>

                {resetCodePreview ? (
                  <TouchableOpacity
                    style={styles.quickOtpChip}
                    onPress={() => {
                      setForgotOtp(resetCodePreview);
                      setForgotError('');
                    }}
                  >
                    <Ionicons name="flash-outline" size={13} color={colors.warningText} style={{ marginRight: 4 }} />
                    <Text style={styles.quickOtpText}>
                      Reset Code: <Text style={{ fontWeight: '800' }}>{resetCodePreview}</Text> (Tap to fill)
                    </Text>
                  </TouchableOpacity>
                ) : null}

                <Input
                  label="6-Digit Reset Code"
                  placeholder="••••••"
                  value={forgotOtp}
                  onChangeText={(text) => {
                    setForgotOtp(text.replace(/[^0-9]/g, ''));
                    if (forgotError) setForgotError('');
                  }}
                  keyboardType="number-pad"
                  maxLength={6}
                />

                <Input
                  label="New Password"
                  placeholder="At least 8 characters"
                  value={newPassword}
                  onChangeText={(text) => {
                    setNewPassword(text);
                    if (forgotError) setForgotError('');
                  }}
                  secureTextEntry
                />

                <Input
                  label="Confirm New Password"
                  placeholder="Repeat new password"
                  value={confirmPassword}
                  onChangeText={(text) => {
                    setConfirmPassword(text);
                    if (forgotError) setForgotError('');
                  }}
                  secureTextEntry
                />

                <View style={styles.modalBtnRow}>
                  <TouchableOpacity
                    style={styles.modalBackBtn}
                    onPress={() => setForgotStep('REQUEST_CODE')}
                  >
                    <Text style={styles.modalBackBtnText}>Back</Text>
                  </TouchableOpacity>

                  <Button
                    title="Set New Password"
                    onPress={handleResetSubmit}
                    loading={forgotLoading}
                    style={{ flex: 2 }}
                  />
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ==================== SERVER SETTINGS MODAL ==================== */}
      <Modal
        visible={settingsVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSettingsVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.modalTitleIconRow}>
                <Ionicons name="server-outline" size={20} color={colors.primary} style={{ marginRight: 8 }} />
                <Text style={styles.modalTitle}>Backend Server API</Text>
              </View>
              <TouchableOpacity onPress={() => setSettingsVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              Configure which backend endpoint this mobile app connects to.
            </Text>

            <Input
              label="API Base URL"
              placeholder="http://10.0.2.2:5000/api/v1"
              value={customUrl}
              onChangeText={setCustomUrl}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.presetLabel}>Quick Presets:</Text>
            <View style={styles.presetRow}>
              <TouchableOpacity
                style={styles.presetChip}
                onPress={() => setPreset('http://192.168.1.34:5000/api/v1')}
              >
                <View style={styles.presetChipContent}>
                  <Ionicons name="wifi-outline" size={13} color={colors.primary} style={{ marginRight: 4 }} />
                  <Text style={styles.presetChipText}>Wi-Fi Phone (192.168.1.34)</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.presetChip}
                onPress={() => setPreset('http://localhost:5000/api/v1')}
              >
                <View style={styles.presetChipContent}>
                  <Ionicons name="laptop-outline" size={13} color={colors.primary} style={{ marginRight: 4 }} />
                  <Text style={styles.presetChipText}>Localhost / Web</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.presetChip}
                onPress={() => setPreset('http://10.0.2.2:5000/api/v1')}
              >
                <View style={styles.presetChipContent}>
                  <Ionicons name="phone-portrait-outline" size={13} color={colors.primary} style={{ marginRight: 4 }} />
                  <Text style={styles.presetChipText}>Android Emulator</Text>
                </View>
              </TouchableOpacity>
            </View>

            {pingResult && (
              <View
                style={[
                  styles.pingBadge,
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
                      ? 'Server is online & reachable!'
                      : `Connection failed: ${pingResult.error}`}
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.modalActions}>
              <Button
                title="Test Ping"
                variant="outline"
                loading={testingUrl}
                onPress={() => handleTestConnection()}
                style={styles.modalBtn}
              />
              <Button
                title="Save & Connect"
                variant="primary"
                onPress={handleSaveServerUrl}
                style={styles.modalBtn}
              />
            </View>

            <Button
              title="Close"
              variant="secondary"
              onPress={() => setSettingsVisible(false)}
              style={styles.closeBtn}
            />
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  tabletScrollContent: {
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
  },
  tabletCard: {
    padding: spacing.xl,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  logoBadge: {
    width: 64,
    height: 64,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    ...shadows.md,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 4,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.md,
  },
  formTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  errorBanner: {
    backgroundColor: colors.dangerLight,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  errorBannerText: {
    color: colors.dangerText,
    fontSize: 13,
    fontWeight: '500',
  },
  forgotPasswordRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: spacing.md,
    marginTop: -spacing.xs,
  },
  forgotPasswordText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '700',
  },
  submitBtn: {
    marginTop: spacing.xs,
  },
  demoSection: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceSubtle,
  },
  demoTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  demoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  demoChip: {
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  demoChipActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  chipContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  demoChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text,
  },
  demoChipTextActive: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
  serverButton: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  serverButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  serverButtonText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  serverUrlValue: {
    color: colors.primary,
    fontWeight: '600',
  },
  footerNote: {
    marginTop: spacing.lg,
    alignItems: 'center',
  },
  footerNoteText: {
    fontSize: 12,
    color: colors.textLight,
  },
  // Modal Styles
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
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  modalTitleIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  quickOtpChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.warningLight,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: '#fde68a',
    marginBottom: spacing.sm,
  },
  quickOtpText: {
    fontSize: 12,
    color: colors.warningText,
  },
  modalSubmitBtn: {
    marginTop: spacing.xs,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: spacing.md,
    alignItems: 'center',
  },
  modalBackBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  modalBackBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  presetLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: spacing.xs,
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
  presetChipText: {
    fontSize: 12,
    color: colors.text,
    fontWeight: '500',
  },
  pingBadge: {
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
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  modalBtn: {
    flex: 1,
  },
  closeBtn: {
    marginTop: 4,
  },
});
