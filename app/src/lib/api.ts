import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import type {
  AdminData,
  AuthUser,
  MyCreatedItem,
  MyParticipatingResponse,
  PollPublicInfo,
  ResultsResponse,
  TurnoutMode,
  VoterStatus,
} from "./types";
import type { ParticipantEntry } from "./shared";

export class ApiError extends Error {}

const client = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, { ...(init ?? {}), credentials: "include" });
      },
    }),
  ],
});

async function call<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    throw new ApiError(msg && !/fetch|network/i.test(msg) ? msg : "网络错误，请重试");
  }
}

// ---------- 账号与会话 ----------

export async function getMe(): Promise<AuthUser | null> {
  return call(client.auth.me.query());
}

export async function login(code: string, name: string): Promise<AuthUser> {
  return call(client.auth.login.mutate({ code, name }));
}

export async function register(code: string, name: string): Promise<AuthUser> {
  return call(client.auth.register.mutate({ code, name }));
}

export async function logout(): Promise<void> {
  await call(client.auth.logout.mutate());
}

// ---------- 我的投票 ----------

export async function getMyParticipating(
  historyOffset = 0,
  historyLimit = 20
): Promise<MyParticipatingResponse> {
  return call(client.vote.myParticipating.query({ historyOffset, historyLimit }));
}

export async function getMyCreated(): Promise<MyCreatedItem[]> {
  return call(client.vote.myCreated.query());
}

// ---------- 投票接口 ----------

export async function getPollPublic(pollId: string): Promise<PollPublicInfo | null> {
  return call(client.vote.getPollPublic.query({ pollId }));
}

export async function getResults(pollId: string): Promise<ResultsResponse | null> {
  return call(client.vote.getResults.query({ pollId }));
}

export async function getVoterStatus(pollId: string): Promise<VoterStatus> {
  return call(client.vote.voterStatus.query({ pollId }));
}

export async function castVote(pollId: string, candidateIds: string[]): Promise<void> {
  await call(client.vote.castVote.mutate({ pollId, candidateIds }));
}

export interface CreatePollInput {
  title: string;
  description: string;
  minChoices: number;
  maxChoices: number;
  shuffleCandidates: boolean;
  anonymous: boolean;
  deadline: string;
  allowChange: boolean;
  autoPublish: boolean;
  pubTopN: number;
  turnoutMode: TurnoutMode;
  candidates: string[];
  participants: ParticipantEntry[];
}

export async function createPoll(input: CreatePollInput): Promise<{ id: string }> {
  return call(client.vote.createPoll.mutate(input));
}

// ---------- 管理接口 ----------

export async function getAdminData(pollId: string): Promise<AdminData | null> {
  return call(client.vote.getAdminData.query({ pollId }));
}

export async function adminAction(
  pollId: string,
  action: string,
  params: Record<string, unknown> = {}
): Promise<void> {
  await call(client.vote.adminAction.mutate({ pollId, action, params }));
}
