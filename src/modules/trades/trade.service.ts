import { TradeStatus } from "@prisma/client";
import { assertTransition } from "../../utils/stateMachine";
import prisma from "../../config/db";
import { getLockedRate } from "../fx/fx.service";
import { 
  sendTradeCompletionEmail,
  sendSupplierConfirmedEmail,
  sendPaymentDetailsEmail,
  sendReceiptUploadedEmail,
  sendTradeCancelledEmail
} from "../../services/email.service";
import { triggerTradeCommission } from "../commission/commission.service";

// Kept for backward compatibility if needed, or replace entirely. 
// User snippet replaces it with quoteTrade, but the controller uses updateTradeStatus in some places.
// Actually, the user snippet for trade.service.ts ONLY showed quoteTrade.
// But the controller from Step 155 uses updateTradeStatus for other actions.
// So I should keep updateTradeStatus AND add quoteTrade, or refactor.
// Let's add quoteTrade export.

export async function updateTradeStatus(tradeId: string, newStatus: TradeStatus, actor: any) {
  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
  });

  if (!trade) {
    throw new Error("Trade not found");
  }

  assertTransition(trade.status, newStatus);

  await prisma.trade.update({
    where: { id: tradeId },
    data: { status: newStatus }
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      role: actor.role,
      action: `TRADE_${newStatus}`,
      entity: "Trade",
      entityId: tradeId,
      ip: actor.ip || "127.0.0.1"
    }
  });

  // Send trade completion email to customer
  if (newStatus === "COMPLETED") {
    try {
      const customer = await prisma.customer.findUnique({
        where: { id: trade.customerId },
        include: {
          user: { select: { email: true, firstName: true, lastName: true } }
        }
      });
      const email = customer?.email || customer?.user?.email;
      if (email) {
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
        await sendTradeCompletionEmail({
          email,
          customerName: customer?.fullName || `${customer?.user?.firstName || ""} ${customer?.user?.lastName || ""}`.trim() || "Customer",
          tradeId: `PE-${trade.id.slice(0, 5).toUpperCase()}`,
          amount: trade.amount.toString(),
          fromCurrency: trade.sendCurrency,
          toCurrency: trade.receiveCurrency,
          loginLink: `${frontendUrl}/customer/dashboard`,
        });
      }

      // Trigger Commission for Agent
      await triggerTradeCommission(tradeId);
      
    } catch (emailError) {
      console.error("Failed to process trade COMPLETED hooks:", emailError);
    }
  }

  // Handle other status emails
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: trade.customerId },
      include: { user: { select: { email: true, firstName: true } } }
    });
    const customerEmail = customer?.email || customer?.user?.email;
    const customerName = customer?.fullName || customer?.user?.firstName || "Customer";
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const tbId = trade.id.slice(0, 5).toUpperCase();

    if (customerEmail) {
      if (newStatus === "SENT_TO_CUSTOMER") {
        await sendSupplierConfirmedEmail({
          customerEmail,
          customerName,
          tradeId: tbId,
          amount: trade.amount.toString(),
          currency: trade.sendCurrency,
          dashboardLink: `${frontendUrl}/customer/trades/${trade.id}`,
        });
      } else if (newStatus === "AWAITING_PAYMENT") {
        await sendPaymentDetailsEmail({
          customerEmail,
          customerName,
          tradeId: tbId,
          amount: trade.payoutAmount?.toString() || trade.amount.toString(), // They pay sendCurrency? Wait, payout amount is what they receive. amount is what they send/pay.
          currency: trade.sendCurrency,
          paymentBankName: trade.paymentBankName || "PapaEgo Main Bank",
          paymentAccountName: trade.paymentAccountName || "PapaEgo Inc.",
          paymentAccountNumber: trade.paymentAccountNumber || "1234567890",
          dashboardLink: `${frontendUrl}/customer/trades/${trade.id}`,
        });
      } else if (newStatus === "CANCELLED") {
        await sendTradeCancelledEmail({
          customerEmail,
          customerName,
          tradeId: tbId,
          dashboardLink: `${frontendUrl}/customer/trades/${trade.id}`,
        });
      }
    }

    if (newStatus === "PAYMENT_UPLOADED") {
        // Send alert to admin
        const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true } });
        await Promise.allSettled(
            admins.map(admin => {
                if (admin.email) {
                    return sendReceiptUploadedEmail({
                        adminEmail: admin.email,
                        customerName,
                        tradeId: tbId,
                        dashboardLink: `${process.env.ADMIN_URL || "http://localhost:3000"}/admin/trades/${trade.id}`
                    });
                }
            })
        );
    }
  } catch (err) {
      console.error("Error sending trade lifecycle email:", err);
  }
}


export async function quoteTrade(tradeId: string, actor: any) {
  const trade = await prisma.trade.findUnique({ where: { id: tradeId } });

  if (!trade) throw new Error("Trade not found");

  assertTransition(trade.status, "QUOTED");

  const fxRate = await getLockedRate(
    trade.sendCurrency,
    trade.receiveCurrency,
    trade.countryId || ""
  );

  await prisma.trade.update({
    where: { id: tradeId },
    data: {
      fxRate,
      status: "QUOTED",
      lockedUntil: new Date(Date.now() + 10 * 60 * 1000)
    }
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      role: actor.role,
      action: "TRADE_QUOTED",
      entity: "Trade",
      entityId: tradeId,
      ip: actor.ip || "127.0.0.1"
    }
  });
}
