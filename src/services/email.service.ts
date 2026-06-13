import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);


interface ResetPasswordParams {
  email: string;
  userName: string;
  resetUrl: string;
}

/**
 * Sends a password reset email with a secure token link
 */
export async function sendResetPasswordEmail({
  email,
  userName,
  resetUrl,
}: ResetPasswordParams) {
  try {
    const { data, error } = await resend.emails.send({
      from: 'PapaEgo <security@papaego.com>',
      to: email,
      subject: "Reset Your PapaEgo Password",
      text: `
Hello ${userName},

We received a request to reset your PapaEgo account password.

Click the link below to set a new password:
${resetUrl}

This link will expire in 1 hour. If you didn't request this, please ignore this email — your password will remain unchanged.

© ${new Date().getFullYear()} PapaEgo. All rights reserved.
      `,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Ubuntu, sans-serif; background-color: #f6f9fc; margin: 0; padding: 0;">
            <div style="background-color: #ffffff; max-width: 600px; margin: 0 auto; margin-bottom: 64px; padding: 20px 0 48px;">
              <h1 style="color: #c9a227; font-size: 24px; font-weight: bold; padding: 0 48px; margin-bottom: 24px;">
                PapaEgo
              </h1>
              
              <div style="padding: 0 48px;">
                <p style="color: #333; font-size: 16px; line-height: 24px; margin-bottom: 16px;">
                  Hello ${userName},
                </p>
                
                <p style="color: #333; font-size: 16px; line-height: 24px; margin-bottom: 16px;">
                  We received a request to reset the password for your PapaEgo account. Click the button below to set a new password:
                </p>
                
                <div style="text-align: center; margin: 32px 0;">
                  <a href="${resetUrl}" style="background-color: #c9a227; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 16px; font-weight: 600; display: inline-block;">
                    Reset Password
                  </a>
                </div>
                
                <div style="background-color: #fff8e1; border-left: 4px solid #c9a227; padding: 12px 16px; border-radius: 4px; margin: 24px 0;">
                  <p style="color: #6b7078; font-size: 14px; line-height: 20px; margin: 0;">
                    ⏰ This link will expire in <strong>1 hour</strong>. If you didn't request a password reset, you can safely ignore this email.
                  </p>
                </div>
                
                <p style="color: #666; font-size: 14px; line-height: 20px; margin-top: 24px;">
                  Or copy and paste this URL into your browser:<br>
                  <span style="color: #c9a227; word-break: break-all;">${resetUrl}</span>
                </p>
              </div>
              
              <div style="border-top: 1px solid #e6ebf1; margin-top: 48px; padding-top: 24px;">
                <p style="color: #8898aa; font-size: 12px; line-height: 16px; padding: 0 48px; margin: 0;">
                  © ${new Date().getFullYear()} PapaEgo. All rights reserved.<br>
                  Empowering global financial transactions.
                </p>
              </div>
            </div>
          </body>
        </html>
      `,
    });
    if (error) throw error;
    console.log("✅ Reset password email sent:", data?.id);
    return { success: true, messageId: data?.id };
  } catch (error) {
    console.error("❌ Error sending reset password email:", error);
    throw new Error("Failed to send reset password email");
  }
}

interface AgentInvitationParams {
  email: string;
  agentName: string;
  licenseId: string;
  onboardingLink: string;
}

/**
 * Sends an invitation email to a newly created agent
 */
export async function sendAgentInvitation({
  email,
  agentName,
  licenseId,
  onboardingLink,
}: AgentInvitationParams) {
  try {
    const { data, error } = await resend.emails.send({
      from: 'PapaEgo <careers@papaego.com>',
      to: email,
      subject: "Welcome to PapaEgo - Complete Your Agent Onboarding",
      text: `
Welcome to PapaEgo Agent Network!

Hello${agentName ? " " + agentName : ""},

Congratulations! You've been invited to join PapaEgo as an authorized agent. Your license ID is ${licenseId}.

To complete your onboarding and start facilitating cross-border transactions, please use the following link:
${onboardingLink}

This link will expire in 7 days. If you did not request this invitation, please ignore this email.

© ${new Date().getFullYear()} PapaEgo. All rights reserved.
      `,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Ubuntu, sans-serif; background-color: #f6f9fc; margin: 0; padding: 0;">
            <div style="background-color: #ffffff; max-width: 600px; margin: 0 auto; margin-bottom: 64px; padding: 20px 0 48px;">
              <h1 style="color: #333; font-size: 24px; font-weight: bold; padding: 0 48px; margin-bottom: 24px;">
                Welcome to PapaEgo Agent Network!
              </h1>
              
              <div style="padding: 0 48px;">
                <p style="color: #333; font-size: 16px; line-height: 24px; margin-bottom: 16px;">
                  Hello${agentName ? " " + agentName : ""},
                </p>
                
                <p style="color: #333; font-size: 16px; line-height: 24px; margin-bottom: 16px;">
                  Congratulations! You've been invited to join PapaEgo as an authorized agent. Your license ID is <strong>${licenseId}</strong>.
                </p>
                
                <p style="color: #333; font-size: 16px; line-height: 24px; margin-bottom: 24px;">
                  To complete your onboarding and start facilitating cross-border transactions, please click the button below:
                </p>
                
                <div style="text-align: center; margin: 32px 0;">
                  <a href="${onboardingLink}" style="background-color: #c9a227; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-size: 16px; font-weight: 600; display: inline-block;">
                    Complete Onboarding
                  </a>
                </div>
                
                <p style="color: #666; font-size: 14px; line-height: 20px; margin-top: 32px;">
                  This link will expire in 7 days. If you did not request this invitation, please ignore this email.
                </p>
                
                <p style="color: #666; font-size: 14px; line-height: 20px; margin-top: 16px;">
                  Or copy and paste this URL into your browser:<br>
                  <span style="color: #c9a227; word-break: break-all;">${onboardingLink}</span>
                </p>
              </div>
              
              <div style="border-top: 1px solid #e6ebf1; margin-top: 48px; padding-top: 24px;">
                <p style="color: #8898aa; font-size: 12px; line-height: 16px; padding: 0 48px; margin: 0;">
                  © ${new Date().getFullYear()} PapaEgo. All rights reserved.<br>
                  Empowering global financial transactions.
                </p>
              </div>
            </div>
          </body>
        </html>
      `,
    });
    if (error) throw error;
    console.log("✅ Email sent successfully:", data?.id);
    return { success: true, messageId: data?.id };
  } catch (error) {
    console.error("❌ Error sending agent invitation email:", error);
    throw new Error("Failed to send invitation email");
  }
}

