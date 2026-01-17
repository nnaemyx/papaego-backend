"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LargeAmountRule = void 0;
class LargeAmountRule {
    constructor() {
        this.code = "LARGE_AMOUNT";
    }
    evaluate(trade) {
        return trade.amount > 10000;
    }
}
exports.LargeAmountRule = LargeAmountRule;
