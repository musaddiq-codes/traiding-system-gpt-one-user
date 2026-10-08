import fs from "fs/promises";
import path from "path";

import { mockStrategies } from "./mock-data";
import type { Strategy } from "./trading-types";

const DATA_DIR = path.join(process.cwd(), "data");
const STRATEGIES_FILE = path.join(DATA_DIR, "strategies.json");

async function ensureStorage(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(STRATEGIES_FILE);
  } catch {
    await fs.writeFile(
      STRATEGIES_FILE,
      JSON.stringify(mockStrategies, null, 2),
      "utf-8"
    );
  }
}

export async function getStoredStrategies(): Promise<Strategy[]> {
  await ensureStorage();

  try {
    const raw = await fs.readFile(STRATEGIES_FILE, "utf-8");
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return parsed as Strategy[];
    }
  } catch {
    // Fall back to seeded strategies if file is invalid.
  }

  return mockStrategies;
}

export async function saveStoredStrategy(strategy: Strategy): Promise<Strategy[]> {
  const current = await getStoredStrategies();
  const normalized = current.filter((item) => item.id !== strategy.id);
  normalized.unshift(strategy);

  await fs.writeFile(
    STRATEGIES_FILE,
    JSON.stringify(normalized, null, 2),
    "utf-8"
  );

  return normalized;
}

export async function deleteStoredStrategy(strategyId: string): Promise<Strategy[]> {
  const current = await getStoredStrategies();
  const filtered = current.filter((item) => item.id !== strategyId);

  await fs.writeFile(
    STRATEGIES_FILE,
    JSON.stringify(filtered, null, 2),
    "utf-8"
  );

  return filtered;
}
