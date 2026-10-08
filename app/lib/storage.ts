import type { Strategy } from "./trading-types";

const BACKEND_URL = (
  process.env.BACKEND_URL ?? "http://127.0.0.1:8000"
).replace(/\/$/, "");

export async function getStoredStrategies(): Promise<Strategy[]> {
  const response = await fetch(`${BACKEND_URL}/api/strategies`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Unable to load strategies from the backend (${response.status}).`);
  }

  const payload = await response.json() as { strategies?: Strategy[] };
  if (!Array.isArray(payload.strategies)) {
    throw new Error("The backend returned an invalid strategies response.");
  }
  return payload.strategies;
}
