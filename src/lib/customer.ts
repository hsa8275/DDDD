import { nextDummyUtterance } from "../mock/customerDummy";

export type CustomerUtterance = {
  text: string;
  ts?: string;
  id?: string;
};

export async function fetchLatestCustomerUtterance(_signal?: AbortSignal): Promise<CustomerUtterance> {
  await new Promise((r) => setTimeout(r, 120));
  const u = nextDummyUtterance();
  return { text: u.text, ts: u.ts, id: u.id };
}
