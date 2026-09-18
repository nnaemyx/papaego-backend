/**
 * FV Bank Global Managed Accounts (GMA) Client
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements the FV Bank GMA integration layer:
 *  - Short-lived HS256 JWT generation using ClientID + ClientSecret
 *  - Exchanging JWT for SessionToken via GET /auth
 *  - Session token caching and proactive renewal
 *  - Secured endpoint execution with session-token header injection
 *  - Target Sandbox: https://sandbox.gma-api.fvbank.us
 *  - Deterministic Simulation Mode when credentials are not yet supplied
 * ─────────────────────────────────────────────────────────────────────────────
 */

import jwt from "jsonwebtoken";
import crypto from "crypto";

export interface GmaConfig {
    baseUrl: string;
    clientId: string;
    clientSecret: string;
}

export interface GmaUser {
    id: string;
    name: string;
    email: string;
    status: string;
    currency: string;
    createdAt: string;
}

export interface GmaAccountBalance {
    userId: string;
    currency: string;
    availableBalance: number;
    currentBalance: number;
    pendingBalance: number;
    updatedAt: string;
}

export interface GmaCounterpartyPayload {
    name: string;
    email?: string;
    type: "INDIVIDUAL" | "CORPORATE";
    country: string;
    address?: {
        street?: string;
        city?: string;
        state?: string;
        postalCode?: string;
        country: string;
    };
    identification?: {
        type: string;
        number: string;
    };
}

export interface GmaCounterpartyResponse {
    counterpartyId: string;
    userId: string;
    name: string;
    country: string;
    status: "ACTIVE" | "PENDING_VERIFICATION";
    createdAt: string;
}

export interface GmaPaymentInstrumentPayload {
    instrumentType: "WIRE" | "ACH" | "INTERNAL";
    accountNumber: string;
    routingNumber?: string;
    swiftBic?: string;
    bankName: string;
    bankAddress?: string;
    currency: string;
    beneficiaryName: string;
}

export interface GmaPaymentInstrumentResponse {
    instrumentId: string;
    counterpartyId: string;
    bankName: string;
    currency: string;
    status: "ACTIVE" | "VERIFIED";
}

export interface GmaPaymentPreviewPayload {
    counterpartyId: string;
    instrumentId?: string;
    amount: number;
    currency: string;
    sourceCurrency?: string;
    paymentRail?: "SWIFT" | "ACH" | "BOOK_TRANSFER";
}

export interface GmaPaymentPreviewResponse {
    previewId: string;
    amount: number;
    currency: string;
    estimatedFee: number;
    fxRate?: number;
    sourceAmount?: number;
    settlementRail: string;
    estimatedDeliveryHours: number;
    expiresAt: string;
}

export interface GmaPaymentPayload {
    previewId?: string;
    counterpartyId: string;
    instrumentId?: string;
    amount: number;
    currency: string;
    reference: string;
    purpose?: string;
}

export interface GmaPaymentResponse {
    paymentId: string;
    userId: string;
    status: "SUBMITTED" | "PROCESSING" | "COMPLETED";
    amount: number;
    currency: string;
    reference: string;
    transactionHash?: string;
    submittedAt: string;
}

export class FvBankGmaClient {
    private baseUrl: string;
    private clientId: string;
    private clientSecret: string;
    private sessionToken: string | null = null;
    private sessionExpiresAt: number = 0;
    private isSimulation: boolean = false;

    constructor() {
        this.baseUrl = (process.env.FV_BANK_GMA_URL || "https://sandbox.gma-api.fvbank.us").replace(/\/$/, "");
        this.clientId = process.env.FV_BANK_CLIENT_ID || "";
        this.clientSecret = process.env.FV_BANK_CLIENT_SECRET || "";

        // Fallback to simulation mode if credentials are not configured
        if (!this.clientId || !this.clientSecret || this.clientId.includes("placeholder") || this.clientId.includes("your_")) {
            this.isSimulation = true;
            console.log("ℹ️  FV Bank GMA Client running in SANDBOX SIMULATION MODE (awaiting live credentials).");
        } else {
            console.log(`🔌 FV Bank GMA Client initialized targeting: ${this.baseUrl}`);
        }
    }

