import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, shadows } from '../../components/theme';
import StatusBadge from '../../components/StatusBadge';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Input from '../../components/Input';
import {
  getClaim,
  submitClaim,
  cancelClaim,
  managerReview,
  financeReview,
  processReimbursement,
} from '../../api/expenses';
import { useAuth } from '../../context/AuthContext';
import { unwrapError } from '../../api/unwrap';

export default function ExpenseDetailScreen({ route }) {
  const insets = useSafeAreaInsets();
  const { claimId } = route.params;
  const { user, can } = useAuth();

  const [claim, setClaim] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [reviewDecision, setReviewDecision] = useState('APPROVED');
  const [reviewComment, setReviewComment] = useState('');
  const [isFinanceStage, setIsFinanceStage] = useState(false);

  const fetchDetail = useCallback(async () => {
    try {
      const data = await getClaim(claimId);
      setClaim(data);
    } catch (err) {
      Alert.alert('Error', unwrapError(err, 'Failed to fetch expense details.'));
    } finally {
      setLoading(false);
    }
  }, [claimId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  async function handleSubmitDraft() {
    setActionLoading(true);
    try {
      await submitClaim(claimId);
      Alert.alert('Submitted', 'Expense claim has been submitted for approval.');
      fetchDetail();
    } catch (err) {
      Alert.alert('Error', unwrapError(err, 'Failed to submit claim.'));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancelClaim() {
    Alert.alert(
      'Cancel Claim',
      'Are you sure you want to cancel this expense claim?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            try {
              await cancelClaim(claimId, 'Cancelled by user from mobile');
              Alert.alert('Cancelled', 'Expense claim has been cancelled.');
              fetchDetail();
            } catch (err) {
              Alert.alert('Error', unwrapError(err, 'Failed to cancel claim.'));
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  }

  async function submitReview() {
    const isReject = reviewDecision === 'REJECT' || reviewDecision === 'REJECTED';
    if (isReject && !reviewComment.trim()) {
      Alert.alert('Required', 'Please provide a reason for rejecting this claim.');
      return;
    }

    const normalizedDecision = isReject ? 'REJECT' : (reviewDecision === 'RETURN' ? 'RETURN' : 'APPROVE');

    setActionLoading(true);
    try {
      if (isFinanceStage) {
        await financeReview(claimId, normalizedDecision, reviewComment.trim() || undefined);
      } else {
        await managerReview(claimId, normalizedDecision, reviewComment.trim() || undefined);
      }
      setReviewModalVisible(false);
      setReviewComment('');
      Alert.alert(
        'Success',
        `Expense has been marked as ${normalizedDecision === 'APPROVE' ? 'approved' : normalizedDecision.toLowerCase()}.`
      );
      fetchDetail();
    } catch (err) {
      Alert.alert('Error', unwrapError(err, 'Failed to review claim.'));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleProcessReimbursement() {
    Alert.alert(
      'Disburse Reimbursement',
      `Record payment of ₹${parseFloat(claim.amount).toLocaleString('en-IN')} to employee?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm Payout',
          onPress: async () => {
            setActionLoading(true);
            try {
              await processReimbursement(claimId, { method: 'BANK_TRANSFER' });
              Alert.alert('Success', 'Reimbursement has been recorded as paid.');
              fetchDetail();
            } catch (err) {
              Alert.alert('Error', unwrapError(err, 'Failed to process reimbursement.'));
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  }

  function openReviewModal(decision, finance = false) {
    setReviewDecision(decision);
    setIsFinanceStage(finance);
    setReviewComment('');
    setReviewModalVisible(true);
  }

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading expense claim...</Text>
      </View>
    );
  }

  if (!claim) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>Expense claim not found.</Text>
      </View>
    );
  }

  const isOwner = claim.employeeId === user?.employee?.id;
  const canManagerReview = can('APPROVE_EXPENSE') && claim.status === 'SUBMITTED';
  const canFinanceReview = can('VERIFY_EXPENSE') && claim.status === 'MANAGER_APPROVED';
  const canReimburse = can('PROCESS_REIMBURSEMENT') && claim.status === 'REIMBURSEMENT_PENDING';

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
          <Text style={styles.merchantTitle}>
            {claim.purpose || claim.merchantName || claim.description || 'Expense Claim'}
          </Text>
          <StatusBadge status={claim.status} />
        </View>

        <Text style={styles.amountDisplay}>
          ₹{Number(claim.amount || claim.totalAmount || 0).toLocaleString('en-IN')}
        </Text>

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Category</Text>
            <Text style={styles.metaValue}>{claim.category?.name || 'General'}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Date</Text>
            <Text style={styles.metaValue}>
              {claim.expenseDate
                ? new Date(claim.expenseDate).toLocaleDateString('en-IN', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })
                : 'N/A'}
            </Text>
          </View>
          {claim.project && (
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Project</Text>
              <Text style={styles.metaValue}>{claim.project.name}</Text>
            </View>
          )}
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionHeader}>Business Justification</Text>
        <Text style={styles.descText}>
          {claim.purpose || claim.description || 'No description provided for this claim.'}
        </Text>
      </Card>

      <Card>
        <Text style={styles.sectionHeader}>Attached Receipts</Text>
        {claim.receipts && claim.receipts.length > 0 ? (
          claim.receipts.map((rcpt, idx) => (
            <View key={rcpt.id || idx} style={styles.receiptItem}>
              <Ionicons name="document-attach-outline" size={24} color={colors.primary} style={{ marginRight: spacing.sm }} />
              <View style={styles.receiptInfo}>
                <Text style={styles.receiptName}>
                  {rcpt.originalName || `Receipt #${idx + 1}`}
                </Text>
                <Text style={styles.receiptMeta}>
                  Uploaded {new Date(rcpt.createdAt || Date.now()).toLocaleDateString()}
                </Text>
              </View>
            </View>
          ))
        ) : (
          <Text style={styles.noReceiptsText}>No receipts uploaded for this claim.</Text>
        )}
      </Card>

      <Card>
        <Text style={styles.sectionHeader}>Approval & Lifecycle Progress</Text>
        <View style={styles.timeline}>
          {/* Step 1: Submission */}
          <View style={styles.timelineStep}>
            <View style={[styles.timelineDot, styles.dotSuccess]} />
            <View style={styles.timelineContent}>
              <Text style={styles.timelineTitle}>1. Claim Submitted</Text>
              <Text style={styles.timelineSub}>
                {new Date(claim.createdAt).toLocaleString()}
              </Text>
            </View>
          </View>

          {/* Step 2: Manager Review */}
          {(() => {
            const isDone = ['MANAGER_APPROVED', 'REIMBURSEMENT_PENDING', 'REIMBURSED'].includes(claim.status);
            const isRejected = claim.status === 'MANAGER_REJECTED';
            const isReturned = claim.status === 'RETURNED';
            const dotStyle = isDone ? styles.dotSuccess : isRejected ? styles.dotDanger : isReturned ? styles.dotWarning : styles.dotPending;
            const label = isDone
              ? 'Approved by Manager'
              : isRejected
              ? 'Rejected by Manager'
              : isReturned
              ? 'Returned for Correction'
              : 'Awaiting Manager Review';
            return (
              <View style={styles.timelineStep}>
                <View style={[styles.timelineDot, dotStyle]} />
                <View style={styles.timelineContent}>
                  <Text style={styles.timelineTitle}>2. Manager Review</Text>
                  <Text style={styles.timelineSub}>{label}</Text>
                </View>
              </View>
            );
          })()}

          {/* Step 3: Finance Clearance */}
          {(() => {
            const isDone = ['REIMBURSEMENT_PENDING', 'REIMBURSED'].includes(claim.status);
            const isRejected = claim.status === 'FINANCE_REJECTED';
            const dotStyle = isDone ? styles.dotSuccess : isRejected ? styles.dotDanger : (claim.status === 'MANAGER_APPROVED' ? styles.dotPending : styles.dotPending);
            const label = isDone
              ? 'Verified & Approved by Finance'
              : isRejected
              ? 'Rejected by Finance'
              : claim.status === 'MANAGER_APPROVED'
              ? 'Awaiting Finance Verification'
              : 'Pending manager approval';
            return (
              <View style={styles.timelineStep}>
                <View style={[styles.timelineDot, dotStyle]} />
                <View style={styles.timelineContent}>
                  <Text style={styles.timelineTitle}>3. Finance Clearance</Text>
                  <Text style={styles.timelineSub}>{label}</Text>
                </View>
              </View>
            );
          })()}

          {/* Step 4: Reimbursement Payout */}
          {(() => {
            const isPaid = claim.status === 'REIMBURSED';
            const isPendingPayout = claim.status === 'REIMBURSEMENT_PENDING';
            const dotStyle = isPaid ? styles.dotSuccess : isPendingPayout ? styles.dotWarning : styles.dotPending;
            const label = isPaid
              ? 'Funds Disbursed to Employee'
              : isPendingPayout
              ? 'Queued for Reimbursement Payout'
              : 'Awaiting clearance';
            return (
              <View style={styles.timelineStep}>
                <View style={[styles.timelineDot, dotStyle]} />
                <View style={styles.timelineContent}>
                  <Text style={styles.timelineTitle}>4. Reimbursement Payout</Text>
                  <Text style={styles.timelineSub}>{label}</Text>
                </View>
              </View>
            );
          })()}
        </View>

        {claim.approvalHistory && claim.approvalHistory.length > 0 && (
          <View style={styles.historySection}>
            <Text style={styles.historyHeader}>Activity Trail</Text>
            {claim.approvalHistory.map((step) => {
              const actorName = step.actor?.employee
                ? `${step.actor.employee.firstName} ${step.actor.employee.lastName}`
                : step.actor?.email || 'Approver';
              return (
                <View key={step.id} style={styles.historyItem}>
                  <Text style={styles.historyActor}>
                    {actorName}
                    <Text style={styles.historyDate}> • {new Date(step.createdAt).toLocaleDateString()}</Text>
                  </Text>
                  <Text style={styles.historyStatus}>
                    {step.fromStatus} → {step.toStatus}
                  </Text>
                  {!!step.comment && (
                    <Text style={styles.historyComment}>"{step.comment}"</Text>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </Card>

      <View style={styles.actionsContainer}>
        {isOwner && claim.status === 'DRAFT' && (
          <View style={styles.btnRow}>
            <Button
              title="Cancel Claim"
              variant="outline"
              loading={actionLoading}
              onPress={handleCancelClaim}
              style={styles.halfBtn}
            />
            <Button
              title="Submit for Approval"
              variant="primary"
              loading={actionLoading}
              onPress={handleSubmitDraft}
              style={styles.halfBtn}
            />
          </View>
        )}

        {canManagerReview && (
          <View style={styles.btnRow}>
            <Button
              title="Reject"
              variant="danger"
              loading={actionLoading}
              onPress={() => openReviewModal('REJECT', false)}
              style={styles.halfBtn}
            />
            <Button
              title="Approve"
              variant="primary"
              loading={actionLoading}
              onPress={() => openReviewModal('APPROVE', false)}
              style={styles.halfBtn}
            />
          </View>
        )}

        {canFinanceReview && (
          <View style={styles.btnRow}>
            <Button
              title="Reject"
              variant="danger"
              loading={actionLoading}
              onPress={() => openReviewModal('REJECT', true)}
              style={styles.halfBtn}
            />
            <Button
              title="Finance Verify"
              variant="primary"
              loading={actionLoading}
              onPress={() => openReviewModal('APPROVE', true)}
              style={styles.halfBtn}
            />
          </View>
        )}

        {canReimburse && (
          <View style={styles.btnRow}>
            <Button
              title="Record Reimbursement Payout"
              variant="primary"
              loading={actionLoading}
              onPress={handleProcessReimbursement}
              style={{ flex: 1 }}
            />
          </View>
        )}

        {!canManagerReview && !canFinanceReview && claim.status === 'SUBMITTED' && (
          <View style={styles.infoBanner}>
            <Ionicons name="information-circle-outline" size={20} color={colors.primary} style={{ marginRight: 8, marginTop: 1 }} />
            <Text style={styles.infoBannerText}>
              {isOwner
                ? 'Your claim is submitted and awaiting approval from your manager. Employees cannot approve their own claims.'
                : 'Awaiting manager approval. You must be signed in with a Manager or CEO account to approve this claim.'}
            </Text>
          </View>
        )}

        {!canFinanceReview && claim.status === 'MANAGER_APPROVED' && (
          <View style={styles.infoBanner}>
            <Ionicons name="checkmark-circle-outline" size={20} color={colors.success} style={{ marginRight: 8, marginTop: 1 }} />
            <Text style={styles.infoBannerText}>
              Claim has been approved by the manager. Awaiting Finance Admin verification for payout.
            </Text>
          </View>
        )}

        {claim.status === 'REIMBURSEMENT_PENDING' && !canReimburse && (
          <View style={[styles.infoBanner, { borderColor: colors.primary }]}>
            <Ionicons name="checkmark-done-circle-outline" size={20} color={colors.primary} style={{ marginRight: 8, marginTop: 1 }} />
            <Text style={styles.infoBannerText}>
              Claim has been fully approved by Manager & Finance. It is now queued for payout disbursement.
            </Text>
          </View>
        )}

        {claim.status === 'REIMBURSED' && (
          <View style={[styles.infoBanner, { borderColor: colors.success }]}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} style={{ marginRight: 8, marginTop: 1 }} />
            <Text style={styles.infoBannerText}>
              Reimbursement complete. Payment has been disbursed to the employee.
            </Text>
          </View>
        )}
      </View>

      <Modal
        visible={reviewModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setReviewModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          {(() => {
            const isReviewApprove = reviewDecision === 'APPROVE' || reviewDecision === 'APPROVED';
            return (
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>
                  {isReviewApprove
                    ? (isFinanceStage ? 'Finance Clearance' : 'Approve Expense')
                    : 'Reject Expense'}
                </Text>
                <Text style={styles.modalDesc}>
                  {isReviewApprove
                    ? `Confirm your approval for ₹${parseFloat(claim.amount).toLocaleString('en-IN')} (${claim.category?.name || 'Expense'}).`
                    : 'Please specify the reason for rejecting this claim (required for audit).'}
                </Text>

                <Input
                  label={isReviewApprove ? 'Review Note (Optional)' : 'Rejection Reason (Required)'}
                  placeholder={
                    isReviewApprove
                      ? 'Optional approval notes...'
                      : 'e.g. Missing valid GST receipt / non-compliant expense'
                  }
                  value={reviewComment}
                  onChangeText={setReviewComment}
                  multiline
                  numberOfLines={3}
                />

                <View style={styles.modalActions}>
                  <Button
                    title="Cancel"
                    variant="secondary"
                    onPress={() => setReviewModalVisible(false)}
                    style={styles.halfBtn}
                  />
                  <Button
                    title={isReviewApprove ? (isFinanceStage ? 'Confirm Clearance' : 'Confirm Approval') : 'Confirm Reject'}
                    variant={isReviewApprove ? 'primary' : 'danger'}
                    loading={actionLoading}
                    onPress={submitReview}
                    style={styles.halfBtn}
                  />
                </View>
              </View>
            );
          })()}
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
    borderLeftColor: colors.primary,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.xs,
  },
  merchantTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
    flex: 1,
    paddingRight: spacing.sm,
  },
  amountDisplay: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
    marginVertical: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceSubtle,
  },
  metaItem: {
    marginRight: spacing.sm,
  },
  metaLabel: {
    fontSize: 11,
    color: colors.textLight,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  metaValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginTop: 2,
  },
  sectionHeader: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  descText: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
  },
  receiptItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSubtle,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xs,
  },
  receiptIcon: {
    fontSize: 24,
    marginRight: spacing.sm,
  },
  receiptInfo: {
    flex: 1,
  },
  receiptName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  receiptMeta: {
    fontSize: 11,
    color: colors.textLight,
    marginTop: 2,
  },
  noReceiptsText: {
    fontSize: 13,
    color: colors.textLight,
    fontStyle: 'italic',
  },
  timeline: {
    paddingLeft: spacing.sm,
  },
  timelineStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  timelineDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginTop: 3,
    marginRight: spacing.md,
  },
  dotSuccess: {
    backgroundColor: colors.success,
  },
  dotDanger: {
    backgroundColor: colors.danger,
  },
  dotPending: {
    backgroundColor: colors.borderDark,
  },
  dotWarning: {
    backgroundColor: colors.warning,
  },
  historySection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceSubtle,
  },
  historyHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  historyItem: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  historyActor: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  historyDate: {
    fontSize: 11,
    fontWeight: '400',
    color: colors.textLight,
  },
  historyStatus: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '600',
    marginTop: 2,
  },
  historyComment: {
    fontSize: 11,
    fontStyle: 'italic',
    color: colors.textMuted,
    marginTop: 2,
  },
  timelineContent: {
    flex: 1,
  },
  timelineTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  timelineSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  actionsContainer: {
    marginTop: spacing.sm,
  },
  btnRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  halfBtn: {
    flex: 1,
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
  modalDesc: {
    fontSize: 13,
    color: colors.textMuted,
    marginVertical: spacing.sm,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceSubtle,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoBannerText: {
    flex: 1,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
});