interface AgentVerificationParams {
  email: string;
  agentName: string;
  loginLink: string;
}

/**
 * Sends a welcome verification email when an Admin approves an agent
 */
export async function sendAgentVerificationEmail({
  email,
  agentName,
  loginLink,
}: AgentVerificationParams) {
  try {
    const { data, error } = await resend.emails.send({
      from: 'PapaEgo Registration <verify@papaego.com>',
      to: email,
      subject: "Welcome to PapaEgo - Account Verified!",
      text: `
Hello ${agentName},

Congratulations! Your PapaEgo Agent account has been fully verified and activated by our administration team.

You can now log in to your dashboard and begin processing trades.

Login Here: ${loginLink}

Welcome aboard!
© ${new Date().getFullYear()} PapaEgo. All rights reserved.
      `,
      html: `
        <!DOCTYPE html>
        <html>
          <body style="font-family: -apple-system, sans-serif; background-color: #f6f9fc; margin: 0; padding: 20px;">
            <div style="background-color: #ffffff; max-width: 600px; margin: 0 auto; padding: 24px; border-radius: 8px;">
              <h2 style="color: #27ae60; margin-bottom: 24px;">Account Verified! 🎉</h2>
              <p style="color: #333; font-size: 16px;">Hello ${agentName},</p>
              <p style="color: #333; font-size: 16px;">Congratulations! Your PapaEgo Agent account has been fully verified and activated by our administration team.</p>
              <p style="color: #333; font-size: 16px;">You can now log in to your dashboard and begin processing trades.</p>
              
              <div style="text-align: center; margin: 32px 0;">
                <a href="${loginLink}" style="background-color: #c9a227; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: bold; display: inline-block;">
                  Login to Dashboard
                </a>
              </div>
              
              <p style="color: #666; font-size: 14px;">Or copy this link: <span style="color: #c9a227;">${loginLink}</span></p>
              
              <hr style="border: 0; border-top: 1px solid #e6ebf1; margin: 32px 0;" />
              <p style="color: #8898aa; font-size: 12px;">© ${new Date().getFullYear()} PapaEgo. All rights reserved.</p>
            </div>
          </body>
        </html>
      `,
    });
    if (error) throw error;
    console.log("✅ Verification email sent successfully:", data?.id);
    return { success: true, messageId: data?.id };
  } catch (error) {
    console.error("❌ Error sending agent verification email:", error);
    throw new Error("Failed to send verification email");
  }
}

