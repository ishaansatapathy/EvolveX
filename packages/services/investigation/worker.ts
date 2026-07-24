import { logger } from "@repo/logger";

import {
  claimNextInvestigationJob,
  completeInvestigationJob,
  countPendingInvestigationJobs,
  failInvestigationJob,
  recoverStaleInvestigationJobs,
} from "./job-queue";

export type InvestigationPipelineRunner = (investigationId: string) => Promise<void>;

let workerStarted = false;
let workerBusy = false;

async function processInvestigationJobQueue(runPipeline: InvestigationPipelineRunner) {
  if (workerBusy) return;
  workerBusy = true;

  try {
    await recoverStaleInvestigationJobs();

    let job = await claimNextInvestigationJob();
    while (job) {
      try {
        await runPipeline(job.investigationId);
        await completeInvestigationJob(job.jobId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("Investigation pipeline job failed", {
          jobId: job.jobId,
          investigationId: job.investigationId,
          attempts: job.attempts,
          message,
        });
        await failInvestigationJob(job.jobId, job.investigationId, message, job.attempts);
      }

      job = await claimNextInvestigationJob();
    }
  } finally {
    workerBusy = false;
  }
}

/** Starts a background worker that drains the durable investigation job queue. */
export function startInvestigationJobWorker(runPipeline: InvestigationPipelineRunner) {
  if (workerStarted) return;
  workerStarted = true;

  const tick = () => {
    void processInvestigationJobQueue(runPipeline);
  };

  tick();
  setInterval(tick, 5_000);

  logger.info("Investigation job worker started");
}

/** Triggers an immediate queue drain (e.g. after enqueue). */
export function kickInvestigationJobWorker(runPipeline: InvestigationPipelineRunner) {
  void processInvestigationJobQueue(runPipeline);
}

export async function getInvestigationJobQueueDepth() {
  return countPendingInvestigationJobs();
}
