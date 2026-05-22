import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { VerdictQuotaStatus } from "@/functions/verdict-quota.server";

const QuotaIdentitySchema = z.object({
  accessToken: z.string().min(1).optional(),
  anonymousId: z.string().min(8).max(128).optional(),
});

export type { VerdictQuotaStatus } from "@/functions/verdict-quota.server";

export const getVerdictQuotaStatus = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => QuotaIdentitySchema.parse(input))
  .handler(async ({ data }): Promise<VerdictQuotaStatus> => {
    const { getVerdictQuota } = await import("@/functions/verdict-quota.server");
    return getVerdictQuota(data);
  });
