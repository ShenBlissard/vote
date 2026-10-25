import { createRouter, publicQuery } from "./middleware";
import { authRouter } from "./authRouter";
import { voteRouter } from "./voteRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  vote: voteRouter,
});

export type AppRouter = typeof appRouter;
