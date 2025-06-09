import { WhopServerSdk, makeUserTokenVerifier } from "@whop-apps/sdk";

export const whopApi = WhopServerSdk({
  appApiKey: process.env.WHOP_API_KEY ?? "fallback",
  onBehalfOfUserId: process.env.NEXT_PUBLIC_WHOP_AGENT_USER_ID,
  companyId: process.env.NEXT_PUBLIC_WHOP_COMPANY_ID,
});

export const verifyUserToken = makeUserTokenVerifier({
  appId: process.env.NEXT_PUBLIC_WHOP_APP_ID ?? "fallback",
  dontThrow: true,
});
