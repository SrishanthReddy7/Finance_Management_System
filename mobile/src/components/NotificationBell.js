import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  ActivityIndicator,
  TouchableWithoutFeedback,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors, borderRadius, spacing } from './theme';
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '../api/notifications';

const { width } = Dimensions.get('window');

function timeAgo(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDays = Math.floor(diffHour / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}

function getNotificationVisuals(item) {
  switch (item.type) {
    case 'PENDING_APPROVAL':
    case 'FINANCE_PENDING':
      return {
        icon: 'shield-checkmark',
        iconColor: colors.warning,
        bg: colors.warningLight,
      };
    case 'APPROVED':
      return {
        icon: 'checkmark-circle',
        iconColor: colors.success,
        bg: colors.successLight,
      };
    case 'PAID':
      return {
        icon: 'cash-outline',
        iconColor: colors.success,
        bg: colors.successLight,
      };
    case 'RETURNED':
      return {
        icon: 'return-up-back-outline',
        iconColor: colors.warning,
        bg: colors.warningLight,
      };
    case 'REJECTED':
      return {
        icon: 'close-circle-outline',
        iconColor: colors.danger,
        bg: colors.dangerLight,
      };
    case 'SALARY_PAID':
    case 'SALARY_GENERATED':
      return {
        icon: 'wallet-outline',
        iconColor: colors.primary,
        bg: colors.primaryLight,
      };
    case 'SUBMITTED':
      return {
        icon: 'paper-plane-outline',
        iconColor: colors.info,
        bg: colors.infoLight,
      };
    default:
      return {
        icon: 'notifications-outline',
        iconColor: colors.primary,
        bg: colors.primaryLight,
      };
  }
}

export default function NotificationBell({ navigation: navProp, style }) {
  const defaultNavigation = useNavigation();
  const navigation = navProp || defaultNavigation;
  const insets = useSafeAreaInsets();

  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState('ALL');

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await listNotifications();
      if (data) {
        setNotifications(data.items || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch {
      // Fail silently to avoid interrupting the user flow
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000); // 30s polling
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const handleOpenDropdown = () => {
    setIsOpen(true);
    setLoading(true);
    fetchNotifications().finally(() => setLoading(false));
  };

  const handleCloseDropdown = () => {
    setIsOpen(false);
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (err) {
      console.warn('Failed to mark all as read:', err.message);
    }
  };

  const handleItemPress = async (item) => {
    if (!item.isRead) {
      try {
        await markNotificationRead(item.id);
        setNotifications((prev) =>
          prev.map((n) => (n.id === item.id ? { ...n, isRead: true } : n))
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } catch (err) {
        console.warn('Failed to mark notification read:', err.message);
      }
    }

    handleCloseDropdown();

    if (item.target) {
      if (typeof item.target === 'object' && item.target.screen) {
        navigation.navigate(item.target.screen, item.target.params || {});
      } else if (typeof item.target === 'string') {
        navigation.navigate(item.target);
      }
    }
  };

  const filteredNotifications = notifications.filter((item) => {
    if (selectedFilter === 'ALL') return true;
    if (selectedFilter === 'APPROVALS') return item.category === 'APPROVALS';
    if (selectedFilter === 'CLAIMS') return item.category === 'CLAIMS';
    if (selectedFilter === 'SALARY') return item.category === 'SALARY';
    return true;
  });

  return (
    <View style={[styles.container, style]}>
      {/* Bell Button */}
      <TouchableOpacity
        style={styles.bellButton}
        activeOpacity={0.7}
        onPress={handleOpenDropdown}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons
          name={unreadCount > 0 ? 'notifications' : 'notifications-outline'}
          size={23}
          color={unreadCount > 0 ? colors.primary : colors.text}
        />
        {unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Floating Dropdown Modal */}
      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={handleCloseDropdown}
      >
        <TouchableWithoutFeedback onPress={handleCloseDropdown}>
          <View style={styles.backdrop}>
            <TouchableWithoutFeedback>
              <View
                style={[
                  styles.dropdownBox,
                  { top: Math.max(insets.top + 50, 60) },
                ]}
              >
                {/* Header */}
                <View style={styles.dropdownHeader}>
                  <View style={styles.headerTitleRow}>
                    <Text style={styles.dropdownTitle}>Notifications</Text>
                    {unreadCount > 0 && (
                      <View style={styles.unreadPill}>
                        <Text style={styles.unreadPillText}>
                          {unreadCount} new
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.headerActions}>
                    {unreadCount > 0 && (
                      <TouchableOpacity
                        onPress={handleMarkAllRead}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        style={styles.markAllBtn}
                      >
                        <Text style={styles.markAllText}>Mark all read</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={handleCloseDropdown}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={styles.closeBtn}
                    >
                      <Ionicons name="close" size={20} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Filter Tabs */}
                <View style={styles.filterBar}>
                  {[
                    { key: 'ALL', label: 'All' },
                    { key: 'APPROVALS', label: 'Approvals' },
                    { key: 'CLAIMS', label: 'Claims' },
                    { key: 'SALARY', label: 'Salary' },
                  ].map((tab) => {
                    const isActive = selectedFilter === tab.key;
                    return (
                      <TouchableOpacity
                        key={tab.key}
                        style={[
                          styles.filterTab,
                          isActive && styles.filterTabActive,
                        ]}
                        onPress={() => setSelectedFilter(tab.key)}
                      >
                        <Text
                          style={[
                            styles.filterTabText,
                            isActive && styles.filterTabTextActive,
                          ]}
                        >
                          {tab.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Notification Items List */}
                {loading && notifications.length === 0 ? (
                  <View style={styles.centerContainer}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.loadingText}>Updating...</Text>
                  </View>
                ) : filteredNotifications.length === 0 ? (
                  <View style={styles.emptyContainer}>
                    <Ionicons
                      name="notifications-off-outline"
                      size={36}
                      color={colors.textLight}
                    />
                    <Text style={styles.emptyTitle}>All caught up!</Text>
                    <Text style={styles.emptySubtitle}>
                      No {selectedFilter !== 'ALL' ? selectedFilter.toLowerCase() : ''} notifications to display.
                    </Text>
                  </View>
                ) : (
                  <FlatList
                    data={filteredNotifications}
                    keyExtractor={(item, index) => (item?.id ? `notif-${item.id}-${index}` : `notif-${index}`)}
                    style={styles.list}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    renderItem={({ item }) => {
                      const visuals = getNotificationVisuals(item);
                      return (
                        <TouchableOpacity
                          style={[
                            styles.itemRow,
                            !item.isRead && styles.itemRowUnread,
                          ]}
                          activeOpacity={0.7}
                          onPress={() => handleItemPress(item)}
                        >
                          {/* Left Icon */}
                          <View
                            style={[
                              styles.itemIconCircle,
                              { backgroundColor: visuals.bg },
                            ]}
                          >
                            <Ionicons
                              name={visuals.icon}
                              size={18}
                              color={visuals.iconColor}
                            />
                          </View>

                          {/* Content */}
                          <View style={styles.itemContent}>
                            <View style={styles.itemTitleRow}>
                              <Text
                                style={[
                                  styles.itemTitle,
                                  !item.isRead && styles.itemTitleBold,
                                ]}
                                numberOfLines={1}
                              >
                                {item.title}
                              </Text>
                              <Text style={styles.itemTime}>
                                {timeAgo(item.createdAt)}
                              </Text>
                            </View>

                            <Text
                              style={styles.itemMessage}
                              numberOfLines={2}
                            >
                              {item.message}
                            </Text>
                          </View>

                          {/* Unread Dot */}
                          {!item.isRead && <View style={styles.unreadDot} />}
                        </TouchableOpacity>
                      );
                    }}
                  />
                )}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bellButton: {
    width: 38,
    height: 38,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSubtle,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: colors.danger,
    borderRadius: borderRadius.full,
    minWidth: 17,
    height: 17,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  badgeText: {
    color: colors.textInverse,
    fontSize: 9,
    fontWeight: '800',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
  },
  dropdownBox: {
    width: Math.min(width - 24, 380),
    maxHeight: 480,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
    overflow: 'hidden',
  },
  dropdownHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dropdownTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  unreadPill: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  unreadPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  markAllBtn: {
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  markAllText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  closeBtn: {
    padding: 2,
  },
  filterBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    gap: 6,
    backgroundColor: colors.surfaceSubtle,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterTab: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterTabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterTabText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
  },
  filterTabTextActive: {
    color: colors.textInverse,
  },
  list: {
    maxHeight: 380,
  },
  listContent: {
    paddingVertical: 2,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceSubtle,
    backgroundColor: colors.surface,
  },
  itemRowUnread: {
    backgroundColor: '#F8FAFC',
  },
  itemIconCircle: {
    width: 34,
    height: 34,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
    marginTop: 2,
  },
  itemContent: {
    flex: 1,
    paddingRight: 4,
  },
  itemTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
    paddingRight: 6,
  },
  itemTitleBold: {
    fontWeight: '700',
    color: colors.text,
  },
  itemTime: {
    fontSize: 11,
    color: colors.textLight,
  },
  itemMessage: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 16,
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginTop: 6,
    marginLeft: 4,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.sm,
  },
  emptySubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 2,
  },
  centerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  loadingText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
});
