"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockFxProvider = void 0;
class MockFxProvider {
    async getRate(base, quote, country) {
        return 1500.25; // example
    }
}
exports.MockFxProvider = MockFxProvider;
