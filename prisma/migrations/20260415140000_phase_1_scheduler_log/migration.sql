-- CreateTable
CREATE TABLE "SchedulerLog" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "summary" JSONB,
    "error" TEXT,

    CONSTRAINT "SchedulerLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchedulerLog_job_startedAt_idx" ON "SchedulerLog"("job", "startedAt");

-- CreateIndex
CREATE INDEX "SchedulerLog_status_idx" ON "SchedulerLog"("status");
