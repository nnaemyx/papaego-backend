"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendAgentInvitation = sendAgentInvitation;
exports.sendAgentVerificationEmail = sendAgentVerificationEmail;
exports.sendAgentSuspensionEmail = sendAgentSuspensionEmail;
const resend_1 = require("resend");
const resend = new resend_1.Resend(process.env.RESEND_API_KEY);
/**
 * Sends an invitation email to a newly created agent
 */
async function sendAgentInvitation({ email, agentName, licenseId, onboardingLink, }) {
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
        if (error)
            throw error;
        console.log("✅ Email sent successfully:", data?.id);
        return { success: true, messageId: data?.id };
    }
    catch (error) {
        console.error("❌ Error sending agent invitation email:", error);
        throw new Error("Failed to send invitation email");
    }
}
/**
 * Sends a welcome verification email when an Admin approves an agent
 */
async function sendAgentVerificationEmail({ email, agentName, loginLink, }) {
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
        if (error)
            throw error;
        console.log("✅ Verification email sent successfully:", data?.id);
        return { success: true, messageId: data?.id };
    }
    catch (error) {
        console.error("❌ Error sending agent verification email:", error);
        throw new Error("Failed to send verification email");
    }
}
/**
 * Sends an email stating the agent account is suspended
 */
async function sendAgentSuspensionEmail({ email, agentName, }) {
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
        if (error)
            throw error;
        console.log("✅ Suspension email sent successfully:", data?.id);
        return { success: true, messageId: data?.id };
    }
    catch (error) {
        console.error("❌ Error sending agent suspension email:", error);
        throw new Error("Failed to send suspension email");
    }
}
