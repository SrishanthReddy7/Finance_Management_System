import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '../../components/theme';
import Input from '../../components/Input';
import Button from '../../components/Button';
import {
  listCategories,
  createClaim,
  submitClaim,
  uploadReceipt,
} from '../../api/expenses';
import { listProjects } from '../../api/projects';
import { unwrapError } from '../../api/unwrap';

const PAYMENT_METHODS = ['UPI', 'Card', 'Cash', 'Bank Transfer'];

export default function SubmitExpenseScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [merchantName, setMerchantName] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [paymentMethod, setPaymentMethod] = useState('UPI');
  const [description, setDescription] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [receiptImage, setReceiptImage] = useState(null);

  const [categories, setCategories] = useState([]);
  const [projects, setProjects] = useState([]);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    async function loadMetadata() {
      try {
        const [catsRes, projsRes] = await Promise.allSettled([
          listCategories(),
          listProjects(),
        ]);

        if (catsRes.status === 'fulfilled') {
          const catList = catsRes.value || [];
          setCategories(catList);
          if (catList.length > 0) {
            setSelectedCategoryId(catList[0].id);
          }
        }

        if (projsRes.status === 'fulfilled') {
          const projList = projsRes.value?.rows || projsRes.value || [];
          setProjects(projList);
        }
      } catch (err) {
        console.warn('Failed to load categories/projects:', err);
      } finally {
        setLoadingInitial(false);
      }
    }

    loadMetadata();
  }, []);

  async function pickImage() {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Needed',
          'Camera roll permissions are required to attach receipts.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.7,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setReceiptImage(result.assets[0]);
      }
    } catch (err) {
      console.warn('Image picker error:', err);
    }
  }

  async function takePhoto() {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Needed',
          'Camera permission is required to capture receipts.'
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.7,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setReceiptImage(result.assets[0]);
      }
    } catch (err) {
      console.warn('Camera error:', err);
    }
  }

  function validate() {
    const errs = {};
    if (!merchantName.trim()) {
      errs.merchantName = 'Merchant or title is required.';
    }
    const numAmt = parseFloat(amount);
    if (!amount || isNaN(numAmt) || numAmt <= 0) {
      errs.amount = 'Please enter a valid amount.';
    }
    if (!selectedCategoryId) {
      errs.category = 'Please select an expense category.';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function toIsoDateTime(dateStr) {
    const clean = (dateStr || '').trim() || new Date().toISOString().split('T')[0];
    if (clean.includes('T') && clean.endsWith('Z')) return clean;
    return new Date(`${clean}T00:00:00.000Z`).toISOString();
  }

  async function handleSave(submitImmediately = false) {
    if (!validate()) return;

    setSubmitting(true);
    try {
      const purposeText = (description.trim() || merchantName.trim() || 'Business expense');
      const purpose = purposeText.length >= 3 ? purposeText : `${purposeText} expense`;

      const receiptMissing = !receiptImage;
      const receiptMissingReason = receiptMissing
        ? (description.trim() || merchantName.trim() || 'Original receipt not available')
        : undefined;

      const payload = {
        categoryId: selectedCategoryId,
        projectId: selectedProjectId || undefined,
        amount: parseFloat(amount),
        expenseDate: toIsoDateTime(expenseDate),
        purpose: purpose,
        paymentMethod: paymentMethod || 'UPI',
        receiptMissing: receiptMissing,
        receiptMissingReason: receiptMissingReason,
      };

      const claim = await createClaim(payload);
      const claimId = claim.id;

      if (receiptImage && claimId) {
        try {
          await uploadReceipt(
            claimId,
            receiptImage.uri,
            receiptImage.fileName || 'receipt.jpg',
            receiptImage.mimeType || 'image/jpeg'
          );
        } catch (uploadErr) {
          console.warn('Receipt upload error:', uploadErr);
          throw new Error(`Receipt upload failed: ${uploadErr.message || 'Please check file format'}`);
        }
      }

      if (submitImmediately && claimId) {
        await submitClaim(claimId);
      }

      Alert.alert(
        'Success',
        submitImmediately
          ? 'Expense claim submitted for approval!'
          : 'Expense claim saved as draft.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (err) {
      Alert.alert('Error', unwrapError(err, 'Failed to save expense claim.'));
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingInitial) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading form data...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom, 20) + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.screenTitle}>Submit Expense Claim</Text>
        <Text style={styles.screenSubtitle}>
          Enter details and attach your bill or receipt for reimbursement.
        </Text>

        <Input
          label="Merchant / Payee Name *"
          placeholder="e.g. Uber, Amazon Web Services, Cafe"
          value={merchantName}
          onChangeText={(val) => {
            setMerchantName(val);
            if (errors.merchantName) setErrors({ ...errors, merchantName: null });
          }}
          error={errors.merchantName}
        />

        <Input
          label="Amount (₹) *"
          placeholder="0.00"
          value={amount}
          onChangeText={(val) => {
            setAmount(val);
            if (errors.amount) setErrors({ ...errors, amount: null });
          }}
          keyboardType="numeric"
          error={errors.amount}
        />

        <Input
          label="Expense Date (YYYY-MM-DD) *"
          placeholder="2026-10-04"
          value={expenseDate}
          onChangeText={setExpenseDate}
        />

        <Text style={styles.fieldLabel}>Category *</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsScroll}
          contentContainerStyle={styles.chipsContainer}
        >
          {categories.map((cat) => {
            const isSelected = selectedCategoryId === cat.id;
            return (
              <TouchableOpacity
                key={cat.id}
                style={[styles.chip, isSelected && styles.chipSelected]}
                onPress={() => setSelectedCategoryId(cat.id)}
              >
                <Text
                  style={[styles.chipText, isSelected && styles.chipTextSelected]}
                >
                  {cat.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {!!errors.category && (
          <Text style={styles.errorText}>{errors.category}</Text>
        )}

        {projects.length > 0 && (
          <>
            <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>
              Linked Project (Optional)
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipsScroll}
              contentContainerStyle={styles.chipsContainer}
            >
              <TouchableOpacity
                style={[
                  styles.chip,
                  selectedProjectId === null && styles.chipSelected,
                ]}
                onPress={() => setSelectedProjectId(null)}
              >
                <Text
                  style={[
                    styles.chipText,
                    selectedProjectId === null && styles.chipTextSelected,
                  ]}
                >
                  None
                </Text>
              </TouchableOpacity>
              {projects.map((proj) => {
                const isSelected = selectedProjectId === proj.id;
                return (
                  <TouchableOpacity
                    key={proj.id}
                    style={[styles.chip, isSelected && styles.chipSelected]}
                    onPress={() => setSelectedProjectId(proj.id)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        isSelected && styles.chipTextSelected,
                      ]}
                    >
                      {proj.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </>
        )}

        <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Payment Method *</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsScroll}
          contentContainerStyle={styles.chipsContainer}
        >
          {PAYMENT_METHODS.map((method) => {
            const isSelected = paymentMethod === method;
            return (
              <TouchableOpacity
                key={method}
                style={[styles.chip, isSelected && styles.chipSelected]}
                onPress={() => setPaymentMethod(method)}
              >
                <Text
                  style={[styles.chipText, isSelected && styles.chipTextSelected]}
                >
                  {method}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <Input
          label="Purpose / Business Justification"
          placeholder="Add any context for the approving manager..."
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
          style={{ marginTop: spacing.md }}
        />

        <Text style={styles.fieldLabel}>Receipt / Bill Proof</Text>
        {receiptImage ? (
          <View style={styles.receiptPreviewBox}>
            <Image
              source={{ uri: receiptImage.uri }}
              style={styles.receiptThumbnail}
            />
            <View style={styles.receiptDetails}>
              <Text style={styles.receiptFileName} numberOfLines={1}>
                {receiptImage.fileName || 'Attached Receipt'}
              </Text>
              <TouchableOpacity
                onPress={() => setReceiptImage(null)}
                style={styles.removeReceiptBtn}
              >
                <View style={styles.removeReceiptRow}>
                  <Ionicons name="trash-outline" size={13} color={colors.danger} style={{ marginRight: 4 }} />
                  <Text style={styles.removeReceiptText}>Remove photo</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.receiptButtonRow}>
            <TouchableOpacity
              style={styles.attachBtn}
              activeOpacity={0.7}
              onPress={takePhoto}
            >
              <Ionicons name="camera-outline" size={24} color={colors.primary} style={{ marginBottom: 4 }} />
              <Text style={styles.attachBtnText}>Camera</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.attachBtn}
              activeOpacity={0.7}
              onPress={pickImage}
            >
              <Ionicons name="images-outline" size={24} color={colors.primary} style={{ marginBottom: 4 }} />
              <Text style={styles.attachBtnText}>Gallery</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.actionsRow}>
          <Button
            title="Save Draft"
            variant="outline"
            loading={submitting}
            onPress={() => handleSave(false)}
            style={styles.actionBtn}
          />
          <Button
            title="Submit Claim"
            variant="primary"
            loading={submitting}
            onPress={() => handleSave(true)}
            style={styles.actionBtn}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
  screenTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  screenSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  chipsScroll: {
    marginBottom: spacing.xs,
  },
  chipsContainer: {
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  chipTextSelected: {
    color: colors.textInverse,
  },
  errorText: {
    fontSize: 12,
    color: colors.danger,
    marginTop: 4,
    marginBottom: spacing.sm,
  },
  receiptButtonRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  attachBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.borderDark,
    borderRadius: borderRadius.md,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachBtnIcon: {
    fontSize: 22,
    marginBottom: 2,
  },
  attachBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  receiptPreviewBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  receiptThumbnail: {
    width: 60,
    height: 60,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  receiptDetails: {
    flex: 1,
    marginLeft: spacing.md,
  },
  receiptFileName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  removeReceiptBtn: {
    marginTop: 4,
  },
  removeReceiptRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  removeReceiptText: {
    fontSize: 12,
    color: colors.danger,
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  actionBtn: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontSize: 14,
  },
});
