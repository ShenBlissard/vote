import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, protectedQuery } from "./middleware";
import {
  adminAction,
  castVote,
  createPoll,
  getAdminData,
  getPollPublic,
  getResults,
  myCreated,
  myParticipating,
  voterStatus,
} from "./queries/polls";

function fail(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

const participant = z.object({
  code: z.string(),
  name: z.string(),
});

export const voteRouter = createRouter({
  myParticipating: protectedQuery
    .input(
      z.object({
        historyOffset: z.number().int().min(0).optional().default(0),
        historyLimit: z.number().int().min(1).max(20).optional().default(20),
      }),
    )
    .query(({ ctx, input }) =>
      myParticipating(ctx.user.id, input.historyOffset, input.historyLimit),
    ),

  myCreated: protectedQuery.query(({ ctx }) => myCreated(ctx.user.id)),

  createPoll: protectedQuery
    .input(
      z.object({
        title: z.string(),
        description: z.string().optional().default(""),
        minChoices: z.number().int(),
        maxChoices: z.number().int(),
        shuffleCandidates: z.boolean().optional().default(false),
        anonymous: z.boolean().optional().default(true),
        deadline: z.string(),
        allowChange: z.boolean().optional().default(false),
        autoPublish: z.boolean().optional().default(true),
        pubTopN: z.number().int().optional().default(-1),
        turnoutMode: z.string().optional().default("both"),
        candidates: z.array(z.string()),
        participants: z.array(participant),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await createPoll(ctx.user.id, input);
      if (!result.ok) fail(result.error);
      return { id: result.id };
    }),

  getPollPublic: protectedQuery
    .input(z.object({ pollId: z.string() }))
    .query(({ ctx, input }) => getPollPublic(input.pollId, ctx.user.id)),

  voterStatus: protectedQuery
    .input(z.object({ pollId: z.string() }))
    .query(({ ctx, input }) => voterStatus(input.pollId, ctx.user.id)),

  castVote: protectedQuery
    .input(
      z.object({
        pollId: z.string(),
        candidateIds: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await castVote(input.pollId, ctx.user.id, input.candidateIds);
      if (!result.ok) fail(result.error);
    }),

  getResults: protectedQuery
    .input(z.object({ pollId: z.string() }))
    .query(({ ctx, input }) => getResults(input.pollId, ctx.user.id)),

  getAdminData: protectedQuery
    .input(z.object({ pollId: z.string() }))
    .query(({ ctx, input }) => getAdminData(input.pollId, ctx.user.id)),

  adminAction: protectedQuery
    .input(
      z.object({
        pollId: z.string(),
        action: z.string(),
        params: z.record(z.string(), z.unknown()).optional().default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await adminAction(input.pollId, ctx.user.id, input.action, input.params);
      if (!result.ok) fail(result.error);
    }),
});