    /**
     * Obtains or refreshes the GMA session token.
     * Generates a 2-minute HS256 JWT using ClientID & ClientSecret,
     * and exchanges it at GET /auth for a session-token.
     */
    public async getSessionToken(): Promise<string> {
        if (this.isSimulation) {
            return "simulated_gma_session_token_" + Date.now();
        }

        const now = Math.floor(Date.now() / 1000);
        // If we have a cached session token that is valid for at least another 60 seconds, reuse it
        if (this.sessionToken && this.sessionExpiresAt > now + 60) {
            return this.sessionToken;
        }

        try {
            // Generate short-lived HS256 authorization JWT
            const payload = {
                iss: this.clientId,
                aud: this.baseUrl,
                iat: now,
                exp: now + 120, // 2 minutes
            };

            const authToken = jwt.sign(payload, this.clientSecret, { algorithm: "HS256" });

            const res = await fetch(`${this.baseUrl}/auth`, {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${authToken}`,
                    "Accept": "application/json",
                },
            });

            if (!res.ok) {
                const text = await res.text();
                throw new Error(`FV Bank GMA Auth failed (${res.status}): ${text}`);
            }

            const data: any = await res.json();
            const sessionToken = data.sessionToken || data["session-token"] || data.token;
            if (!sessionToken) {
                throw new Error("Missing session-token in FV Bank GMA auth response");
            }

            this.sessionToken = sessionToken;
            // Default session lifetime: 15 minutes unless specified
            const expiresIn = data.expiresIn || 900;
            this.sessionExpiresAt = now + expiresIn;

            return sessionToken;
        } catch (error: any) {
            console.error("FV Bank GMA Auth error:", error);
            throw error;
        }
    }

    /**
     * Internal request wrapper with automatic session-token injection
     */
    private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
        if (this.isSimulation) {
            return this.generateSimulationResponse<T>(method, path, body);
        }

        const sessionToken = await this.getSessionToken();
        const url = `${this.baseUrl}${path}`;

        const res = await fetch(url, {
            method,
            headers: {
                "Content-Type": "application/json",
                "session-token": sessionToken,
                "Accept": "application/json",
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ message: res.statusText }));
            throw new Error(`FV Bank GMA API error (${res.status} on ${path}): ${(err as any).message || res.statusText}`);
        }

        return res.json() as Promise<T>;
    }

    // ── GMA Core Endpoints ───────────────────────────────────────────────────

    /**
     * GET /users
     * Retrieve list of corporate users under this partner account
     */
    public async getUsers(): Promise<GmaUser[]> {
        return this.request<GmaUser[]>("GET", "/users");
    }

    /**
     * POST /users/{userId}/accounts/{currency}/balance
     * Retrieve the real-time sub-account balance
     */
    public async getUserAccountBalance(userId: string, currency: string = "USD"): Promise<GmaAccountBalance> {
        return this.request<GmaAccountBalance>("POST", `/users/${userId}/accounts/${currency}/balance`);
    }

    /**
     * POST /counterparty/{userId}/create
     * Registers a supplier/counterparty for cross-border payouts
     */
    public async createCounterparty(userId: string, payload: GmaCounterpartyPayload): Promise<GmaCounterpartyResponse> {
        return this.request<GmaCounterpartyResponse>("POST", `/counterparty/${userId}/create`, payload);
    }

    /**
     * POST /counterparty/{userId}/{counterpartyId}/instrument
     * Adds banking rails (SWIFT, ACH, etc.) for a counterparty
     */
    public async createPaymentInstrument(
        userId: string,
        counterpartyId: string,
        payload: GmaPaymentInstrumentPayload
    ): Promise<GmaPaymentInstrumentResponse> {
        return this.request<GmaPaymentInstrumentResponse>(
            "POST",
            `/counterparty/${userId}/${counterpartyId}/instrument`,
            payload
        );
    }

    /**
     * POST /transactions/{userId}/payments/preview
     * Generates a pre-flight fee and delivery estimate before debiting
     */
    public async previewPayment(userId: string, payload: GmaPaymentPreviewPayload): Promise<GmaPaymentPreviewResponse> {
        return this.request<GmaPaymentPreviewResponse>("POST", `/transactions/${userId}/payments/preview`, payload);
    }

    /**
     * POST /transactions/{userId}/payments
     * Executes the cross-border disbursement from customer's sub-position
     */
    public async executePayment(userId: string, payload: GmaPaymentPayload): Promise<GmaPaymentResponse> {
        return this.request<GmaPaymentResponse>("POST", `/transactions/${userId}/payments`, payload);
    }

    // ── Sandbox Deterministic Simulation Fallback ────────────────────────────

    private generateSimulationResponse<T>(method: string, path: string, body?: any): T {
        const timestamp = Date.now();

        if (path.includes("/users") && method === "GET") {
            return [
                {
                    id: "usr_sim_papaego_treasury_01",
                    name: "PapaEgo Central Treasury",
                    email: "treasury@papaego.com",
                    status: "ACTIVE",
                    currency: "USD",
                    createdAt: new Date().toISOString(),
                },
            ] as unknown as T;
        }

        if (path.includes("/balance")) {
            return {
                userId: path.split("/")[2] || "usr_sim",
                currency: "USD",
                availableBalance: 250000.0,
                currentBalance: 250000.0,
                pendingBalance: 0.0,
                updatedAt: new Date().toISOString(),
            } as unknown as T;
        }

        if (path.includes("/counterparty") && path.includes("/create")) {
            return {
                counterpartyId: `cpty_sim_${timestamp}`,
                userId: path.split("/")[2] || "usr_sim",
                name: body?.name || "Overseas Supplier Co.",
                country: body?.country || "United States",
                status: "ACTIVE",
                createdAt: new Date().toISOString(),
            } as unknown as T;
        }

        if (path.includes("/instrument")) {
            return {
                instrumentId: `inst_sim_${timestamp}`,
                counterpartyId: path.split("/")[3] || "cpty_sim",
                bankName: body?.bankName || "JPMorgan Chase Bank, N.A.",
                currency: body?.currency || "USD",
                status: "ACTIVE",
            } as unknown as T;
        }

        if (path.includes("/preview")) {
            const amt = body?.amount || 10000;
            return {
                previewId: `prv_sim_${timestamp}`,
                amount: amt,
                currency: body?.currency || "USD",
                estimatedFee: 25.0,
                settlementRail: body?.paymentRail || "SWIFT",
                estimatedDeliveryHours: 4,
                expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            } as unknown as T;
        }

        if (path.includes("/payments")) {
            return {
                paymentId: `gma_pay_${timestamp}`,
                userId: path.split("/")[2] || "usr_sim",
                status: "PROCESSING",
                amount: body?.amount || 10000,
                currency: body?.currency || "USD",
                reference: body?.reference || `REF-${timestamp.toString().slice(-6)}`,
                transactionHash: crypto.randomBytes(16).toString("hex"),
                submittedAt: new Date().toISOString(),
            } as unknown as T;
        }

        return { success: true, simulated: true, path, method } as unknown as T;
    }
}

// Singleton export
export const fvBankGmaClient = new FvBankGmaClient();
