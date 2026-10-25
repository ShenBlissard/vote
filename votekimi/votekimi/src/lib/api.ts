"use client";

import { supabase } from "./supabase";
import { newId, newPollId, newToken } from "./ids";
import type {
  AdminData,
  PollPublicInfo,
  ResultsResponse,
  TurnoutMode,
  VoterStatus,
} from "./types";
import type { VoterEntry } from "./shared";

export class ApiError extends Error {}

async function rpc<T>(fn: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, params as never);
  if (error) {
    throw new ApiError(error.message || "网络错误，请重试");
  }
  return data as T;
}

type ActionResult = { ok: true } | { ok: false; error: string };

function unwrapAction(data: ActionResult): void {
  if (!data.ok) throw new ApiError(data.error);
}

// ---------- 公共接口 ----------

export async function getPollPublic(pollId: string): Promise<PollPublicInfo | null> {
  return rpc<PollPublicInfo | null>("get_poll_public", { p_poll_id: pollId });
}

export async function getResults(pollId: string): Promise<ResultsResponse | null> {
  return rpc<ResultsResponse | null>("get_results", { p_poll_id: pollId });
}

export async function getVoterStatus(
  pollId: string,
  name: string,
  passcode: string
): Promise<VoterStatus> {
  return rpc<VoterStatus>("voter_status", {
    p_poll_id: pollId,
    p_name: name,
    p_passcode: passcode,
  });
}

export async function castVote(
  pollId: string,
  name: string,
  passcode: string,
  candidateIds: string[]
): Promise<void> {
  const data = await rpc<ActionResult>("cast_vote", {
    p_poll_id: pollId,
    p_ballot_id: newId(),
    p_name: name,
    p_passcode: passcode,
    p_candidate_ids: candidateIds,
  });
  unwrapAction(data);
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
  voters: VoterEntry[];
}

export async function createPoll(input: CreatePollInput): Promise<{ id: string; adminToken: string }> {
  const data = await rpc<{ ok: true; id: string; admin_token: string } | { ok: false; error: string }>(
    "create_poll",
    {
      p_poll_id: newPollId(),
      p_admin_token: newToken(),
      p_title: input.title,
      p_description: input.description,
      p_min_choices: input.minChoices,
      p_max_choices: input.maxChoices,
      p_shuffle_candidates: input.shuffleCandidates,
      p_anonymous: input.anonymous,
      p_deadline: input.deadline,
      p_allow_change: input.allowChange,
      p_auto_publish: input.autoPublish,
      p_pub_top_n: input.pubTopN,
      p_turnout_mode: input.turnoutMode,
      p_candidates: input.candidates,
      p_voters: input.voters,
    }
  );
  if (!data.ok) throw new ApiError(data.error);
  return { id: data.id, adminToken: data.admin_token };
}

// ---------- 管理接口 ----------

export async function getAdminData(token: string): Promise<AdminData | null> {
  return rpc<AdminData | null>("get_admin_data", { p_admin_token: token });
}

export async function adminAction(
  token: string,
  action: string,
  params: Record<string, unknown> = {}
): Promise<void> {
  const data = await rpc<ActionResult>("admin_action", {
    p_admin_token: token,
    p_action: action,
    p_params: params,
  });
  unwrapAction(data);
}
