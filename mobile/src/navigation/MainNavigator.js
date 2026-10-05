import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, borderRadius } from '../components/theme';

// Screens
import DashboardScreen from '../screens/dashboard/DashboardScreen';
import ExpensesListScreen from '../screens/expenses/ExpensesListScreen';
import SubmitExpenseScreen from '../screens/expenses/SubmitExpenseScreen';
import ExpenseDetailScreen from '../screens/expenses/ExpenseDetailScreen';
import InvoicesListScreen from '../screens/invoices/InvoicesListScreen';
import InvoiceDetailScreen from '../screens/invoices/InvoiceDetailScreen';
import { Ionicons } from '@expo/vector-icons';
import PayslipsScreen from '../screens/payroll/PayslipsScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import NotificationBell from '../components/NotificationBell';
import HRAdminScreen from '../screens/hr/HRAdminScreen';
import { useAuth } from '../context/AuthContext';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function TabBarIcon({ name, focused }) {
  const ICONS = {
    Dashboard: focused ? 'grid' : 'grid-outline',
    Expenses: focused ? 'receipt' : 'receipt-outline',
    HRAdmin: focused ? 'people' : 'people-outline',
    Invoices: focused ? 'document-text' : 'document-text-outline',
    Payslips: focused ? 'wallet' : 'wallet-outline',
    Profile: focused ? 'person' : 'person-outline',
  };

  return (
    <View style={[styles.iconContainer, focused && styles.iconContainerActive]}>
      <Ionicons
        name={ICONS[name] || 'folder-outline'}
        size={20}
        color={focused ? colors.primary : colors.textMuted}
      />
    </View>
  );
}

function BottomTabs() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const bottomPadding = Platform.OS === 'android' ? Math.max(insets.bottom, 10) : insets.bottom || 12;
  const tabHeight = 60 + bottomPadding;

  const isHrAdmin =
    user?.roleName === 'HR Admin' ||
    user?.role?.name === 'HR Admin';

  return (
    <Tab.Navigator
      screenOptions={({ navigation }) => ({
        headerStyle: {
          backgroundColor: colors.surface,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.05,
          shadowRadius: 2,
          elevation: 2,
        },
        headerTintColor: colors.text,
        headerTitleStyle: {
          fontWeight: '700',
          fontSize: 18,
        },
        headerRight: () => (
          <View style={{ marginRight: 16 }}>
            <NotificationBell navigation={navigation} />
          </View>
        ),
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: tabHeight,
          paddingTop: 6,
          paddingBottom: bottomPadding,
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.06,
          shadowRadius: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: 2,
        },
      })}
    >
      <Tab.Screen
        name="DashboardTab"
        component={DashboardScreen}
        options={{
          title: 'Dashboard',
          tabBarLabel: 'Home',
          tabBarIcon: ({ focused }) => <TabBarIcon name="Dashboard" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="ExpensesTab"
        component={ExpensesListScreen}
        options={{
          title: 'Expense Claims',
          tabBarLabel: 'Expenses',
          tabBarIcon: ({ focused }) => <TabBarIcon name="Expenses" focused={focused} />,
        }}
      />
      {isHrAdmin && (
        <Tab.Screen
          name="HRAdminTab"
          component={HRAdminScreen}
          options={{
            title: 'HR Portal',
            tabBarLabel: 'HR Admin',
            tabBarIcon: ({ focused }) => <TabBarIcon name="HRAdmin" focused={focused} />,
          }}
        />
      )}
      <Tab.Screen
        name="InvoicesTab"
        component={InvoicesListScreen}
        options={{
          title: 'Client Invoices',
          tabBarLabel: 'Invoices',
          tabBarIcon: ({ focused }) => <TabBarIcon name="Invoices" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="PayslipsTab"
        component={PayslipsScreen}
        options={{
          title: 'My Payslips',
          tabBarLabel: 'Payslips',
          tabBarIcon: ({ focused }) => <TabBarIcon name="Payslips" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{
          title: 'Profile & Settings',
          tabBarLabel: 'Profile',
          tabBarIcon: ({ focused }) => <TabBarIcon name="Profile" focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
}

export default function MainNavigator() {
  return (
    <Stack.Navigator
      screenOptions={({ navigation }) => ({
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700', fontSize: 18 },
        headerShadowVisible: false,
        headerRight: () => (
          <View style={{ marginRight: 8 }}>
            <NotificationBell navigation={navigation} />
          </View>
        ),
      })}
    >
      {/* Root Tab Navigator - only visible on main hub screens */}
      <Stack.Screen
        name="MainTabs"
        component={BottomTabs}
        options={{ headerShown: false }}
      />

      {/* Full-screen detail & modal flows - bottom tab bar is naturally HIDDEN */}
      <Stack.Screen
        name="SubmitExpense"
        component={SubmitExpenseScreen}
        options={{
          title: 'New Expense Claim',
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen
        name="ExpenseDetail"
        component={ExpenseDetailScreen}
        options={{
          title: 'Claim Details',
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen
        name="InvoiceDetail"
        component={InvoiceDetailScreen}
        options={{
          title: 'Invoice Details',
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen
        name="HRAdmin"
        component={HRAdminScreen}
        options={{
          title: 'HR Administration',
          headerBackTitle: 'Back',
        }}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    width: 36,
    height: 28,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainerActive: {
    backgroundColor: colors.primaryLight,
  },
  iconEmoji: {
    fontSize: 18,
  },
});