interface CustomerVerificationParams {
  email: string;
  customerName: string;
  loginLink: string;
}

/**
 * Sends a welcome verification email when an Admin approves a customer
 */
export async function sendCustomerVerificationEmail({
  email,
  customerName,
  loginLink,
}: CustomerVerificationParams) {
  try {
    const { data, error } = await resend.emails.send({
      from: 'PapaEgo Verification <verify@papaego.com>',
      to: email,
      subject: "Welcome to PapaEgo - Account Verified!",
      text: `
Hello ${customerName},

Congratulations! Your PapaEgo Customer account has been fully verified.

You can now log in to your dashboard and begin creating trade requests.

Login Here: ${loginLink}

Welcome aboard!
© ${new Date().getFullYear()} PapaEgo. All rights reserved.
      `,
      html: `
        <!DOCTYPE html>
        <html>
          <body style="font-family: -apple-system, sans-serif; background-color: #f6f9fc; margin: 0; padding: 20px;">
            <div style="background-color: #ffffff; max-width: 600px; margin: 0 auto; padding: 24px; border-radius: 8px;">
              <h2 style="color: #27ae60; margin-bottom: 24px;">Account Verified! 🎉</h2>
              <p style="color: #333; font-size: 16px;">Hello ${customerName},</p>
              <p style="color: #333; font-size: 16px;">Congratulations! Your PapaEgo account has been fully verified and you are now ready to trade.</p>
              
              <div style="text-align: center; margin: 32px 0;">
                <a href="${loginLink}" style="background-color: #c9a227; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: bold; display: inline-block;">
                  Login to Dashboard
                </a>
              </div>
              
              <p style="color: #8898aa; font-size: 12px;">© ${new Date().getFullYear()} PapaEgo. All rights reserved.</p>
            </div>
          </body>
        </html>
      `,
    });
    if (error) throw error;
    console.log("✅ Verification email sent to customer:", data?.id);
    return { success: true, messageId: data?.id };
  } catch (error) {
    console.error("❌ Error sending customer verification email:", error);
    // Don't throw so it doesn't break the approval flow
    return { success: false };
  }
}

interface KycRejectionParams {
  email: string;
  customerName: string;
  reason: string;
  loginLink: string;
}

/**
 * Sends a KYC rejection email with the reason and a link to re-upload
 */
