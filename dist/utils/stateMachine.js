"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transitions = void 0;
exports.canTransition = canTransition;
exports.assertTransition = assertTransition;
exports.transitions = {
    INITIATED: ["CUSTOMER_VERIFIED"],
    CUSTOMER_VERIFIED: ["QUOTED"],
    QUOTED: ["SENT_TO_CUSTOMER", "EXPIRED"],
    SENT_TO_CUSTOMER: ["CUSTOMER_CONFIRMED"],
    CUSTOMER_CONFIRMED: ["AWAITING_PAYMENT"],
    AWAITING_PAYMENT: ["PAYMENT_CONFIRMED", "FLAGGED"],
    FLAGGED: ["UNDER_REVIEW"],
    UNDER_REVIEW: ["PAYMENT_CONFIRMED", "CANCELLED"],
    PAYMENT_CONFIRMED: ["COMPLETED"]
};
function canTransition(from, to) {
    return exports.transitions[from]?.includes(to);
}
function assertTransition(from, to) {
    if (!canTransition(from, to)) {
        throw new Error(`Invalid transition from ${from} to ${to}`);
    }
}
