import { readFile } from 'node:fs/promises';

import { z } from 'zod';

const fixtureTicketSchema = z.object({
  key: z.string().min(1),
  summary: z.string().min(1),
  description: z.string().min(1),
  labels: z.array(z.string().min(1)).default([])
});

const fixtureRepositorySchema = z.object({
  name: z.string().min(1),
  sourcePath: z.string().min(1),
  hints: z.array(z.string().min(1)).default([]),
  qualityProfile: z.string().min(1).default('node')
});

const fixtureFileWriteSchema = z.object({
  path: z.string().min(1),
  content: z.string()
});

const fixtureAgentSchema = z.object({
  status: z.enum(['completed', 'blocked', 'incomplete']),
  changedFiles: z.array(z.string().min(1)),
  fileWrites: z.array(fixtureFileWriteSchema).default([]),
  testsRun: z.string().min(1),
  knownLimits: z.string().min(1),
  blockers: z.string().min(1),
  backgroundAgents: z.string().min(1).default('none'),
  gitAfterStatus: z.string(),
  gitPathspecStatus: z.string().optional(),
  gitAfterDiffStat: z.string().default(''),
  gitTrackedDiff: z.string().default('')
});

const fixtureExpectedSchema = z.object({
  selectedRepository: z.string().min(1),
  meaningfulDiff: z.enum(['passed', 'failed']),
  policyDecision: z.enum(['pass', 'fail', 'needs_human', 'missing']),
  qualityResult: z.enum(['passed', 'failed', 'skipped', 'not_run']),
  finalState: z.string().min(1),
  reports: z.array(z.string().min(1))
});

const harnessFixtureSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  description: z.string().min(1),
  ticket: fixtureTicketSchema,
  repositories: z.array(fixtureRepositorySchema).min(1),
  agent: fixtureAgentSchema,
  expected: fixtureExpectedSchema
});

export type HarnessFixture = z.infer<typeof harnessFixtureSchema>;
export type HarnessFixtureRepository = z.infer<typeof fixtureRepositorySchema>;
export type HarnessFixtureAgent = z.infer<typeof fixtureAgentSchema>;
export type HarnessFixtureExpected = z.infer<typeof fixtureExpectedSchema>;

export class HarnessFixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HarnessFixtureError';
  }
}

export async function loadHarnessFixture(fixturePath: string): Promise<HarnessFixture> {
  const source = await readFile(fixturePath, 'utf8');
  return parseHarnessFixture(source, fixturePath);
}

export function parseHarnessFixture(source: string, fixturePath = 'fixture.json'): HarnessFixture {
  let input: unknown;

  try {
    input = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HarnessFixtureError(`${fixturePath}: invalid JSON: ${message}`);
  }

  const result = harnessFixtureSchema.safeParse(input);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`).join('; ');
    throw new HarnessFixtureError(`${fixturePath}: invalid harness fixture: ${issues}`);
  }

  return result.data;
}
