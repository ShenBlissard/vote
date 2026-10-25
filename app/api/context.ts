import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { User } from "@db/schema";
import { getUserBySession, readSessionToken } from "./queries/auth";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user: User | null;
  sessionToken: string | null;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const sessionToken = readSessionToken(opts.req);
  const user = await getUserBySession(sessionToken);
  return { req: opts.req, resHeaders: opts.resHeaders, user, sessionToken };
}