export async function sendKycRejectionEmail({
  email,
  customerName,
  reason,
  loginLink,
}: KycRejectionParams) {
  try {
    const { data, error } = await resend.emails.send({
      from: 'PapaEgo Compliance <compliance@papaego.com>',
      to: email,
      subject: "Action Required: Update Your PapaEgo Verification Documents",
      text: `
Hello ${customerName},

Thank you for submitting your identity verification documents to PapaEgo.

Upon review, our compliance team was unable to approve your KYC verification for the following reason:
${reason}

To continue using PapaEgo and unlock cross-border trade capabilities, please log in to your dashboard and re-upload the correct documents:
${loginLink}

If you have any questions, please contact our support team.

© ${new Date().getFullYear()} PapaEgo. All rights reserved.
      `,
      html: `
        <!DOCTYPE html>
        <html>
          <body style="font-family: -apple-system, sans-serif; background-color: #f6f9fc; margin: 0; padding: 20px;">
            <div style="background-color: #ffffff; max-width: 600px; margin: 0 auto; padding: 24px; border-radius: 8px;">
              <h2 style="color: #e05555; margin-bottom: 24px;">Action Required: Update Verification Documents ⚠️</h2>
              <p style="color: #333; font-size: 16px;">Hello ${customerName},</p>
              <p style="color: #333; font-size: 16px;">Thank you for submitting your identity verification documents to PapaEgo.</p>
              <p style="color: #333; font-size: 16px;">Upon review, our compliance team was unable to approve your KYC verification for the following reason:</p>
              
              <div style="background-color: #fff5f5; border-left: 4px solid #e05555; padding: 16px; border-radius: 4px; margin: 24px 0;">
                <p style="color: #e05555; font-size: 14px; font-weight: 600; margin: 0 0 4px 0;">Reason for Rejection</p>
                <p style="color: #333; font-size: 15px; margin: 0; line-height: 22px;">${reason}</p>
              </div>

              <p style="color: #333; font-size: 16px;">To continue using PapaEgo and unlock cross-border trade capabilities, please click the button below to log in and re-upload the correct documents:</p>
              
              <div style="text-align: center; margin: 32px 0;">
                <a href="${loginLink}" style="background-color: #c9a227; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: bold; display: inline-block;">
                  Upload Documents
                </a>
              </div>
              
              <p style="color: #666; font-size: 14px;">If you have any questions or require assistance, please reply to this email to contact our support team.</p>
              
              <hr style="border: 0; border-top: 1px solid #e6ebf1; margin: 32px 0;" />
              <p style="color: #8898aa; font-size: 12px;">© ${new Date().getFullYear()} PapaEgo. All rights reserved.</p>
            </div>
          </body>
        </html>
      `,
    });
    if (error) throw error;
    console.log("✅ KYC rejection email sent successfully to:", email);
    return { success: true, messageId: data?.id };
  } catch (error) {
    console.error("❌ Error sending KYC rejection email:", error);
    return { success: false };
  }
}

interface AgentSuspensionParams {
  email: string;
  agentName: string;
}

/**
 * Sends an email stating the agent account is suspended
 */
export async function sendAgentSuspensionEmail({
  email,
  agentName,
}: AgentSuspensionParams) {
  try {
    const { data, error } = await resend.emails.send({
      from: 'PapaEgo Compliance <compliance@papaego.com>',
      to: email,
      subject: "Important: Your PapaEgo Agent Account Status",
      text: `
Hello ${agentName},

This is an automated notice to inform you that your PapaEgo Agent account has been suspended by our administration team.

During this suspension, your dashboard access has been revoked and you cannot process any further transactions.

If you believe this is an error, please contact our support team immediately for further review.

© ${new Date().getFullYear()} PapaEgo. All rights reserved.
      `,
      html: `
        <!DOCTYPE html>
        <html>
          <body style="font-family: -apple-system, sans-serif; background-color: #f6f9fc; margin: 0; padding: 20px;">
            <div style="background-color: #ffffff; max-width: 600px; margin: 0 auto; padding: 24px; border-radius: 8px;">
              <h2 style="color: #e05555; margin-bottom: 24px;">Account Suspended</h2>
              <p style="color: #333; font-size: 16px;">Hello ${agentName},</p>
              <p style="color: #333; font-size: 16px;">This is an automated notice to inform you that your PapaEgo Agent account has been <strong>suspended</strong> by our administration team.</p>
              <p style="color: #333; font-size: 16px;">During this suspension, your dashboard access has been revoked and you cannot process any further transactions.</p>
              
              <p style="color: #333; font-size: 16px; margin-top: 24px;">If you believe this is an error, please contact our compliance or support team immediately for further review.</p>
              
              <hr style="border: 0; border-top: 1px solid #e6ebf1; margin: 32px 0;" />
              <p style="color: #8898aa; font-size: 12px;">© ${new Date().getFullYear()} PapaEgo. All rights reserved.</p>
            </div>
          </body>
        </html>
      `,
    });
    if (error) throw error;
    console.log("✅ Suspension email sent successfully:", data?.id);
    return { success: true, messageId: data?.id };
  } catch (error) {
    console.error("❌ Error sending agent suspension email:", error);
    throw new Error("Failed to send suspension email");
  }
}

