export interface ComplianceRule {
    code: string;
    evaluate(trade: any): boolean;
}
