import { nanoid } from "nanoid";

export type JobType = "video" | "image" | "audio";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type JobRecord = {
  id: string;
  type: JobType;
  userId: string;
  input: Record<string, unknown>;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  output?: unknown;
  error?: string;
};

const jobs = new Map<string, JobRecord>();

export function createJob(params: {
  type: JobType;
  userId: string;
  input: Record<string, unknown>;
}): JobRecord {
  const now = new Date().toISOString();
  const record: JobRecord = {
    id: nanoid(16),
    type: params.type,
    userId: params.userId,
    input: params.input,
    status: "queued",
    createdAt: now,
    updatedAt: now,
  };

  jobs.set(record.id, record);
  return record;
}

export function getJobById(id: string): JobRecord | null {
  return jobs.get(id) ?? null;
}
