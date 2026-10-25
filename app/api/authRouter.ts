import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import {
  clearSessionCookieHeader,
  deleteSession,
  login,
  register,
  sessionCookieHeader,
  validCode,
  validName,
} from "./queries/auth";

const credentials = z.object({
  code: z.string(),
  name: z.string(),
});

function checkFormat(code: string, name: string): { code: string; name: string } {
  const c = code.trim();
  const n = name.trim();
  if (!validCode(c)) throw new TRPCError({ code: "BAD_REQUEST", message: "请输入恰好 4 位数字" });
  if (!validName(n)) throw new TRPCError({ code: "BAD_REQUEST", message: "请输入姓名（1~50 字）" });
  return { code: c, name: n };
}

export const authRouter = createRouter({
  register: publicQuery.input(credentials).mutation(async ({ ctx, input }) => {
    const { code, name } = checkFormat(input.code, input.name);
    const result = await register(code, name);
    if (!result.ok) throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
    ctx.resHeaders.append("Set-Cookie", sessionCookieHeader(result.token));
    return { id: result.user.id, code: result.user.code, name: result.user.name };
  }),

  login: publicQuery.input(credentials).mutation(async ({ ctx, input }) => {
    const { code, name } = checkFormat(input.code, input.name);
    const result = await login(code, name);
    if (!result.ok) throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
    ctx.resHeaders.append("Set-Cookie", sessionCookieHeader(result.token));
    return { id: result.user.id, code: result.user.code, name: result.user.name };
  }),

  logout: publicQuery.mutation(async ({ ctx }) => {
    await deleteSession(ctx.sessionToken);
    ctx.resHeaders.append("Set-Cookie", clearSessionCookieHeader());
  }),

  me: publicQuery.query(({ ctx }) => {
    if (!ctx.user) return null;
    return { id: ctx.user.id, code: ctx.user.code, name: ctx.user.name };
  }),
});
