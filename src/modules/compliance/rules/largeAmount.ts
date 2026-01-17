import { ComplianceRule } from "./rule.interface";

export class LargeAmountRule implements ComplianceRule {
    code = "LARGE_AMOUNT";

    evaluate(trade: any) {
        return trade.amount > 10000;
    }
}
