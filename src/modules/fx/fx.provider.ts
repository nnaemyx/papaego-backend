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
            // Fallback to a hardcoded rate just in case the API is down, so the app doesn't crash completely
            return 1500;
        }
    }
}

