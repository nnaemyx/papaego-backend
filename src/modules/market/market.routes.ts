import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/rbac.middleware";
import {
    getMarketDataSummary,
    getMarketRates,
    getP2PQuotes,
    getLiquidity,
    ingestRate,
    ingestP2P,
} from "./market.controller";

const router = Router();

router.use(auth);
router.use(requireRole("ADMIN"));

// Summary
router.get("/summary", getMarketDataSummary);

// Stablecoin spot rates
router.get("/rates", getMarketRates);
router.post("/rates", ingestRate); // Manual ingestion

// P2P quotes
router.get("/p2p", getP2PQuotes);
router.post("/p2p", ingestP2P); // Manual ingestion

// Liquidity depth
router.get("/liquidity", getLiquidity);

export default router;
