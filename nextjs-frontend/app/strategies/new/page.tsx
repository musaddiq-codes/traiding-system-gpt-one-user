"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";

import Header from "../../components/navigation/Header";
import Sidebar from "../../components/navigation/Sidebar";
import StrategyForm from "../../components/strategies/StrategyForm";

export default function NewStrategyPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-[#070b12] text-white">
      <Sidebar />
      <div className="lg:pl-64">
        <Header />
        <main className="p-4 md:p-6 lg:p-8">
          <div className="mx-auto max-w-5xl">
            <Link
              href="/strategies"
              className="mb-4 inline-flex text-sm text-slate-400 transition hover:text-white"
            >
              ← Back to Strategies
            </Link>
            <h1 className="text-2xl font-semibold">Create Strategy</h1>
            <p className="mb-8 mt-1 text-sm text-slate-400">
              Configure a paper-trading strategy.
            </p>
            <StrategyForm onSuccess={() => router.push("/strategies")} />
          </div>
        </main>
      </div>
    </div>
  );
}
