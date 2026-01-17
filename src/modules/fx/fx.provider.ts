export interface FxProvider {
    getRate(
        base: string,
        quote: string,
        country: string
    ): Promise<number>;
}

export class MockFxProvider implements FxProvider {
    async getRate(base: string, quote: string, country: string) {
        return 1500.25; // example
    }
}
