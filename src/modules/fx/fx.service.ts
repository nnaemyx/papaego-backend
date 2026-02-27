import { RealFxProvider } from "./fx.provider";
import prisma from "../../config/db";

const fx = new RealFxProvider();

export async function getLockedRate(
    base: string,
    quote: string,
    country: string
) {
    const rawRate = await fx.getRate(base, quote, country);

    // Fetch margin configuration
    const marginConfig = await prisma.fxMargin.findUnique({
        where: { countryId: country }
    });

    const margin = marginConfig ? Number(marginConfig.margin) : 0;

    // Apply margin (e.g., add margin to rate)
    return rawRate + margin;
}