interface TradeCompletionParams {
  email: string;
  customerName: string;
  tradeId: string;
  amount: string;
  fromCurrency: string;
  toCurrency: string;
  loginLink: string;
  adminEmails?: string[];
}

/**
 * Sends a trade completion notification email to the customer
 */
export async function sendTradeCompletionEmail({
  email,
  customerName,
  tradeId,
  amount,
  fromCurrency,
  toCurrency,
  loginLink,
  adminEmails,
}: TradeCompletionParams) {
  try {
    const recipients = [email, ...(adminEmails || [])];
    const { data, error } = await resend.emails.send({
      from: 'PapaEgo <transactions@papaego.com>',
      to: recipients,
      subject: `Your PapaEgo Trade #${tradeId} is Complete! 🎉`,
      text: `
Hello ${customerName},

Great news! Your trade has been successfully completed.

Trade Reference: #${tradeId}
Amount: ${amount} ${fromCurrency} → ${toCurrency}

You can view the full trade details by logging in to your dashboard.
${loginLink}

Thank you for trading with PapaEgo!
© ${new Date().getFullYear()} PapaEgo. All rights reserved.
      `,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Ubuntu, sans-serif; background-color: #f6f9fc; margin: 0; padding: 20px;">
            <div style="background-color: #ffffff; max-width: 600px; margin: 0 auto; padding: 48px; border-radius: 8px;">
              <h1 style="color: #c9a227; font-size: 28px; font-weight: 700; margin-bottom: 8px;">PapaEgo</h1>
              <div style="background-color: #e2fded; border-radius: 8px; padding: 16px; margin-bottom: 24px; display: flex; align-items: center;">
                <span style="color: #27ae60; font-size: 20px; margin-right: 8px;">✅</span>
                <p style="color: #27ae60; font-weight: 600; margin: 0;">Trade Completed Successfully!</p>
              </div>

              <p style="color: #333; font-size: 16px; margin-bottom: 16px;">Hello ${customerName},</p>
              <p style="color: #333; font-size: 16px; margin-bottom: 24px;">Great news! Your trade has been successfully completed and processed by our team.</p>

              <div style="background-color: #f7f8f9; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
                <h3 style="color: #012333; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px;">Trade Summary</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="color: #6b7078; font-size: 14px; padding: 6px 0;">Trade Reference</td>
                    <td style="color: #012333; font-size: 14px; font-weight: 600; text-align: right;">#${tradeId}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7078; font-size: 14px; padding: 6px 0;">Amount</td>
                    <td style="color: #012333; font-size: 14px; font-weight: 600; text-align: right;">${amount} ${fromCurrency}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7078; font-size: 14px; padding: 6px 0;">Converted To</td>
                    <td style="color: #012333; font-size: 14px; font-weight: 600; text-align: right;">${toCurrency}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7078; font-size: 14px; padding: 6px 0;">Status</td>
                    <td style="color: #27ae60; font-size: 14px; font-weight: 600; text-align: right;">Completed ✓</td>
                  </tr>
                </table>
              </div>

              <div style="text-align: center; margin: 32px 0;">
                <a href="${loginLink}" style="background-color: #c9a227; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 16px; font-weight: 600; display: inline-block;">
                  View Trade Details
                </a>
              </div>

              <p style="color: #6b7078; font-size: 14px; line-height: 20px; margin-top: 24px;">
                Thank you for trading with PapaEgo. If you have any questions, please don't hesitate to contact our support team.
              </p>

              <hr style="border: 0; border-top: 1px solid #e6ebf1; margin: 32px 0;" />
              <p style="color: #8898aa; font-size: 12px; margin: 0;">
                © ${new Date().getFullYear()} PapaEgo. All rights reserved.<br>
                Empowering global financial transactions.
              </p>
            </div>
          </body>
        </html>
      `,
    });
    if (error) throw error;
    console.log("✅ Trade completion email sent:", data?.id);
    return { success: true, messageId: data?.id };
  } catch (error) {
    console.error("❌ Error sending trade completion email:", error);
    // Don't throw — email failure shouldn't block trade completion
    return { success: false };
  }
}

interface TradeInitiatedParams {
  agentEmail: string;
  agentName: string;
  customerName: string;
  amount: string;
  currency: string;
  tradeId: string;
  dashboardLink?: string;
  adminEmails?: string[];
}

/**
 * Notifies an agent that a customer has initiated a trade request
 */
export async function sendTradeInitiatedEmail({
  agentEmail,
  agentName,
  customerName,
  amount,
  currency,
  tradeId,
  dashboardLink,
  adminEmails,
}: TradeInitiatedParams) {
  try {
    await resend.emails.send({
      from: 'PapaEgo <requests@papaego.com>',
      to: [agentEmail, ...(adminEmails || [])],
      subject: `New Trade Request: ${customerName} initiated a trade`,
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>New Trade Request 📥</h2>
          <p>Hello ${agentName || 'Agent'},</p>
          <p><strong>${customerName}</strong> has just initiated a new trade request assigned to you.</p>
          <p><strong>Amount:</strong> ${amount} ${currency}</p>
          <div style="margin: 20px 0;">
            <a href="${dashboardLink}" style="background: #c9a227; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Trade Request</a>
          </div>
          <p>Please log in to provide a quote and supplier account details.</p>
        </div>
      `
    });
  } catch (error) {
    console.error("Error sending trade initiation email:", error);
  }
}

