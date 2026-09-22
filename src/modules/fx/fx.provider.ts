/**
 * @deprecated Use getOneLiquidityRate() from exchange-rate/oneliquidity.provider.ts instead.
 * This module uses open.er-api.com (free daily-update rates) and is being phased out
 * in favour of the OneLiquidity live feed via the exchange-rate module.
 */
export interface FxProvider {
    getRate(
        base: string,
        quote: string,
        country: string
    ): Promise<number>;
}

export class RealFxProvider implements FxProvider {
    async getRate(base: string, quote: string, country: string): Promise<number> {
        try {
            // Using open.er-api.com which provides free, daily updated exchange rates
            const response = await fetch(`https://open.er-api.com/v6/latest/${base.toUpperCase()}`);
            if (!response.ok) {
                throw new Error("Failed to fetch exchange rates");
            }

            const data = await response.json();
            const rate = data.rates[quote.toUpperCase()];

            if (!rate) {
                throw new Error(`Rate not found for quote currency: ${quote}`);
            }

            return rate;
        } catch (error) {
            console.error("FX Provider Error:", error);
            // REMOVED: hardcoded fallback `return 1500` — we must never silently use a wrong rate.
            // Callers should catch this error and surface it appropriately.
            throw new Error(
                `FX rate unavailable for ${base}/${quote}. ` +
                `The open.er-api.com API failed and no hardcoded fallback is permitted. ` +
                `Please ensure ONELIQUIDITY_API_KEY is configured and the exchange-rate module is used.`
            );
        }
    }
}


