import {
  fetchCandles,
  fetchMarketSnapshot,
  isChartRange,
} from "../../lib/market-data";
import { mockAssets } from "../../lib/mock-data";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  const interval = searchParams.get("interval") ?? "1m";
  const limit = Number(searchParams.get("limit") ?? "200");

  try {
    if (symbol) {
      if (!isChartRange(interval)) {
        return Response.json(
          { error: "Unsupported candle interval." },
          { status: 400 }
        );
      }

      const candles = await fetchCandles(
        symbol,
        interval,
        Number.isFinite(limit) && limit > 0 ? limit : 200
      );

      return Response.json({
        candles,
        updatedAt: new Date().toISOString(),
        source: "binance-live",
      });
    }

    const assets = await fetchMarketSnapshot();

    return Response.json({
      assets,
      updatedAt: new Date().toISOString(),
      source: "binance-live",
    });
  } catch {
    if (symbol) {
      return Response.json(
        { error: "Live market or candle data is currently unavailable." },
        { status: 502 }
      );
    }

    return Response.json({
      assets: mockAssets,
      updatedAt: new Date().toISOString(),
      source: "mock-market-data-fallback",
    });
  }
}