interface SupplierConfirmedParams {
  customerEmail: string;
  customerName: string;
  tradeId: string;
  amount: string;
  currency: string;
  fxRate?: string;
  payoutAmount?: string;
  receiveCurrency?: string;
  dashboardLink: string;
  adminEmails?: string[];
}

/**
 * Notifies a customer that the agent has provided the supplier account and rate
 */
export async function sendSupplierConfirmedEmail({
  customerEmail,
  customerName,
  tradeId,
  amount,
  currency,
  fxRate,
  payoutAmount,
  receiveCurrency,
  dashboardLink,
  adminEmails,
}: SupplierConfirmedParams) {
  try {
    await resend.emails.send({
      from: 'PapaEgo <updates@papaego.com>',
      to: [customerEmail, ...(adminEmails || [])],
      subject: `Action Required: Quote Ready for Trade #${tradeId}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>Quote & Supplier Ready! ✅</h2>
          <p>Hello ${customerName},</p>
          <p>Your agent has provided the conversion rate and supplier account details for your trade request <strong>#${tradeId}</strong>.</p>
          
          <div style="background: #f7f8f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0;"><strong>Send Amount:</strong> ${amount} ${currency}</p>
            ${fxRate ? `<p style="margin: 0 0 10px 0;"><strong>Exchange Rate:</strong> 1 ${currency} = ${fxRate} ${receiveCurrency || 'NGN'}</p>` : ''}
            ${payoutAmount ? `<p style="margin: 0;"><strong>Estimated Payout:</strong> ${payoutAmount} ${receiveCurrency || ''}</p>` : ''}
          </div>

          <div style="margin: 20px 0;">
            <a href="${dashboardLink}" style="background: #c9a227; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Confirm & Pay Now</a>
          </div>
          <p>Please review the details and confirm to lock in the rate.</p>
        </div>
      `
    });
  } catch (error) {
    console.error("Error sending supplier confirmation email:", error);
  }
}
/**
 * Notifies a customer that their trade has been cancelled or rejected
 */
export async function sendTradeCancelledEmail({
  customerEmail,
  customerName,
  tradeId,
  reason,
  dashboardLink,
  adminEmails,
}: {
  customerEmail: string;
  customerName: string;
  tradeId: string;
  reason?: string;
  dashboardLink: string;
  adminEmails?: string[];
}) {
    const recipients = [customerEmail, ...(adminEmails || [])];
  try {
    await resend.emails.send({
      from: 'PapaEgo <support@papaego.com>',
      to: recipients,
      subject: `Update on your Trade #${tradeId}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2 style="color: #e05555;">Trade Cancelled ❌</h2>
          <p>Hello ${customerName},</p>
          <p>This is to inform you that your trade <strong>#${tradeId}</strong> has been cancelled.</p>
          ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
          <div style="margin: 20px 0;">
            <a href="${dashboardLink}" style="background: #c9a227; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Trade Details</a>
          </div>
          <p>If you have any questions or would like to discuss this further, please contact our support team.</p>
          <p>Thank you for choosing PapaEgo.</p>
        </div>
      `
    });
  } catch (error) {
    console.error("Error sending trade cancellation email:", error);
  }
}

