import { runBenchmarkSuite } from "@repo/services/benchmarks/suite";

async function main() {
  const result = await runBenchmarkSuite();
  console.log(`[benchmark] ${result.summary}`);
  for (const row of result.results) {
    console.log(`  ${row.name}: ${row.durationMs} ms`);
  }
}

main().catch((error) => {
  console.error("[benchmark] failed:", error);
  process.exit(1);
});
