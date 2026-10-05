import { prisma } from "../../config/db.js";
import { getReviewableEmployeeIds } from "../../utils/hierarchy.js";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export async function getUserNotifications(actingUser) {
  const employeeId = actingUser.employee?.id;
  const isSuperAdmin = actingUser.roleType === "SUPER_ADMIN";
  const canApproveExpense = actingUser.permissionCodes?.includes("APPROVE_EXPENSE") || isSuperAdmin;
  const canVerifyExpense = actingUser.permissionCodes?.includes("VERIFY_EXPENSE") || isSuperAdmin;

  // 1. Fetch persistent notifications stored directly in Notification table
  const dbNotifications = await prisma.notification.findMany({
    where: { userId: actingUser.id },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  const readSet = new Set(
    dbNotifications.filter((n) => n.isRead).map((n) => n.id)
  );

  const notifications = [];

  // Add db notifications
  for (const n of dbNotifications) {
    let target = null;
    try {
      if (n.link) target = JSON.parse(n.link);
    } catch {
      target = n.link;
    }

    notifications.push({
      id: n.id,
      category: "SYSTEM",
      type: "SYSTEM_NOTIFICATION",
      title: "Notice",
      message: n.message,
      createdAt: n.createdAt,
      isRead: n.isRead,
      target,
    });
  }

  // 2. Synthesize Claim Status & Progress updates for Employee's own claims
  if (employeeId) {
    const ownClaims = await prisma.expenseClaim.findMany({
      where: {
        employeeId,
        status: { in: ["SUBMITTED", "MANAGER_APPROVED", "FINANCE_APPROVED", "REIMBURSEMENT_PENDING", "PAID", "RETURNED", "MANAGER_REJECTED", "FINANCE_REJECTED"] },
      },
      include: { category: true },
      orderBy: { updatedAt: "desc" },
      take: 15,
    });

    for (const c of ownClaims) {
      const syntheticId = `claim-status-${c.id}-${c.status}`;
      const isRead = readSet.has(syntheticId);
      const amtFormatted = `₹${Number(c.amount).toLocaleString("en-IN")}`;
      const purpose = c.purpose || c.category?.name || "Expense";

      let title = "Expense Claim Update";
      let message = "";
      let type = "CLAIM_UPDATE";
      let category = "CLAIMS";

      switch (c.status) {
        case "SUBMITTED":
          title = "Claim Submitted";
          message = `Your claim "${purpose}" for ${amtFormatted} is submitted and awaiting manager review.`;
          type = "SUBMITTED";
          break;
        case "MANAGER_APPROVED":
          title = "Manager Approved";
          message = `Great news! Your manager approved "${purpose}" (${amtFormatted}). Forwarded to Finance.`;
          type = "APPROVED";
          break;
        case "FINANCE_APPROVED":
        case "REIMBURSEMENT_PENDING":
          title = "Cleared for Payment";
          message = `Finance approved "${purpose}" (${amtFormatted}). Reimbursement disbursement is in progress.`;
          type = "APPROVED";
          break;
        case "PAID":
          title = "Reimbursement Paid";
          message = `Payment of ${amtFormatted} for "${purpose}" has been disbursed and completed.`;
          type = "PAID";
          break;
        case "RETURNED":
          title = "Action Required: Claim Returned";
          message = `Claim "${purpose}" (${amtFormatted}) was returned for correction. Tap to view and resubmit.`;
          type = "RETURNED";
          break;
        case "MANAGER_REJECTED":
        case "FINANCE_REJECTED":
          title = "Claim Not Approved";
          message = `Claim "${purpose}" (${amtFormatted}) was rejected.`;
          type = "REJECTED";
          break;
      }

      notifications.push({
        id: syntheticId,
        category,
        type,
        title,
        message,
        createdAt: c.updatedAt,
        isRead,
        target: { screen: "ExpenseDetail", params: { claimId: c.id } },
      });
    }
  }

  // 3. Synthesize Pending Review Queue notifications for Reviewers (Managers, Finance, Super Admin)
  if (canApproveExpense && employeeId) {
    const reviewableIds = isSuperAdmin ? [] : await getReviewableEmployeeIds(actingUser);
    const where = isSuperAdmin
      ? { status: "SUBMITTED" }
      : { status: "SUBMITTED", employeeId: { in: reviewableIds } };

    const pendingClaims = await prisma.expenseClaim.findMany({
      where,
      include: { employee: true, category: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    for (const c of pendingClaims) {
      if (c.employeeId === employeeId) continue; // exclude own claims from reviewer queue
      const syntheticId = `approval-queue-${c.id}`;
      const isRead = readSet.has(syntheticId);
      const empName = c.employee ? `${c.employee.firstName} ${c.employee.lastName}` : "Team member";
      const amtFormatted = `₹${Number(c.amount).toLocaleString("en-IN")}`;
      const purpose = c.purpose || "Expense";

      notifications.push({
        id: syntheticId,
        category: "APPROVALS",
        type: "PENDING_APPROVAL",
        title: "Review Required",
        message: `${empName} submitted a claim of ${amtFormatted} for "${purpose}".`,
        createdAt: c.createdAt,
        isRead,
        target: { screen: "ExpenseDetail", params: { claimId: c.id } },
      });
    }
  }

  if (canVerifyExpense) {
    const financePending = await prisma.expenseClaim.findMany({
      where: { status: "MANAGER_APPROVED" },
      include: { employee: true, category: true },
      orderBy: { updatedAt: "desc" },
      take: 10,
    });

    for (const c of financePending) {
      if (c.employeeId === employeeId) continue;
      const syntheticId = `finance-queue-${c.id}`;
      const isRead = readSet.has(syntheticId);
      const empName = c.employee ? `${c.employee.firstName} ${c.employee.lastName}` : "Employee";
      const amtFormatted = `₹${Number(c.amount).toLocaleString("en-IN")}`;

      notifications.push({
        id: syntheticId,
        category: "APPROVALS",
        type: "FINANCE_PENDING",
        title: "Finance Clearance Required",
        message: `${empName}'s claim of ${amtFormatted} is manager-approved and awaiting finance clearance.`,
        createdAt: c.updatedAt,
        isRead,
        target: { screen: "ExpenseDetail", params: { claimId: c.id } },
      });
    }
  }

  // 4. Synthesize Salary & Payslip updates for Employee
  if (employeeId) {
    const payslips = await prisma.payslip.findMany({
      where: { employeeId },
      orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
      take: 3,
    });

    for (const p of payslips) {
      const monthName = MONTH_NAMES[(p.periodMonth || 1) - 1] || `Month ${p.periodMonth}`;
      const netFormatted = `₹${Number(p.netSalary || 0).toLocaleString("en-IN")}`;
      const syntheticId = `payslip-${p.id}-${p.paymentStatus}`;
      const isRead = readSet.has(syntheticId);

      if (p.paymentStatus === "PAID") {
        notifications.push({
          id: syntheticId,
          category: "SALARY",
          type: "SALARY_PAID",
          title: "Salary Credited",
          message: `Your salary of ${netFormatted} for ${monthName} ${p.periodYear} has been disbursed.`,
          createdAt: p.paidAt || p.generatedAt || new Date(),
          isRead,
          target: { screen: "PayslipsTab" },
        });
      } else {
        notifications.push({
          id: syntheticId,
          category: "SALARY",
          type: "SALARY_GENERATED",
          title: "Payslip Available",
          message: `Your payslip for ${monthName} ${p.periodYear} (${netFormatted}) has been generated.`,
          createdAt: p.generatedAt || new Date(),
          isRead,
          target: { screen: "PayslipsTab" },
        });
      }
    }
  }

  // Sort all notifications chronologically descending
  notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Cap at top 30
  const sliced = notifications.slice(0, 30);
  const unreadCount = sliced.filter((n) => !n.isRead).length;

  return {
    items: sliced,
    unreadCount,
    totalCount: sliced.length,
  };
}

export async function markNotificationAsRead(actingUser, notificationId) {
  if (notificationId === "ALL") {
    // Mark all existing in Notification table as read
    await prisma.notification.updateMany({
      where: { userId: actingUser.id, isRead: false },
      data: { isRead: true },
    });

    // Also get all synthetic notification IDs and record them as read
    const current = await getUserNotifications(actingUser);
    const unreadSynthetics = current.items.filter((item) => !item.isRead);

    for (const item of unreadSynthetics) {
      await prisma.notification.upsert({
        where: { id: item.id },
        create: {
          id: item.id,
          userId: actingUser.id,
          message: item.message,
          isRead: true,
          link: item.target ? JSON.stringify(item.target) : null,
          createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
        },
        update: { isRead: true },
      }).catch(() => {});
    }

    return { success: true };
  }

  // Single notification
  await prisma.notification.upsert({
    where: { id: notificationId },
    create: {
      id: notificationId,
      userId: actingUser.id,
      message: "Notification read",
      isRead: true,
    },
    update: { isRead: true },
  }).catch(() => {});

  return { success: true };
}