/**
 * Notifies a customer with the admin's payment account details
 */
export async function sendPaymentDetailsEmail({
  customerEmail,
  customerName,
  tradeId,
  amount,
  currency,
  paymentBankName,
  paymentAccountName,
  paymentAccountNumber,
  dashboardLink,
}: {
  customerEmail: string;
  customerName: string;
  tradeId: string;
  amount: string;
  currency: string;
  paymentBankName: string;
  paymentAccountName: string;
  paymentAccountNumber: string;
  dashboardLink: string;
}) {
  try {
    await resend.emails.send({
      from: 'PapaEgo <payments@papaego.com>',
      to: customerEmail,
      subject: `Action Required: Pay for Trade #${tradeId}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>Payment Details Ready 💳</h2>
          <p>Hello ${customerName},</p>
          <p>Your trade <strong>#${tradeId}</strong> has been processed. Please make a payment of <strong>${amount} ${currency}</strong> to the following account:</p>
          <div style="background: #f7f8f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0;"><strong>Bank Name:</strong> ${paymentBankName}</p>
            <p style="margin: 0 0 10px 0;"><strong>Account Name:</strong> ${paymentAccountName}</p>
            <p style="margin: 0;"><strong>Account Number:</strong> ${paymentAccountNumber}</p>
          </div>
          <p>After making the transfer, please click the button below to upload your payment receipt.</p>
          <div style="margin: 20px 0;">
            <a href="${dashboardLink}" style="background: #c9a227; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Upload Receipt</a>
          </div>
        </div>
      `
    });
  } catch (error) {
    console.error("Error sending payment details email:", error);
  }
}

/**
 * Notifies admins that a customer has uploaded their payment receipt
 */
export async function sendReceiptUploadedEmail({
  adminEmail,
  customerName,
  tradeId,
  dashboardLink,
}: {
  adminEmail: string;
  customerName: string;
  tradeId: string;
  dashboardLink: string;
}) {
  try {
    await resend.emails.send({
      from: 'PapaEgo <alerts@papaego.com>',
      to: adminEmail,
      subject: `Receipt Uploaded for Trade #${tradeId}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>Payment Receipt Uploaded 🧾</h2>
          <p>Admin,</p>
          <p><strong>${customerName}</strong> has uploaded a payment receipt for trade <strong>#${tradeId}</strong>.</p>
          <p>Please review the receipt and complete the trade by sending the final payout receipt to the customer.</p>
          <div style="margin: 20px 0;">
            <a href="${dashboardLink}" style="background: #012333; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Review Trade</a>
          </div>
        </div>
      `
    });
  } catch (error) {
    console.error("Error sending receipt uploaded email:", error);
  }
}

/**
 * Notifies customer that trade is complete with final payout receipt attached/linked
 */
export async function sendTradeCompletedWithReceiptEmail({
  customerEmail,
  customerName,
  tradeId,
  receiptUrl,
  dashboardLink,
}: {
  customerEmail: string;
  customerName: string;
  tradeId: string;
  receiptUrl: string;
  dashboardLink: string;
}) {
  try {
    await resend.emails.send({
      from: 'PapaEgo <updates@papaego.com>',
      to: customerEmail,
      subject: `Trade Completed! View Receipt for #${tradeId}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>Trade Complete ✅</h2>
          <p>Hello ${customerName},</p>
          <p>Your trade <strong>#${tradeId}</strong> has been successfully completed.</p>
          <p>The payout has been processed and your transaction receipt is available.</p>
          <div style="margin: 20px 0; display: flex; gap: 10px;">
            <a href="${receiptUrl}" target="_blank" style="background: #27ae60; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Receipt</a>
            <a href="${dashboardLink}" style="background: #c9a227; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Trade in Dashboard</a>
          </div>
          <p>Thank you for trading with PapaEgo!</p>
        </div>
      `
    });
  } catch (error) {
    console.error("Error sending trade completed email:", error);
  }
}

/**
 * Sends a generic message from admin to a customer
 */
export async function sendAdminMessageEmail({
  email,
  customerName,
  subject,
  message,
}: {
  email: string;
  customerName: string;
  subject: string;
  message: string;
}) {
  try {
    const { data, error } = await resend.emails.send({
      from: 'PapaEgo Support <support@papaego.com>',
      to: email,
      subject: subject || "Message from PapaEgo Administration",
      text: `
Hello ${customerName},

${message}

Thank you,
PapaEgo Support Team
© ${new Date().getFullYear()} PapaEgo. All rights reserved.
      `,
      html: `
        <!DOCTYPE html>
        <html>
          <body style="font-family: -apple-system, sans-serif; background-color: #f6f9fc; margin: 0; padding: 20px;">
            <div style="background-color: #ffffff; max-width: 600px; margin: 0 auto; padding: 24px; border-radius: 8px;">
              <h2 style="color: #012333; margin-bottom: 24px;">${subject || "Message from PapaEgo"}</h2>
              <p style="color: #333; font-size: 16px;">Hello ${customerName},</p>
              <div style="color: #333; font-size: 16px; margin: 24px 0; background: #f7f8f9; padding: 15px; border-radius: 6px; white-space: pre-wrap;">${message}</div>
              
              <p style="color: #666; font-size: 14px; margin-top: 32px;">If you have any questions, please reply to this email to contact our support team.</p>
              
              <hr style="border: 0; border-top: 1px solid #e6ebf1; margin: 32px 0;" />
              <p style="color: #8898aa; font-size: 12px; margin: 0;">© ${new Date().getFullYear()} PapaEgo. All rights reserved.</p>
            </div>
          </body>
        </html>
      `,
    });
    if (error) throw error;
    return { success: true, messageId: data?.id };
  } catch (error) {
    console.error("❌ Error sending admin message email:", error);
    throw new Error("Failed to send message email");
  }
}

interface RateQuotedParams {
  customerEmail: string;
  customerName: string;
  tradeId: string;
  amount: string;
  currency: string;
  fxRate: string;
  payoutAmount: string;
  receiveCurrency: string;
  dashboardLink: string;
}

/**
 * Notifies a customer that the admin has set the exchange rate for their trade request
 */
export async function sendRateQuotedEmail({
  customerEmail,
  customerName,
  tradeId,
  amount,
  currency,
  fxRate,
  payoutAmount,
  receiveCurrency,
  dashboardLink,
}: RateQuotedParams) {
  try {
    const { data, error } = await resend.emails.send({
      from: 'PapaEgo <updates@papaego.com>',
      to: customerEmail,
      subject: `Exchange Rate Set for Trade #${tradeId}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>Exchange Rate Confirmed ✅</h2>
          <p>Hello ${customerName},</p>
          <p>Our team has set and confirmed the exchange rate for your trade request <strong>#${tradeId}</strong>.</p>
          
          <div style="background: #f7f8f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0;"><strong>Send Amount:</strong> ${amount} ${currency}</p>
            <p style="margin: 0 0 10px 0;"><strong>Exchange Rate:</strong> 1 ${currency === 'NGN' ? receiveCurrency : currency} = ${fxRate} NGN</p>
            <p style="margin: 0;"><strong>Estimated Payout:</strong> ${payoutAmount} ${receiveCurrency}</p>
          </div>

          <div style="margin: 20px 0;">
            <a href="${dashboardLink}" style="background: #c9a227; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Trade Request</a>
          </div>
          <p>Thank you for choosing PapaEgo.</p>
        </div>
      `
    });
    if (error) throw error;
    return { success: true, messageId: data?.id };
  } catch (error) {
    console.error("Error sending rate quoted email:", error);
    return { success: false };
  }
}
